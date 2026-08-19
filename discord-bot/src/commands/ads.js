import { SlashCommandBuilder } from 'discord.js';
import { askClaude, BACKEND } from '../claude.js';

export const data = new SlashCommandBuilder()
  .setName('ads')
  .setDescription('Ad performance summary from Madgicx')
  .addStringOption((opt) =>
    opt
      .setName('client')
      .setDescription('Client/account name to filter to (leave blank for all accounts)')
      .setRequired(false),
  )
  .addStringOption((opt) =>
    opt
      .setName('window')
      .setDescription("Time window, e.g. 'last 7 days', 'this month' (default: last 7 days)")
      .setRequired(false),
  );

export async function execute(interaction) {
  await interaction.deferReply();
  const client = interaction.options.getString('client');
  const window = interaction.options.getString('window') ?? 'last 7 days';

  const scope = client ? `for the account "${client}"` : 'across all connected ad accounts';

  try {
    const text = await askClaude({
      system:
        'You are a terse ops assistant posting into a Discord channel. Use the Madgicx MCP tools ' +
        'to answer with real figures — spend, results/leads, cost-per-result, and any notable ' +
        'over/under-pacing. Format with Discord markdown (bold, bullet points) — never headers (#). ' +
        'If a figure is unavailable from the tools, say so rather than estimating it.',
      prompt: `Pull ad performance ${scope} for ${window} and present it compactly.`,
      backend: BACKEND.madgicx,
    });
    await interaction.editReply(text.slice(0, 1900));
  } catch (err) {
    console.error(err);
    await interaction.editReply(`Couldn't reach Madgicx: ${err.message.slice(0, 300)}`);
  }
}
