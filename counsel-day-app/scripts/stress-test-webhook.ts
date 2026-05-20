/**
 * scripts/stress-test-webhook.ts
 *
 * Replays a single Stripe event_id against /api/stripe/webhook N times
 * and confirms only the first replay reaches the handler · subsequent
 * replays should short-circuit via the stripe_webhook_events table's
 * PRIMARY KEY (evt_xxx) conflict.
 *
 * What it verifies: pentest finding 13.2 · idempotency guarantee.
 *
 * Usage (local dev):
 *   npm run dev    # in another terminal · app must be running
 *   STRIPE_WEBHOOK_SECRET=whsec_local_test \
 *     npx tsx scripts/stress-test-webhook.ts http://localhost:3000 100
 *
 * Usage (staging):
 *   STRIPE_WEBHOOK_SECRET=whsec_staging \
 *     npx tsx scripts/stress-test-webhook.ts https://staging.counsel.day 50
 *
 * DO NOT run against prod without checkpointing the audit_log first ·
 * we'll write 1 success row + N-1 idempotent-skip rows.
 *
 * Expected output:
 *   attempt 1   200 OK   {"received":true}
 *   attempt 2   200 OK   {"received":true, "skipped":"already_processed"}
 *   ...
 *   summary: 1 fresh, 99 short-circuits, 0 failures
 */

import { createHmac, randomBytes } from 'node:crypto';

const target = process.argv[2] || 'http://localhost:3000';
const count = Number(process.argv[3] || '100');
const secret = process.env.STRIPE_WEBHOOK_SECRET;

if (!secret) {
  console.error('STRIPE_WEBHOOK_SECRET env var is required.');
  console.error('  For local: use the value from /etc/counsel-day-app/env.local on a non-prod box');
  console.error('  For staging: use the staging webhook signing secret');
  process.exit(2);
}

// Synthesise one event · the same id N times.
const eventId = 'evt_stress_' + randomBytes(8).toString('hex');
const payload = JSON.stringify({
  id: eventId,
  object: 'event',
  type: 'payment_intent.succeeded',
  data: {
    object: {
      id: 'pi_stress_test',
      object: 'payment_intent',
      amount: 999,
      currency: 'usd',
      status: 'succeeded',
      metadata: { stress_test: '1' },
    },
  },
  created: Math.floor(Date.now() / 1000),
  livemode: false,
});

function sign(payload: string, secret: string, timestamp: number): string {
  const signedPayload = `${timestamp}.${payload}`;
  const signature = createHmac('sha256', secret).update(signedPayload).digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

type Result = { attempt: number; status: number; body: string; ms: number };

async function fireOne(attempt: number): Promise<Result> {
  const ts = Math.floor(Date.now() / 1000);
  const sig = sign(payload, secret!, ts);
  const start = Date.now();
  const res = await fetch(`${target}/api/stripe/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': sig },
    body: payload,
  });
  const body = await res.text();
  return { attempt, status: res.status, body: body.slice(0, 200), ms: Date.now() - start };
}

async function main() {
  console.log(`stress-test-webhook · target=${target} · count=${count} · eventId=${eventId}`);
  console.log('---');
  let fresh = 0;
  let skipped = 0;
  let failed = 0;
  for (let i = 1; i <= count; i++) {
    try {
      const r = await fireOne(i);
      if (r.status >= 200 && r.status < 300) {
        if (i === 1) fresh++; else skipped++;
        console.log(`  attempt ${String(i).padStart(3)} · ${r.status} · ${r.ms.toString().padStart(4)}ms · ${r.body}`);
      } else {
        failed++;
        console.warn(`  attempt ${String(i).padStart(3)} · ${r.status} · ${r.body}`);
      }
    } catch (err) {
      failed++;
      console.warn(`  attempt ${i} · network error · ${(err as Error).message}`);
    }
  }
  console.log('---');
  console.log(`summary: ${fresh} fresh, ${skipped} short-circuits, ${failed} failures`);
  if (failed > 0 || fresh !== 1) {
    process.exit(1);
  }
  process.exit(0);
}

main();
