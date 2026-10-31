import { normalizeEmoji } from '../bands.js';

export type SlackStatus = { emoji: string; text: string };

// Only write over an empty status or the one we set last time; anything else was set by the user.
export function canWriteStatus(current: SlackStatus, lastSet: SlackStatus | null): boolean {
  const emoji = normalizeEmoji(current.emoji);
  const text = current.text.trim();
  if (!emoji && !text) return true;
  if (!lastSet) return false;
  return emoji === normalizeEmoji(lastSet.emoji) && text === lastSet.text.trim();
}
