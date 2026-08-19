import { SlashCommandBuilder } from 'discord.js';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const data = new SlashCommandBuilder()
  .setName('help')
  .setDescription('List every command this bot supports');

export async function execute(interaction) {
  const lines = [];

  // Read every other command file's exported `data` (a SlashCommandBuilder)
  // so this list can't drift out of sync with what's actually registered.
  const files = readdirSync(__dirname)
    .filter((f) => f.endsWith('.js') && f !== 'help.js')
    .sort();

  for (const file of files) {
    const mod = await import(`./${file}`);
    const json = mod.data.toJSON();

    const options = (json.options ?? [])
      .map((opt) => (opt.required ? `<${opt.name}>` : `[${opt.name}]`))
      .join(' ');

    lines.push(`**/${json.name}**${options ? ` \`${options}\`` : ''} — ${json.description}`);
  }

  const text =
    `${lines.join('\n')}\n\n` +
    '**@mention the bot** anywhere with a free-text question — same as `/ask`, ' +
    'routed to whichever tools fit.';

  await interaction.reply({ content: text.slice(0, 1900), ephemeral: true });
}
