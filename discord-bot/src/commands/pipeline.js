import { SlashCommandBuilder } from 'discord.js';
import { askClaude, SERVERS } from '../claude.js';

export const data = new SlashCommandBuilder()
  .setName('pipeline')
  .setDescription('Snapshot of the Patch pipeline: stages, open value, patches, tasks')
  .addBooleanOption((opt) =>
    opt
      .setName('detail')
      .setDescription('Also list the leads currently at proposal_sent')
      .setRequired(false),
  );

export async function execute(interaction) {
  await interaction.deferReply();

  const wantDetail = interaction.options.getBoolean('detail');

  const prompt = wantDetail
    ? 'Call pipeline_summary, then call list_leads filtered to stage=proposal_sent. ' +
      'Present the summary first, then a short bullet list of the proposal_sent leads ' +
      '(name, business, town, trade only). Keep it compact — this is going into Discord.'
    : 'Call pipeline_summary and present the result as a compact, clearly formatted summary. ' +
      'This is going straight into a Discord message — no preamble, no markdown headers.';

  try {
    const text = await askClaude({
      system:
        'You are a terse ops assistant posting into a Discord channel. Use the Patch MCP tools ' +
        'to answer. Format with Discord markdown (bold, bullet points) — never headers (#).',
      prompt,
      servers: SERVERS.patch,
    });
    await interaction.editReply(text.slice(0, 1900));
  } catch (err) {
    console.error(err);
    await interaction.editReply(`Couldn't reach Patch: ${err.message.slice(0, 300)}`);
  }
}
