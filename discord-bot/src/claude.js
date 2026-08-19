import 'dotenv/config';

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

function patchServer() {
  return {
    type: 'url',
    url: process.env.PATCH_MCP_URL,
    name: 'patch',
    authorization_token: process.env.PATCH_MCP_TOKEN || undefined,
  };
}

function madgicxServer() {
  return {
    type: 'url',
    url: process.env.MADGICX_MCP_URL,
    name: 'madgicx',
    authorization_token: process.env.MADGICX_MCP_TOKEN || undefined,
  };
}

export const SERVERS = {
  patch: [patchServer()],
  madgicx: [madgicxServer()],
  both: [patchServer(), madgicxServer()],
};

/**
 * Calls Claude with the given MCP servers attached and returns the final
 * text reply. Throws on HTTP errors so callers can show a friendly message.
 *
 * @param {Object} opts
 * @param {string} opts.system - System prompt steering what Claude should do.
 * @param {string} opts.prompt - The user-facing request/question.
 * @param {Array}  opts.servers - MCP server configs, e.g. SERVERS.patch.
 * @param {number} [opts.maxTokens]
 */
export async function askClaude({ system, prompt, servers, maxTokens = 1200 }) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      // Required header while the MCP connector feature is in beta.
      'anthropic-beta': 'mcp-client-2025-04-04',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: prompt }],
      mcp_servers: servers,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Anthropic API ${res.status}: ${body.slice(0, 500)}`);
  }

  const data = await res.json();

  // Response content is a mix of text / mcp_tool_use / mcp_tool_result blocks.
  // We only surface the text blocks to Discord; tool activity is available
  // in `data.content` if you want to log it.
  const text = data.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();

  return text || '_(Claude returned no text — check the raw response/logs.)_';
}
