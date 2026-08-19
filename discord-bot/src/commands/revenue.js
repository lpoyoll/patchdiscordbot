import { SlashCommandBuilder } from 'discord.js';
import { askClaude, SERVERS } from '../claude.js';

export const data = new SlashCommandBuilder()
  .setName('revenue')
  .setDescription("Patch's own money picture: MRR, run rate, recent client ad spend")
  .addIntegerOption((opt) =>
    opt
      .setName('months')
      .setDescription('Spend window in months (default 6)')
      .setMinValue(1)
      .setMaxValue(24)
      .setRequired(false),
  );

export async function execute(interaction) {
  await interaction.deferReply();
  const months = interaction.options.getInteger('months') ?? 6;

  try {
    const text = await askClaude({
      system:
        'You are a terse ops assistant posting into a Discord channel. Use the Patch MCP tools ' +
        'to answer. Format with Discord markdown (bold, bullet points) — never headers (#).',
      prompt: `Call revenue_summary with months=${months} and present the result compactly.`,
      servers: SERVERS.patch,
    });
    await interaction.editReply(text.slice(0, 1900));
  } catch (err) {
    console.error(err);
    await interaction.editReply(`Couldn't reach Patch: ${err.message.slice(0, 300)}`);
  }
}
