import 'dotenv/config';

const MCP_URL = process.env.PATCH_MCP_URL || 'https://claimyourpatch.com/mcp';

// Refresh this many seconds before actual expiry.
const EXPIRY_SAFETY_MARGIN_SECONDS = 60;

let cachedToken = null; // { accessToken, refreshToken, expiresAt }
let inFlightAuth = null; // dedupe concurrent sign-ins/refreshes

/**
 * Gets a bearer token for the Patch MCP server, signing in with a dedicated
 * bot account (PATCH_BOT_EMAIL / PATCH_BOT_PASSWORD) and refreshing it
 * automatically before it expires. Falls back to a static PATCH_MCP_TOKEN
 * if no bot credentials are configured.
 *
 * IMPORTANT — this was built without being able to reach claimyourpatch.com
 * from the environment this code was written in (network egress blocked the
 * domain), so the OAuth discovery + password-grant flow below follows the
 * MCP/OAuth spec conventions (RFC 9728 protected-resource metadata, RFC 8414
 * authorization-server metadata, resource-owner-password-credentials grant)
 * but has NOT been verified against the live server. If sign-in fails, the
 * error message will include the token endpoint it tried and the response
 * body — that's the fastest way to see what actually needs to change. You
 * can also skip discovery entirely by setting PATCH_TOKEN_ENDPOINT directly
 * if you find the real login endpoint (e.g. from your browser's Network tab
 * while logging into claimyourpatch.com).
 */
export async function getPatchAccessToken() {
  const email = process.env.PATCH_BOT_EMAIL;
  const password = process.env.PATCH_BOT_PASSWORD;

  if (!email || !password) {
    if (process.env.PATCH_MCP_TOKEN) return process.env.PATCH_MCP_TOKEN;
    throw new Error(
      'Patch auth not configured — set PATCH_BOT_EMAIL + PATCH_BOT_PASSWORD ' +
        '(preferred) or PATCH_MCP_TOKEN.',
    );
  }

  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt - EXPIRY_SAFETY_MARGIN_SECONDS * 1000 > now) {
    return cachedToken.accessToken;
  }

  if (!inFlightAuth) {
    const task = cachedToken?.refreshToken
      ? refresh(cachedToken.refreshToken).catch(() => signIn(email, password))
      : signIn(email, password);
    inFlightAuth = task.finally(() => {
      inFlightAuth = null;
    });
  }
  return inFlightAuth;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetching ${url} failed: ${res.status} ${res.statusText}`);
  return res.json();
}

/**
 * Discovers the OAuth token endpoint for the Patch MCP server per the MCP
 * authorization spec: an unauthenticated request gets a 401 whose
 * WWW-Authenticate header (or a well-known fallback path) points to
 * protected-resource metadata, which lists the authorization server, whose
 * own metadata document gives the real token_endpoint.
 */
async function discoverTokenEndpoint() {
  if (process.env.PATCH_TOKEN_ENDPOINT) return process.env.PATCH_TOKEN_ENDPOINT;

  const mcpOrigin = new URL(MCP_URL).origin;

  const probe = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'patch-auth-discovery', version: '0.1' },
      },
    }),
  });

  let resourceMetadataUrl = `${mcpOrigin}/.well-known/oauth-protected-resource`;
  const authHeader = probe.headers.get('www-authenticate') || '';
  const match = authHeader.match(/resource_metadata="([^"]+)"/);
  if (match) resourceMetadataUrl = match[1];

  const resourceMeta = await fetchJson(resourceMetadataUrl);
  const authServer = resourceMeta.authorization_servers?.[0];
  if (!authServer) {
    throw new Error(
      `Could not find an authorization server in Patch's protected-resource metadata ` +
        `(${resourceMetadataUrl}). Set PATCH_TOKEN_ENDPOINT directly instead.`,
    );
  }

  const authServerMetaUrl = `${authServer.replace(/\/$/, '')}/.well-known/oauth-authorization-server`;
  const authServerMeta = await fetchJson(authServerMetaUrl);
  if (!authServerMeta.token_endpoint) {
    throw new Error(
      `Patch's authorization server metadata (${authServerMetaUrl}) has no token_endpoint. ` +
        `Set PATCH_TOKEN_ENDPOINT directly instead.`,
    );
  }
  return authServerMeta.token_endpoint;
}

async function signIn(email, password) {
  const tokenEndpoint = await discoverTokenEndpoint();
  const body = new URLSearchParams({
    grant_type: 'password',
    username: email,
    password,
  });

  const res = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `Patch sign-in failed at ${tokenEndpoint} (${res.status}): ${text.slice(0, 400)}`,
    );
  }

  const data = await res.json();
  cacheToken(data);
  return cachedToken.accessToken;
}

async function refresh(refreshToken) {
  const tokenEndpoint = await discoverTokenEndpoint();
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  const res = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Patch token refresh failed at ${tokenEndpoint} (${res.status}): ${text.slice(0, 400)}`);
  }

  const data = await res.json();
  cacheToken(data, refreshToken);
  return cachedToken.accessToken;
}

function cacheToken(data, previousRefreshToken) {
  const expiresInSeconds = data.expires_in ?? 3600;
  cachedToken = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? previousRefreshToken,
    expiresAt: Date.now() + expiresInSeconds * 1000,
  };
}
