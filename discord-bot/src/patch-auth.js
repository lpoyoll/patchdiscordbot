import 'dotenv/config';

// Patch is a Lovable app running on this Supabase project. Its own login
// page authenticates against Supabase's standard auth API (not the OAuth
// 2.1 / dynamic-client-registration surface some MCP servers front their
// resource with) — this does the same thing a human login does: email +
// password, plus the project's public "apikey" header.
const SUPABASE_URL = process.env.PATCH_SUPABASE_URL || 'https://krvxxdjohlegkddpseyk.supabase.co';
const SUPABASE_ANON_KEY = process.env.PATCH_SUPABASE_ANON_KEY;

const TOKEN_URL = `${SUPABASE_URL}/auth/v1/token`;

// Refresh this many seconds before actual expiry.
const EXPIRY_SAFETY_MARGIN_SECONDS = 60;

let cachedToken = null; // { accessToken, refreshToken, expiresAt }
let inFlightAuth = null; // dedupe concurrent sign-ins/refreshes

/**
 * Gets a bearer token for the Patch MCP server, signing in with a dedicated
 * bot account (PATCH_BOT_EMAIL / PATCH_BOT_PASSWORD) via Supabase's standard
 * password grant, and refreshing it automatically before it expires. Falls
 * back to a static PATCH_MCP_TOKEN if no bot credentials are configured.
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

  if (!SUPABASE_ANON_KEY) {
    throw new Error('PATCH_SUPABASE_ANON_KEY is not set — required alongside PATCH_BOT_EMAIL/PASSWORD.');
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

async function signIn(email, password) {
  const res = await fetch(`${TOKEN_URL}?grant_type=password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Patch sign-in failed (${res.status}): ${text.slice(0, 400)}`);
  }

  const data = await res.json();
  cacheToken(data);
  return cachedToken.accessToken;
}

async function refresh(refreshToken) {
  const res = await fetch(`${TOKEN_URL}?grant_type=refresh_token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Patch token refresh failed (${res.status}): ${text.slice(0, 400)}`);
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
