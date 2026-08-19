import cron from 'node-cron';
import { askClaude, SERVERS } from './claude.js';

/**
 * Registers a scheduled job that posts a pipeline + ad performance digest
 * into DIGEST_CHANNEL_ID. No-op if that env var isn't set.
 */
export function scheduleDigest(client) {
  const channelId = process.env.DIGEST_CHANNEL_ID;
  if (!channelId) {
    console.log('DIGEST_CHANNEL_ID not set — scheduled digest disabled.');
    return;
  }

  const cronExpr = process.env.DIGEST_CRON || '30 8 * * 1-5';

  cron.schedule(cronExpr, async () => {
    console.log('Running scheduled digest...');
    try {
      const channel = await client.channels.fetch(channelId);

      const text = await askClaude({
        system:
          'You write a short daily ops digest for a Discord channel, for a marketing agency ' +
          'that sells website/SEO/ads retainers to tradespeople. Use the Patch and Madgicx MCP ' +
          'tools. Format with Discord markdown (bold, bullet points) — never headers (#). ' +
          'Keep it skimmable: pipeline snapshot, then a one-line ad performance note if anything ' +
          'stands out (over/under spend, notably good or bad cost-per-result). No preamble.',
        prompt:
          'Pull pipeline_summary and a quick ad performance check across connected accounts ' +
          '(last 24-48h), then write the digest.',
        servers: SERVERS.both,
        maxTokens: 1000,
      });

      await channel.send(`**Morning digest**\n${text.slice(0, 1800)}`);
    } catch (err) {
      console.error('Digest job failed:', err);
    }
  });

  console.log(`Scheduled digest registered: "${cronExpr}" -> channel ${channelId}`);
}
