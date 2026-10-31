import type { AddressInfo } from 'node:net';
import express from 'express';
import { describe, expect, it } from 'vitest';
import { pagesRouter } from '../src/pages.js';
import { testConfig } from './helpers/config.js';

async function get(path: string) {
  const app = express();
  app.use(pagesRouter(testConfig()));
  const server = app.listen(0);
  const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`);
  const body = await res.text();
  server.close();
  return { status: res.status, body, type: res.headers.get('content-type') };
}

describe('public pages', () => {
  it('home has an Add to Slack link and links to privacy and terms', async () => {
    const r = await get('/');
    expect(r.status).toBe(200);
    expect(r.type).toContain('text/html');
    expect(r.body).toContain('https://app.test/slack/install');
    expect(r.body).toContain('href="/privacy"');
    expect(r.body).toContain('href="/terms"');
  });

  it('privacy policy explains score visibility, storage, retention and deletion', async () => {
    const r = await get('/privacy');
    expect(r.status).toBe(200);
    for (const phrase of [/never shown to anyone else/i, /encrypted/i, /35 days/i, /disconnect/i, /Google API Services User Data Policy/i]) {
      expect(r.body).toMatch(phrase);
    }
  });

  it('terms page exists', async () => {
    const r = await get('/terms');
    expect(r.status).toBe(200);
    expect(r.body).toMatch(/not medical advice/i);
  });
});
