import 'dotenv/config';
import { getPatchAccessToken } from './patch-auth.js';

const MCP_URL = process.env.PATCH_MCP_URL || 'https://claimyourpatch.com/mcp';

let rpcId = 0;

async function rpcCall(method, params) {
  const token = await getPatchAccessToken();
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      // Patch's MCP server 406s without both of these present.
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
  });

  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`Patch MCP ${method} failed (${res.status}): ${raw.slice(0, 400)}`);
  }

  const body = parseRpcResponse(raw);
  if (body.error) {
    throw new Error(`Patch MCP ${method} error: ${JSON.stringify(body.error).slice(0, 400)}`);
  }
  return body.result;
}

// The server replies with a Streamable-HTTP/SSE-shaped body ("event: ...\n
// data: {...}\n\n") even for a single response. Pull the JSON out of the
// last "data:" line; fall back to plain JSON in case a deployment ever
// responds without SSE framing.
function parseRpcResponse(raw) {
  const dataLines = raw
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);

  if (dataLines.length > 0) return JSON.parse(dataLines[dataLines.length - 1]);
  return JSON.parse(raw);
}

let cachedTools = null;
let cachedToolsAt = 0;
const TOOLS_CACHE_MS = 5 * 60 * 1000;

/** Returns Patch's tools in Anthropic's tool-schema shape: {name, description, input_schema}. */
export async function listPatchTools() {
  const now = Date.now();
  if (cachedTools && now - cachedToolsAt < TOOLS_CACHE_MS) return cachedTools;

  const result = await rpcCall('tools/list', {});
  cachedTools = (result.tools ?? []).map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  }));
  cachedToolsAt = now;
  return cachedTools;
}

/** Calls a Patch tool and returns { text, isError } ready to hand back to Claude as a tool_result. */
export async function callPatchTool(name, args) {
  const result = await rpcCall('tools/call', { name, arguments: args ?? {} });
  const content = result?.content ?? [];
  const text = content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
  return { text: text || JSON.stringify(result), isError: Boolean(result?.isError) };
}
