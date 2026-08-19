import 'dotenv/config';
import { Client, GatewayIntentBits, Partials, Events } from 'discord.js';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { askClaude, SERVERS } from './claude.js';
import { scheduleDigest } from './digest.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- Load slash commands ---
const commands = new Map();
const commandsDir = path.join(__dirname, 'commands');
for (const file of readdirSync(commandsDir).filter((f) => f.endsWith('.js'))) {
  const mod = await import(`./commands/${file}`);
  commands.set(mod.data.name, mod);
}

// --- Client ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

client.once(Events.ClientReady, (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  scheduleDigest(client);
});

// Slash commands
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const command = commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(`Error in /${interaction.commandName}:`, err);
    const payload = { content: 'Something broke handling that — check the logs.', ephemeral: true };
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(payload);
    } else {
      await interaction.reply(payload);
    }
  }
});

// @mention fallback — free-text, routed through both MCP servers like /ask
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (!client.user || !message.mentions.has(client.user)) return;

  const question = message.content.replace(/<@!?\d+>/g, '').trim();
  if (!question) return;

  await message.channel.sendTyping();

  try {
    const text = await askClaude({
      system:
        'You are a terse ops assistant in a Discord channel for a marketing agency. You have ' +
        'access to Patch (CRM, pipeline, invoicing, revenue) and Madgicx (ad performance) MCP ' +
        'tools — use whichever fit the question. Format with Discord markdown (bold, bullet ' +
        'points) — never headers (#). Be direct; skip preamble.',
      prompt: question,
      servers: SERVERS.both,
      maxTokens: 1500,
    });
    await message.reply(text.slice(0, 1900));
  } catch (err) {
    console.error(err);
    await message.reply(`Something went wrong: ${err.message.slice(0, 300)}`);
  }
});

client.login(process.env.DISCORD_TOKEN);
