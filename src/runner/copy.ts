import type { ProviderId } from '../providers/types.js';

const NAMES: Record<ProviderId, string> = { whoop: 'WHOOP', fitbit: 'Fitbit' };

export function reconnectMessage(provider: ProviderId): { text: string; blocks: unknown[] } {
  const text =
    provider === 'fitbit'
      ? 'weekly vibe check-in: reconnect your Fitbit to keep the vibes flowing ✨'
      : 'reconnect your WHOOP to keep the vibes flowing ✨';
  return {
    text,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text } },
      {
        type: 'actions',
        elements: [{ type: 'button', action_id: `reconnect_${provider}`, text: { type: 'plain_text', text: `Reconnect ${NAMES[provider]}` }, style: 'primary' }],
      },
    ],
  };
}
