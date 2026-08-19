# Patch + Madgicx Discord Bot

## Status

`.env` in this zip has your Madgicx `MADGICX_CLIENT_ID` pre-filled. Everything
else is still blank — these can only come from your own accounts, so I can't
fill them in for you:

- [ ] `DISCORD_TOKEN` / `DISCORD_CLIENT_ID` — Discord Developer Portal (step 1)
- [ ] `ANTHROPIC_API_KEY` — Anthropic Console (step 2)
- [ ] `MADGICX_CLIENT_SECRET` — Madgicx dashboard → Workspace Settings → MCP
  Integration, next to the Client ID (see step 3a)
- [x] `MADGICX_CLIENT_ID` — already in `.env`
- [x] `PATCH_BOT_EMAIL` / `PATCH_BOT_PASSWORD` — already in `.env`, but
  **unverified** — see step 3b before you rely on this in production.

Once the first three are filled in, run steps 4-6 below and it's live.


A Discord bot that answers questions and posts digests by calling Claude with
the **Patch** and **Madgicx** MCP servers attached — Claude picks the right
tools, the bot just relays the reply into Discord.

## What it gives you

- `/pipeline` — Patch pipeline snapshot (add `detail:true` to include the
  leads sitting at `proposal_sent`)
- `/revenue` — Patch MRR / run rate / spend, with an optional `months` window
- `/ads` — Madgicx ad performance, optionally filtered by client/window
- `/ask <question>` — free text, routed to whichever tools (Patch, Madgicx,
  or both) fit the question
- **@mention the bot** anywhere — same as `/ask`, conversational
- **Scheduled digest** (optional) — posts a pipeline + ad performance summary
  into a channel on a cron schedule (default: weekday mornings)

This is a real always-on process (Discord bots hold a persistent websocket
connection), so it needs to run somewhere that stays up — not a serverless
function or an artifact. See **Deploying** below.

## 1. Discord setup

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**.
2. **Bot** tab → **Reset Token** → copy it → `DISCORD_TOKEN`.
3. On the same **Bot** tab, enable **Message Content Intent** (needed for the
   @mention fallback).
4. **OAuth2 → General** → copy **Client ID** → `DISCORD_CLIENT_ID`.
5. **OAuth2 → URL Generator** → scopes: `bot`, `applications.commands` →
   permissions: `Send Messages`, `Read Message History`, `Use Slash Commands`
   → open the generated URL and invite it to your server.
6. (Optional, for instant command updates while you're testing) right-click
   your server icon → **Copy Server ID** → `DISCORD_GUILD_ID`. Leave this
   blank once you're happy — global commands just take up to an hour to
   propagate the first time.

## 2. Anthropic

Get an API key from the [Anthropic Console](https://console.anthropic.com/)
→ `ANTHROPIC_API_KEY`. This is a separate, billed-per-use API key — not your
claude.ai login.

## 3. MCP server tokens — the part that needs your input

### 3a. Madgicx — Client ID / Client Secret (already wired up)

Madgicx's MCP servers support a client-credentials flow for non-interactive
clients like this bot (see their "Other MCP Clients → Option 2" docs).
`src/madgicx-auth.js` implements it:

1. Go to your Madgicx dashboard → **Workspace Settings → MCP Integration**
   and copy the **Client ID** and **Client Secret** (the same pair authorizes
   both the Facebook Ads and Google Ads MCP servers).
2. Put them in `.env` as `MADGICX_CLIENT_ID` and `MADGICX_CLIENT_SECRET`.
3. That's it — on each request, `madgicx-auth.js` exchanges those for a
   short-lived access token via `POST https://app.madgicx.com/o/token/`
   (`grant_type=client_credentials`), caches it, and transparently fetches a
   new one shortly before it expires. No manual token copying needed.

If you'd rather skip client-credentials entirely and paste in a token you
already have some other way, set `MADGICX_MCP_TOKEN` instead and leave the
client ID/secret blank — the code falls back to using that directly as the
bearer token, but then *you're* responsible for refreshing it before it
expires.

### 3b. Patch — dedicated bot login (unverified — read this)

Patch is a Lovable-built app, so its MCP server is behind OAuth backed by
whatever auth provider Lovable wired up (commonly Supabase). Rather than a
manually-issued token, this uses a **dedicated bot account**: create a
separate Patch login just for the bot (don't reuse your own), and
`src/patch-auth.js` signs in as that user and refreshes the session
automatically. Set `PATCH_BOT_EMAIL` / `PATCH_BOT_PASSWORD` in `.env`.

**Important caveat:** I built `patch-auth.js` without network access to
`claimyourpatch.com` — I couldn't reach the domain to inspect its actual
login endpoint. So the token-endpoint discovery follows the MCP/OAuth spec
convention (read the 401 challenge on `/mcp`, follow it to protected-resource
metadata, then to the authorization server's own metadata for the real
`token_endpoint`), then does a standard `grant_type=password` exchange.
This is spec-compliant, but I have **not** confirmed Patch's server actually
implements resource-owner-password-credentials — some OAuth setups only
support the interactive browser flow, which a bot can't do at all.

If it doesn't work on first run: `npm start` will throw an error that
includes the token endpoint it tried and the response body — that tells you
immediately what's wrong. Two ways to fix it without more code changes:

- If the discovered endpoint is wrong, set `PATCH_TOKEN_ENDPOINT` in `.env`
  directly to override discovery, once you find the real one (check your
  browser's Network tab while logging into claimyourpatch.com, and copy the
  request URL that fires on submit).
- If Patch flatly doesn't support password grant, you're back to needing a
  manually-issued long-lived token — check Patch's own admin/integrations
  settings for one and drop it into `PATCH_MCP_TOKEN` instead (leave
  `PATCH_BOT_EMAIL`/`PATCH_BOT_PASSWORD` blank so it's used as a fallback).

## 4. Install & configure

```bash
npm install
cp .env.example .env
# fill in .env with the values from steps 1-3
```

## 5. Register the slash commands

```bash
npm run register-commands
```

Re-run this any time you add/change a command file.

## 6. Run it

```bash
npm start
```

## Deploying (so it stays online)

Pick one:
- **Railway / Render / Fly.io** — connect the repo, set the `.env` values as
  environment variables in their dashboard, deploy. Easiest option, free
  tiers exist.
- **A small VPS** — clone the repo, `npm install`, run with `pm2 start src/index.js`
  or a systemd service so it restarts on crash/reboot.
- **Your own machine** — works, but the bot goes offline whenever the
  machine sleeps or the terminal closes.

## Extending it

- New slash command → add a file to `src/commands/` exporting `data`
  (a `SlashCommandBuilder`) and `execute(interaction)`, then re-run
  `npm run register-commands`.
- Want the digest to include site health or invoice status too? Just expand
  the `prompt` in `src/digest.js` — Claude will pull whatever Patch tools it
  needs.
- Currently every command sends full context to Claude on each call (no
  conversation memory across messages). If you want the @mention flow to
  remember earlier turns in a channel, that needs a small per-channel message
  history buffer added to `index.js` — happy to add that if you want it.
