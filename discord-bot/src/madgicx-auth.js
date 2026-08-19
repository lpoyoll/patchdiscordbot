import 'dotenv/config';

const TOKEN_URL = 'https://app.madgicx.com/o/token/';
const SCOPE = 'mcp:read mcp:write';

// Refresh this many seconds before actual expiry, to avoid races where a
// request goes out with a token that expires mid-flight.
const EXPIRY_SAFETY_MARGIN_SECONDS = 60;

let cachedToken = null; // { accessToken, expiresAt } — expiresAt is epoch ms
let inFlightRefresh = null; // dedupe concurrent refreshes

/**
 * Exchanges MADGICX_CLIENT_ID / MADGICX_CLIENT_SECRET for a short-lived
 * access token via the OAuth client_credentials grant, per Madgicx's
 * "Other MCP Clients" docs:
 * https://mcp.madgicx.com docs -> Option 2: Client ID / Client Secret
 *
 * Caches the token and transparently refreshes it before it expires.
 * Falls back to MADGICX_MCP_TOKEN (a manually-issued static token) if no
 * client id/secret pair is configured, for backwards compatibility.
 */
export async function getMadgicxAccessToken() {
  const clientId = process.env.MADGICX_CLIENT_ID;
  const clientSecret = process.env.MADGICX_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    if (process.env.MADGICX_MCP_TOKEN) return process.env.MADGICX_MCP_TOKEN;
    throw new Error(
      'Madgicx auth not configured — set MADGICX_CLIENT_ID + MADGICX_CLIENT_SECRET ' +
        '(preferred) or MADGICX_MCP_TOKEN.',
    );
  }

  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt - EXPIRY_SAFETY_MARGIN_SECONDS * 1000 > now) {
    return cachedToken.accessToken;
  }

  // If a refresh is already underway (e.g. two commands fire at once right
  // as the token expires), reuse it instead of hitting the token endpoint twice.
  if (!inFlightRefresh) {
    inFlightRefresh = fetchNewToken(clientId, clientSecret).finally(() => {
      inFlightRefresh = null;
    });
  }
  return inFlightRefresh;
}

async function fetchNewToken(clientId, clientSecret) {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope: SCOPE,
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Madgicx token exchange failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  const expiresInSeconds = data.expires_in ?? 3600;

  cachedToken = {
    accessToken: data.access_token,
    expiresAt: Date.now() + expiresInSeconds * 1000,
  };

  return cachedToken.accessToken;
}
