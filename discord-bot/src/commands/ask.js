import { SlashCommandBuilder } from 'discord.js';
import { askClaude, SERVERS } from '../claude.js';

export const data = new SlashCommandBuilder()
  .setName('ask')
  .setDescription('Ask anything — Claude will pick the right tools from Patch and/or Madgicx')
  .addStringOption((opt) =>
    opt.setName('question').setDescription('Your question').setRequired(true),
  );

export async function execute(interaction) {
  await interaction.deferReply();
  const question = interaction.options.getString('question');

  try {
    const text = await askClaude({
      system:
        'You are a terse ops assistant posting into a Discord channel for a marketing agency. ' +
        'You have access to Patch (CRM, pipeline, invoicing, revenue) and Madgicx (ad performance) ' +
        'MCP tools — use whichever fit the question, or both. Format with Discord markdown ' +
        '(bold, bullet points) — never headers (#). Be direct; skip preamble.',
      prompt: question,
      servers: await SERVERS.both(),
      maxTokens: 1500,
    });
    await interaction.editReply(text.slice(0, 1900));
  } catch (err) {
    console.error(err);
    await interaction.editReply(`Something went wrong: ${err.message.slice(0, 300)}`);
  }
}
