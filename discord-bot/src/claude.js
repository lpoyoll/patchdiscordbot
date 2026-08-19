import 'dotenv/config';
import { getMadgicxAccessToken } from './madgicx-auth.js';
import { listPatchTools, callPatchTool } from './patch-mcp-client.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
const MAX_TOOL_ITERATIONS = 8;

async function madgicxServer() {
  return {
    type: 'url',
    url: process.env.MADGICX_MCP_URL,
    name: 'madgicx',
    authorization_token: await getMadgicxAccessToken(),
  };
}

// Which backend(s) a command needs. Pass as `backend` to askClaude.
export const BACKEND = { patch: 'patch', madgicx: 'madgicx', both: 'both' };

/**
 * Calls Claude and returns the final text reply.
 *
 * Patch: Anthropic's managed MCP connector (`mcp_servers`) won't accept
 * Patch's bearer tokens — Supabase's OAuth authorization-server metadata
 * only advertises `authorization_code`/`refresh_token` grants, and
 * Anthropic's connector declines to trust a token that wasn't minted via a
 * grant type the authorization server itself declares, even though Patch's
 * own resource server accepts it fine (confirmed directly). So Patch tools
 * are run as ordinary client-side Anthropic `tools`, executed here via
 * patch-mcp-client.js, in a manual tool-use loop.
 *
 * Madgicx: still uses the managed `mcp_servers` connector as before — its
 * OAuth server supports `client_credentials`, which the connector accepts.
 *
 * @param {Object} opts
 * @param {string} opts.system
 * @param {string} opts.prompt
 * @param {'patch'|'madgicx'|'both'} opts.backend
 * @param {number} [opts.maxTokens]
 */
export async function askClaude({ system, prompt, backend, maxTokens = 1200 }) {
  const usePatch = backend === BACKEND.patch || backend === BACKEND.both;
  const useMadgicx = backend === BACKEND.madgicx || backend === BACKEND.both;

  const patchTools = usePatch ? await listPatchTools() : [];
  const mcpServers = useMadgicx ? [await madgicxServer()] : [];

  const messages = [{ role: 'user', content: prompt }];

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        // Required header while the MCP connector feature is in beta
        // (only exercised when mcpServers is non-empty).
        'anthropic-beta': 'mcp-client-2025-04-04',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        system,
        messages,
        ...(patchTools.length > 0 ? { tools: patchTools } : {}),
        ...(mcpServers.length > 0 ? { mcp_servers: mcpServers } : {}),
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Anthropic API ${res.status}: ${body.slice(0, 500)}`);
    }

    const data = await res.json();
    messages.push({ role: 'assistant', content: data.content });

    const patchToolUses = data.content.filter(
      (block) => block.type === 'tool_use' && patchTools.some((t) => t.name === block.name),
    );

    if (patchToolUses.length === 0) {
      return extractText(data.content);
    }

    const toolResults = await Promise.all(
      patchToolUses.map(async (block) => {
        try {
          const { text, isError } = await callPatchTool(block.name, block.input);
          return { type: 'tool_result', tool_use_id: block.id, content: text, is_error: isError };
        } catch (err) {
          return {
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Tool call failed: ${err.message}`,
            is_error: true,
          };
        }
      }),
    );

    messages.push({ role: 'user', content: toolResults });
  }

  throw new Error('Gave up after too many tool-call rounds without a final answer.');
}

function extractText(content) {
  // Response content is a mix of text / tool_use / mcp_tool_use / mcp_tool_result
  // blocks. We only surface the text blocks to Discord.
  const text = content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
  return text || '_(Claude returned no text — check the raw response/logs.)_';
}
