import { describe, expect, it } from 'vitest';
import { canWriteStatus } from '../../src/status/decision.js';

const ours = { emoji: 'sparkles', text: 'main character energy — ping me' };

describe('canWriteStatus', () => {
  it('writes over an empty status', () => {
    expect(canWriteStatus({ emoji: '', text: '' }, null)).toBe(true);
  });
  it('writes over our own previous status', () => {
    expect(canWriteStatus(ours, ours)).toBe(true);
  });
  it('treats Slack-normalized echoes of our status as ours', () => {
    expect(canWriteStatus({ emoji: ':sparkles:', text: ' main character energy — ping me ' }, ours)).toBe(true);
  });
  it('leaves a manual status alone', () => {
    expect(canWriteStatus({ emoji: 'palm_tree', text: 'on vacation' }, null)).toBe(false);
  });
  it('leaves it alone when only the text changed', () => {
    expect(canWriteStatus({ emoji: 'sparkles', text: 'in a meeting' }, ours)).toBe(false);
  });
  it('leaves an emoji-only manual status alone', () => {
    expect(canWriteStatus({ emoji: 'calendar', text: '' }, ours)).toBe(false);
  });
});
