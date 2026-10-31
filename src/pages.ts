import { Router } from 'express';
import type { Config } from './config.js';

const UPDATED = '2026-10-31';

function layout(title: string, body: string): string {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>body{font-family:system-ui,sans-serif;max-width:42rem;margin:3rem auto;padding:0 1.25rem;line-height:1.6;color:#1d1c1d}
h1{line-height:1.2}a.btn{display:inline-block;background:#4a154b;color:#fff;padding:.7rem 1.2rem;border-radius:.5rem;text-decoration:none;font-weight:600}
footer{margin-top:3rem;font-size:.9rem;color:#616061}</style>
<body>${body}<footer><a href="/">Home</a> · <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></footer></body></html>`;
}

export function pagesRouter(cfg: Config): Router {
  const router = Router();
  const contact = cfg.supportEmail ? `<a href="mailto:${cfg.supportEmail}">${cfg.supportEmail}</a>` : 'the person who installed this app in your workspace';

  router.get('/', (_req, res) => {
    res.type('html').send(layout('Approachability', `
<h1>Approachability ✨</h1>
<p>Your Slack status, set each morning from your recovery. Teammates see a vibe like “main character energy — ping me” or “low battery mode — be gentle pls”. <strong>They never see your score.</strong></p>
<p>Works with WHOOP and Fitbit. Never overwrites a status you set yourself. Clears itself at midnight.</p>
<p><a class="btn" href="${cfg.publicBaseUrl}/slack/install">Add to Slack</a></p>
<p>Then run <code>/approachability connect</code> in Slack.</p>`));
  });

  router.get('/privacy', (_req, res) => {
    res.type('html').send(layout('Privacy policy — Approachability', `
<h1>Privacy policy</h1>
<p><em>Last updated ${UPDATED}</em></p>
<h2>What Approachability does</h2>
<p>It reads a daily recovery or readiness signal from the wearable you connect, turns it into a band (for example “high”, “mid” or “low”), and sets your Slack status to a matching emoji and line of text.</p>
<h2>Your score stays private</h2>
<p>Your score and health metrics are never shown to anyone else. Teammates only see the status line. You can see your own score with <code>/approachability status</code>, which only you can see. Scores and metrics are never written to logs.</p>
<h2>What we store</h2>
<ul>
<li>Your Slack user and workspace IDs, your timezone, and a Slack token that lets the app set your status.</li>
<li>OAuth tokens for the wearable you connect (WHOOP or Google/Fitbit).</li>
<li>For Fitbit: daily heart rate variability, resting heart rate and minutes asleep, kept for 35 days to compute your personal baseline, then deleted.</li>
<li>For WHOOP: your recovery score is read each morning and not stored.</li>
<li>Your settings (bands, packs, your own status lines) and a daily record of which band was set.</li>
</ul>
<p>All tokens are encrypted at rest (AES-256-GCM).</p>
<h2>What we don't do</h2>
<p>We don't sell or share your data, show ads, or use it for anything other than setting your status. Data is processed only by the app's hosting provider to run the service.</p>
<h2>Google user data</h2>
<p>Approachability's use and transfer of information received from Google APIs adheres to the <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including the Limited Use requirements. Google Health data is used only to compute your daily band.</p>
<h2>Deleting your data</h2>
<p>Run <code>/approachability disconnect</code> in Slack to clear your status, revoke access, and delete everything stored about you. Uninstalling the app from a workspace deletes all data for that workspace.</p>
<h2>Contact</h2>
<p>Questions: ${contact}.</p>`));
  });

  router.get('/terms', (_req, res) => {
    res.type('html').send(layout('Terms — Approachability', `
<h1>Terms of service</h1>
<p><em>Last updated ${UPDATED}</em></p>
<p>Approachability is a free, just-for-fun tool provided as is, without warranties. It sets a playful Slack status from your wearable's data.</p>
<p><strong>It is not medical advice</strong> and isn't a health or diagnostic product. Don't use it to make health decisions.</p>
<p>You can stop at any time with <code>/approachability pause</code> or remove everything with <code>/approachability disconnect</code>. Use it in line with your workspace's policies.</p>
<p>Questions: ${contact}.</p>`));
  });

  return router;
}
