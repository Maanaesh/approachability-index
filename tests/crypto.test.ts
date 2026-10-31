import { describe, expect, it } from 'vitest';
import { decrypt, encrypt } from '../src/crypto.js';

const k = Buffer.alloc(32, 1);
const other = Buffer.alloc(32, 2);

describe('token crypto', () => {
  it('round-trips', () => {
    expect(decrypt(encrypt('tok', k), k)).toBe('tok');
  });

  it('uses a random IV', () => {
    expect(encrypt('tok', k)).not.toBe(encrypt('tok', k));
  });

  it('rejects a tampered blob', () => {
    const buf = Buffer.from(encrypt('tok', k), 'base64');
    buf[buf.length - 1] ^= 1;
    expect(() => decrypt(buf.toString('base64'), k)).toThrow();
  });

  it('rejects the wrong key', () => {
    expect(() => decrypt(encrypt('tok', k), other)).toThrow();
  });
});
