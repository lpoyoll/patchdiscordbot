import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const commandsDir = path.join(__dirname, 'commands');

const commands = [];
for (const file of readdirSync(commandsDir).filter((f) => f.endsWith('.js'))) {
  const mod = await import(`./commands/${file}`);
  commands.push(mod.data.toJSON());
}

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

const route = process.env.DISCORD_GUILD_ID
  ? Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID)
  : Routes.applicationCommands(process.env.DISCORD_CLIENT_ID);

console.log(
  `Registering ${commands.length} commands ${
    process.env.DISCORD_GUILD_ID ? `to guild ${process.env.DISCORD_GUILD_ID} (instant)` : 'globally (~1hr to propagate)'
  }...`,
);

await rest.put(route, { body: commands });
console.log('Done:', commands.map((c) => `/${c.name}`).join(', '));
