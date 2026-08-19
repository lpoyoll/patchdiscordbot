# Patch + Madgicx Discord Bot

## Status

`.env` in this zip is pre-filled with your Madgicx credentials. Everything
else is still blank — these can only come from your own accounts, so I can't
fill them in for you:

- [ ] `DISCORD_TOKEN` / `DISCORD_CLIENT_ID` — Discord Developer Portal (step 1)
- [ ] `ANTHROPIC_API_KEY` — Anthropic Console (step 2)
- [ ] `PATCH_MCP_TOKEN` — Patch's own settings (step 3)
- [x] `MADGICX_MCP_TOKEN` / `MADGICX_CLIENT_ID` — already in `.env`

Once those three are filled in, run steps 4-6 below and it's live.


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

Both Patch and Madgicx expose their MCP servers behind OAuth (I confirmed
this for Patch — `claimyourpatch.com/mcp` returns a 401 with an OAuth
challenge if you hit it unauthenticated). OAuth is normally an interactive,
browser-based flow, which doesn't fit a headless bot process cleanly. You've
got two realistic options and I don't know which Patch/Madgicx support
without you checking:

**Option A — long-lived token, if either service offers one.** Check Patch's
own admin/integrations settings and Madgicx's developer/API settings for a
"personal access token" or "service account token" you can generate once and
drop straight into `PATCH_MCP_TOKEN` / `MADGICX_MCP_TOKEN` in `.env`. This is
the clean option if it exists.

**Option B — reuse a session token.** Some MCP servers issue a token once you
complete the OAuth flow through an existing client (e.g. connecting it in
claude.ai) that you can then copy out and reuse, though these are often
short-lived and meant to be refreshed, not hardcoded. If this is the only
route, you'll want to add token-refresh handling before relying on it — the
code here assumes a token that's just valid, and won't refresh one for you.

Either way, the code is already wired for it — `src/claude.js` reads
`PATCH_MCP_TOKEN` / `MADGICX_MCP_TOKEN` from the environment and sends them
as the bearer token for each MCP server. You just need to get a real value
into `.env`.

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
