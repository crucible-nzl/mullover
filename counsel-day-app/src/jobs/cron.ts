/**
 * Single Node entrypoint for every periodic background job. Started by a
 * systemd timer (or a `* * * * * node …` style cron). Each job is a pure
 * function that takes the DB and returns a summary. The script picks which
 * to run based on argv[2]:
 *
 *   node dist/cron.js evening-prompt    · send 6pm reminder to participants who have not voted today
 *   node dist/cron.js verdict-generate  · for every decision past unseals_at, generate verdict + email
 *   node dist/cron.js session-purge     · delete expired session rows
 *
 * For now: dev runs via `tsx src/jobs/cron.ts <job>`.
 */

import 'dotenv/config';
import { db, schema } from '../lib/db';
import { sql, and, eq, lt, isNull, isNotNull, inArray } from 'drizzle-orm';
import { sendTransactional } from '../lib/email';
import { sendPushToUser } from '../lib/push';
import { getAnthropic, VERDICT_MODEL, VERDICT_SYSTEM_PROMPT } from '../lib/anthropic';
import { callAnthropic } from '../lib/anthropic-call';
import { resolvePrompt } from '../lib/prompts';
import { runSecurityAudit, type AuditSnapshot } from '../lib/security-audit';
import { narrateVerdict } from '../lib/tts';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

const APP_BASE_URL = process.env.APP_BASE_URL ?? 'https://counsel.day';

async function eveningPrompt() {
  // Find every participant in an active decision who has not voted today.
  // Send them one prompt. Idempotent · re-running the same evening is fine.
  // We also pull user_id so the push helper can target their subscriptions
  // alongside the email · the user sees whichever channel they have opted
  // into (typically both: email always, push if they enabled it on the app).
  const rows = await db.execute(sql`
    SELECT DISTINCT u.id AS user_id, u.email, u.first_name, d.id AS decision_id, d.question
    FROM participants p
    JOIN decisions d ON d.id = p.decision_id
    JOIN users u ON u.id = p.user_id
    WHERE d.status = 'active'
      AND p.user_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM votes v
        WHERE v.participant_id = p.id
          AND v.vote_date = CURRENT_DATE
      )
  `);

  let sent = 0;
  let pushed = 0;
  for (const r of rows as unknown as Array<{ user_id: string; email: string; first_name: string | null; decision_id: string; question: string }>) {
    const verdictUrl = `${APP_BASE_URL}/vote-today?decision=${r.decision_id}`;
    const greeting = r.first_name ? `Hi ${r.first_name},` : 'Hi,';
    const text = [
      greeting,
      '',
      'Time for tonight\'s vote.',
      '',
      `> ${r.question}`,
      '',
      'One tap, optional sentence, sealed instantly:',
      verdictUrl,
      '',
      '· Counsel.day',
    ].join('\n');
    const html = `
      <p>${greeting}</p>
      <p>Time for tonight's vote.</p>
      <blockquote style="border-left: 3px solid #722F37; padding-left: 14px; margin: 16px 0; font-style: italic;">${r.question}</blockquote>
      <p>One tap, optional sentence, sealed instantly: <a href="${verdictUrl}" style="color: #722F37;">${verdictUrl}</a></p>
      <p>· Counsel.day</p>
    `.trim();
    const res = await sendTransactional({
      to: { email: r.email, name: r.first_name ?? undefined },
      subject: 'Tonight\'s vote',
      textContent: text,
      htmlContent: html,
    });
    if (res.ok) sent++;

    // Push notification · best-effort, never blocks the email send.
    // Truncated to the brand voice · "Decide slowly" reinforces the product.
    const pushRes = await sendPushToUser(r.user_id, {
      title: 'Tonight\'s vote is ready',
      body: r.question.length > 140 ? r.question.slice(0, 137) + '...' : r.question,
      url: `/vote-today.html?decision=${r.decision_id}`,
      tag: `vote-today-${r.decision_id}`,
      renotify: false,
    }).catch(() => ({ sent: 0 } as { sent: number }));
    pushed += pushRes.sent ?? 0;
  }
  console.log(`[cron · evening-prompt] sent ${sent} emails, ${pushed} push notifications`);
}

/**
 * Split the Anthropic verdict output into prose vs the fenced JSON
 * appendix introduced in prompt v5. Returns the prose with the JSON
 * block removed, plus the parsed object (or null if absent/malformed).
 * Falls back gracefully · if the model omits the block, the prose
 * still ships and the structured panels degrade to spaCy-derived
 * themes from the Python analysis layer.
 */
function splitVerdictOutput(raw: string): {
  prose: string;
  structured: { themes?: unknown[]; asymmetries?: unknown[]; key_quotes?: unknown[] } | null;
} {
  const match = raw.match(/```(?:json)?\s*\n([\s\S]*?)\n```\s*$/);
  if (!match) return { prose: raw.trim(), structured: null };
  const prose = raw.slice(0, match.index).trim();
  try {
    const parsed = JSON.parse(match[1]);
    if (parsed && typeof parsed === 'object') return { prose, structured: parsed };
  } catch {
    // malformed JSON · keep prose, drop the block silently
  }
  return { prose, structured: null };
}

/**
 * Invoke counsel-day-app/python/analyse_verdict.py with the decision +
 * votes + ai_themes payload on stdin. The script always exits 0 and
 * writes JSON on stdout (errors as { version, error: '...' }), so this
 * helper resolves to whatever it printed. 30-second timeout · the
 * script is short and CPU-bound; if it hangs we move on.
 */
async function runVerdictAnalysis(input: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const scriptPath = process.env.VERDICT_ANALYSIS_SCRIPT
    || join(process.cwd(), 'python', 'analyse_verdict.py');
  const pythonBin = process.env.PYTHON_BIN || 'python3';
  return await new Promise((resolve) => {
    const proc = spawn(pythonBin, [scriptPath], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { proc.kill('SIGKILL'); } catch { /* noop */ }
      console.warn('[cron · verdict-analysis] timeout after 30s');
      resolve(null);
    }, 30_000);
    proc.stdout.on('data', (d) => { stdout += d.toString('utf-8'); });
    proc.stderr.on('data', (d) => { stderr += d.toString('utf-8'); });
    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      console.warn('[cron · verdict-analysis] spawn failed:', err.message);
      resolve(null);
    });
    proc.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        console.warn(`[cron · verdict-analysis] exit ${code}; stderr: ${stderr.slice(0, 500)}`);
        resolve(null);
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        resolve(parsed && typeof parsed === 'object' ? parsed : null);
      } catch (err) {
        console.warn('[cron · verdict-analysis] JSON parse failed:', (err as Error).message);
        resolve(null);
      }
    });
    try {
      proc.stdin.write(JSON.stringify(input));
      proc.stdin.end();
    } catch (err) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      console.warn('[cron · verdict-analysis] stdin write failed:', (err as Error).message);
      resolve(null);
    }
  });
}

async function verdictGenerate() {
  if (!getAnthropic()) {
    console.warn('[cron · verdict-generate] ANTHROPIC_API_KEY not set; skipping');
    return;
  }

  // Decisions ready for verdict: status='active', unseals_at <= NOW(), no verdict yet
  const dueRows = await db
    .select({
      id: schema.decisions.id,
      question: schema.decisions.question,
      format: schema.decisions.format,
      durationDays: schema.decisions.durationDays,
      ownerUserId: schema.decisions.ownerUserId,
    })
    .from(schema.decisions)
    .leftJoin(schema.verdicts, eq(schema.verdicts.decisionId, schema.decisions.id))
    .where(
      and(
        eq(schema.decisions.status, 'active'),
        lt(schema.decisions.unsealsAt, sql`NOW()`),
        isNull(schema.verdicts.id)
      )
    )
    .limit(20); // batch cap per run

  console.log(`[cron · verdict-generate] ${dueRows.length} decisions due`);

  for (const d of dueRows) {
    try {
      // Flip status so we don't double-process if the cron overlaps
      await db
        .update(schema.decisions)
        .set({ status: 'verdict_generating', updatedAt: new Date() })
        .where(eq(schema.decisions.id, d.id));

      // Gather all votes + notes for this decision, grouped by participant
      const voteRows = await db.execute(sql`
        SELECT p.display_name, v.vote_date, v.direction, v.conviction, v.note
        FROM votes v
        JOIN participants p ON p.id = v.participant_id
        WHERE v.decision_id = ${d.id}
        ORDER BY p.position, v.vote_date
      `);

      const userPrompt = JSON.stringify({
        question: d.question,
        format: d.format,
        duration_days: d.durationDays,
        votes: voteRows,
      }, null, 2);

      // Resolve the active verdict system prompt · DB-stored if the
      // operator has saved an override via /admin-prompt-editor, else
      // falls back to the in-code constant. 5-min cache via lib/prompts.
      const verdictSystemPrompt = await resolvePrompt('verdict_synthesis', VERDICT_SYSTEM_PROMPT);
      const call = await callAnthropic(
        { source: 'verdict_cron', decisionId: d.id },
        {
          model: VERDICT_MODEL,
          max_tokens: 2000,
          system: [
            { type: 'text', text: verdictSystemPrompt, cache_control: { type: 'ephemeral' } },
          ],
          messages: [{ role: 'user', content: userPrompt }],
        }
      );
      const msg = call.message;

      const rawOutput = msg.content
        .filter((b) => b.type === 'text')
        .map((b) => (b as { text: string }).text)
        .join('\n');
      const { prose: synthesis, structured } = splitVerdictOutput(rawOutput);

      // Run the Python analysis pass · sentiment, word clouds, themes,
      // vocabulary overlap, asymmetries. Output stored frozen in
      // verdicts.analysis_json and served by /api/verdict-report.
      // Failure here is non-fatal · the verdict still ships with prose
      // only and the report page degrades gracefully.
      const analysis = await runVerdictAnalysis({
        decision: {
          id: d.id,
          question: d.question,
          format: d.format,
          duration_days: d.durationDays,
        },
        participants: (await db.execute(sql`
          SELECT display_name, position FROM participants
          WHERE decision_id = ${d.id} ORDER BY position
        `)),
        votes: voteRows,
        ai_themes: structured?.themes ?? [],
        next_conversation_prompt: null,
      });

      const inserted = await db.insert(schema.verdicts).values({
        decisionId: d.id,
        aiModel: VERDICT_MODEL,
        synthesisText: synthesis,
        themes: (structured?.themes ?? null) as unknown,
        promptUsed: verdictSystemPrompt,
        tokensInput: call.tokensInput,
        tokensOutput: call.tokensOutput,
        // Cost mirrors what callAnthropic just logged to anthropic_calls
        // · single source of truth via lib/anthropic-pricing.ts.
        costCents: call.costCents,
        analysisJson: analysis as unknown,
      }).returning({ id: schema.verdicts.id });
      const verdictId = inserted[0]?.id;

      await db
        .update(schema.decisions)
        .set({ status: 'completed', updatedAt: new Date() })
        .where(eq(schema.decisions.id, d.id));

      // Best-effort TTS narration. Failure here does NOT block verdict
      // delivery · the verdict-reveal page falls back to text-only
      // when tts_audio_url is null. The verdictTts() backfill cron
      // (runs hourly) will retry missing audio.
      if (verdictId && synthesis) {
        try {
          const tts = await narrateVerdict(synthesis, verdictId);
          if (tts.ok) {
            await db
              .update(schema.verdicts)
              .set({ ttsAudioUrl: tts.publicUrl, ttsCostCents: tts.costCents, ttsGeneratedAt: new Date() })
              .where(eq(schema.verdicts.id, verdictId));
            console.log(`[cron · verdict-generate] decision ${d.id}: TTS ok (${tts.bytes}b, $${(tts.costCents/100).toFixed(3)})`);
          } else {
            console.warn(`[cron · verdict-generate] decision ${d.id}: TTS skipped: ${tts.reason}`);
          }
        } catch (err) {
          console.error(`[cron · verdict-generate] decision ${d.id}: TTS threw:`, (err as Error).message);
        }
      }

      // Email + push each participant that their verdict is ready.
      // We pull user_id too so the push helper can target subscriptions.
      // Email is the always-on channel; push is a bonus when the user
      // has installed the PWA and granted notification permission.
      const participantNotify = await db.execute(sql`
        SELECT u.id AS user_id, u.email, u.first_name FROM participants p
        JOIN users u ON u.id = p.user_id
        WHERE p.decision_id = ${d.id} AND p.user_id IS NOT NULL
      `);
      for (const p of participantNotify as unknown as Array<{ user_id: string; email: string; first_name: string | null }>) {
        const greeting = p.first_name ? `Hi ${p.first_name},` : 'Hi,';
        const url = `${APP_BASE_URL}/verdict-reveal?decision=${d.id}`;
        await sendTransactional({
          to: { email: p.email, name: p.first_name ?? undefined },
          subject: 'Your verdict is ready',
          textContent: `${greeting}\n\nYour decision has reached day ${d.durationDays}. Both verdicts are now open:\n\n${url}\n\n· Counsel.day`,
          htmlContent: `<p>${greeting}</p><p>Your decision has reached day ${d.durationDays}. Both verdicts are now open:</p><p><a href="${url}" style="color: #722F37;">${url}</a></p><p>· Counsel.day</p>`,
        });
        // Push fires alongside email · no-op if VAPID not configured
        // or the user hasn't subscribed any device. Audit-log only when
        // the helper actually sent something so the admin can see
        // delivery stats without false positives.
        const pushRes = await sendPushToUser(p.user_id, {
          title: 'Your verdict is ready',
          body: 'Day ' + d.durationDays + ' has arrived. Open the sealed record.',
          url: '/verdict-reveal.html?id=' + d.id,
          tag: 'verdict-' + d.id,
          requireInteraction: false,
        }).catch(() => ({ sent: 0, removed: 0 } as { sent: number; removed: number }));
        if (pushRes.sent > 0) {
          await db.insert(schema.auditLog).values({
            actorUserId: p.user_id,
            action: 'push.sent',
            targetType: 'decision',
            targetId: d.id,
            metadata: { kind: 'verdict_ready', endpoints: pushRes.sent, removed: pushRes.removed ?? 0 },
          }).catch(() => {});
        }
      }
      console.log(`[cron · verdict-generate] decision ${d.id}: verdict written, participants emailed + pushed`);
    } catch (err) {
      console.error(`[cron · verdict-generate] decision ${d.id} failed:`, err);
      // Flip back to 'active' so the next cron run retries it
      await db.update(schema.decisions).set({ status: 'active', updatedAt: new Date() }).where(eq(schema.decisions.id, d.id));
    }
  }
}

/**
 * Backfill TTS narration for any verdict that has synthesis text but
 * no tts_audio_url yet. Catches verdicts where the inline TTS call in
 * verdictGenerate failed (OpenAI hiccup, budget cap, missing key) AND
 * historical verdicts created before TTS shipped.
 *
 * Limit per run: 25 verdicts so a budget runaway can be caught within
 * a single hour (at ~$0.09 per verdict, max $2.25/run). Schedule
 * hourly in cron.
 */
async function verdictTts() {
  const rows = await db
    .select({ id: schema.verdicts.id, synthesisText: schema.verdicts.synthesisText })
    .from(schema.verdicts)
    .where(and(
      isNull(schema.verdicts.ttsAudioUrl),
      isNotNull(schema.verdicts.synthesisText)
    ))
    .limit(25);

  if (rows.length === 0) {
    console.log('[cron · verdict-tts] no verdicts need backfill');
    return;
  }

  let ok = 0;
  let failed = 0;
  for (const v of rows) {
    if (!v.synthesisText) continue;
    try {
      const res = await narrateVerdict(v.synthesisText, v.id);
      if (res.ok) {
        await db
          .update(schema.verdicts)
          .set({ ttsAudioUrl: res.publicUrl, ttsCostCents: res.costCents, ttsGeneratedAt: new Date() })
          .where(eq(schema.verdicts.id, v.id));
        ok += 1;
      } else {
        console.warn(`[cron · verdict-tts] verdict ${v.id}: ${res.reason}`);
        failed += 1;
        // If we hit the budget cap, stop the loop · no point hammering
        if (res.reason.includes('budget')) break;
      }
    } catch (err) {
      console.error(`[cron · verdict-tts] verdict ${v.id} threw:`, (err as Error).message);
      failed += 1;
    }
  }
  console.log(`[cron · verdict-tts] backfilled ${ok}/${rows.length} verdicts (${failed} failed)`);
}

async function sessionPurge() {
  const r = await db.execute(sql`DELETE FROM sessions WHERE expires_at < NOW() RETURNING id`);
  console.log(`[cron · session-purge] deleted ${(r as unknown as Array<unknown>).length} expired sessions`);

  // Also clean up rate_limits rows whose reset_at is more than 24h
  // in the past · the helper resets them lazily on next hit but
  // dead buckets accumulate (IPs that abused us once a month ago
  // and never returned). 24h is well past every window we use.
  const rl = await db.execute(sql`DELETE FROM rate_limits WHERE reset_at < NOW() - INTERVAL '24 hours' RETURNING key`);
  console.log(`[cron · session-purge] pruned ${(rl as unknown as Array<unknown>).length} stale rate_limits rows`);

  // Expired MFA challenges · TTL is 5 min so this catches abandoned flows.
  const mc = await db.execute(sql`DELETE FROM mfa_challenges WHERE expires_at < NOW() RETURNING id`);
  console.log(`[cron · session-purge] deleted ${(mc as unknown as Array<unknown>).length} expired mfa_challenges`);
}

/**
 * Expire stale partner invite tokens.
 *
 * Tokens minted by /api/compose for couple/family decisions sit forever
 * if the invitee never accepts. Two reasons to expire them:
 *   (a) shrink attack surface · a leaked invite URL is forever-valid
 *       until expired (the URL gates account creation for the invitee)
 *   (b) prevent the participants table from growing unbounded with
 *       abandoned invites
 *
 * After EXPIRY_DAYS days, we NULL the invite_token (the URL becomes
 * unusable) and cancel the parent decision if it's still in
 * pending_invites. The owner can re-compose with fresh tokens; any
 * Stripe charge already settled stays put (admin handles refund if
 * the owner asks).
 */
async function inviteExpiry() {
  const EXPIRY_DAYS = 30;
  const cutoff = new Date(Date.now() - EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  const expired = await db
    .select({ id: schema.participants.id, decisionId: schema.participants.decisionId })
    .from(schema.participants)
    .where(
      and(
        isNotNull(schema.participants.inviteToken),
        isNull(schema.participants.inviteAcceptedAt),
        lt(schema.participants.createdAt, cutoff)
      )
    );

  if (expired.length === 0) {
    console.log('[cron · invite-expiry] 0 expired invites');
    return;
  }

  const expiredIds = expired.map((r) => r.id);
  const affectedDecisions = Array.from(new Set(expired.map((r) => r.decisionId)));

  await db
    .update(schema.participants)
    .set({ inviteToken: null })
    .where(inArray(schema.participants.id, expiredIds));

  await db
    .update(schema.decisions)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(
      and(
        inArray(schema.decisions.id, affectedDecisions),
        eq(schema.decisions.status, 'pending_invites')
      )
    );

  console.log(
    `[cron · invite-expiry] expired ${expired.length} invite tokens across ${affectedDecisions.length} decision(s)`
  );
}

/**
 * Send a single reminder email to partner-invitees who haven't accepted
 * within 48 hours. Bumps acceptance rate without becoming spam · we
 * never send more than one reminder per invite. Tracked via audit_log
 * action 'invite.reminder_sent' rather than a new schema column.
 *
 * Window: invites created 48h-7d ago. Older than 7 days the invite-expiry
 * job will null the token anyway; newer than 48h is too soon.
 */
async function inviteReminder() {
  const remindersDue = await db.execute<{
    participant_id: string;
    display_name: string;
    invite_email: string;
    invite_token: string;
    decision_id: string;
    question: string;
    owner_first_name: string | null;
  }>(sql`
    SELECT
      p.id   AS participant_id,
      p.display_name,
      p.invite_email,
      p.invite_token,
      d.id   AS decision_id,
      d.question,
      u.first_name AS owner_first_name
    FROM participants p
    JOIN decisions d ON d.id = p.decision_id
    JOIN users u ON u.id = d.owner_user_id
    WHERE p.invite_token IS NOT NULL
      AND p.invite_accepted_at IS NULL
      AND p.invite_email IS NOT NULL
      AND p.created_at < NOW() - INTERVAL '48 hours'
      AND p.created_at > NOW() - INTERVAL '7 days'
      AND NOT EXISTS (
        SELECT 1 FROM audit_log al
        WHERE al.action = 'invite.reminder_sent'
          AND al.target_id = p.id
      )
    LIMIT 50
  `);

  const rows = remindersDue as unknown as Array<{
    participant_id: string;
    display_name: string;
    invite_email: string;
    invite_token: string;
    decision_id: string;
    question: string;
    owner_first_name: string | null;
  }>;

  if (rows.length === 0) {
    console.log('[cron · invite-reminder] 0 reminders due');
    return;
  }

  let sent = 0;
  for (const r of rows) {
    const inviteUrl = `${APP_BASE_URL}/invite?token=${encodeURIComponent(r.invite_token)}`;
    const owner = r.owner_first_name || 'Your partner';
    const greeting = r.display_name ? `Hi ${r.display_name},` : 'Hi,';
    const safeQuestion = r.question.length > 200 ? r.question.slice(0, 197) + '...' : r.question;
    const text = [
      greeting,
      '',
      `A reminder: ${owner} invited you a couple of days ago to take part in a Counsel.day decision. The question is:`,
      '',
      `  ${safeQuestion}`,
      '',
      'The decision cannot begin until you accept. The invite link is still valid:',
      '',
      inviteUrl,
      '',
      'If you would rather not take part, you can just ignore this · the invite will expire on its own in a few weeks.',
      '',
      '· Counsel.day',
    ].join('\n');
    const html = `
      <p>${greeting}</p>
      <p>A reminder: <strong>${owner}</strong> invited you a couple of days ago to take part in a Counsel.day decision. The question is:</p>
      <blockquote style="margin: 16px 0; padding: 12px 16px; border-left: 3px solid #722F37;">${safeQuestion}</blockquote>
      <p>The decision cannot begin until you accept. The invite link is still valid:</p>
      <p><a href="${inviteUrl}" style="color: #722F37;">${inviteUrl}</a></p>
      <p>If you would rather not take part, you can just ignore this · the invite will expire on its own in a few weeks.</p>
      <p>· Counsel.day</p>
    `.trim();

    const res = await sendTransactional({
      to: { email: r.invite_email, name: r.display_name },
      subject: `Reminder: ${owner} invited you to a Counsel.day decision`,
      textContent: text,
      htmlContent: html,
    });

    if (res.ok) {
      sent++;
      // Mark this participant as reminded so we never send a second one
      await db.insert(schema.auditLog).values({
        action: 'invite.reminder_sent',
        targetType: 'participant',
        targetId: r.participant_id,
        metadata: { decision_id: r.decision_id, invite_email: r.invite_email },
      }).catch(() => { /* best-effort */ });
    }
  }

  console.log(`[cron · invite-reminder] sent ${sent}/${rows.length} reminders`);
}

/**
 * Audit-log retention · prune entries older than 24 months.
 *
 * Per docs/SECURITY_PENTEST_2026-05-20.md item 14. Counsel.day has no
 * regulatory obligation to retain audit_log beyond 24 months · NZ
 * Privacy Act + GDPR Art. 5(1)(e) both call for "no longer than
 * necessary." Two-year window preserves a useful trail for incident
 * forensics without unbounded growth.
 *
 * Exception · refund.* and user.hard_delete_purged actions are kept
 * for 7 years because NZ Tax Administration Act 1994 mandates 7-year
 * financial record retention (refund processing rows can carry
 * billing context the IRD might request).
 */
async function auditPrune() {
  // Migration 0017 installed an append-only trigger on audit_log that
  // blocks DELETE unless the session variable app.audit_prune_session
  // is set to 'on'. Wrap both deletes in a single transaction so the
  // setting is scoped to this cron's writes only · once the txn commits
  // the setting goes away and the trigger resumes blocking deletes
  // from anywhere else.
  await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL app.audit_prune_session = 'on'`);
    const general = await tx.execute(sql`
      DELETE FROM audit_log
      WHERE created_at < NOW() - INTERVAL '24 months'
        AND action NOT LIKE 'refund.%'
        AND action <> 'user.hard_delete_purged'
      RETURNING id
    `);
    const financial = await tx.execute(sql`
      DELETE FROM audit_log
      WHERE created_at < NOW() - INTERVAL '7 years'
        AND (action LIKE 'refund.%' OR action = 'user.hard_delete_purged')
      RETURNING id
    `);
    const gCount = (general as unknown as Array<unknown>).length;
    const fCount = (financial as unknown as Array<unknown>).length;
    console.log(`[cron · audit-prune] removed ${gCount} general + ${fCount} financial audit_log rows`);
  });
}

/**
 * Hard-delete soft-deleted users after the 14-day grace window.
 *
 * Per [[project-locked-settings]], soft-deletes (DELETE /api/me +
 * admin soft_delete) are reversible for 14 days; afterwards the
 * account, every decision they own, votes, notes, verdicts, and
 * saved contacts are permanently removed. The schema has ON DELETE
 * CASCADE everywhere that depends on users.id so this is one DELETE
 * + Postgres handles the cascade.
 *
 * Stripe customer records are NOT cascaded · we keep the audit
 * trail of subscription history but the email + name are wiped via
 * the cascade. Operator can manually remove the Stripe customer
 * later via the Customer Portal.
 */
async function hardDeletePurge() {
  // Count first so we can log + audit before destroying
  const candidates = await db.execute<{ id: string; email: string }>(sql`
    SELECT id::text, email FROM users
    WHERE deleted_at IS NOT NULL
      AND deleted_at < NOW() - INTERVAL '14 days'
  `);
  const list = Array.from(candidates) as Array<{ id: string; email: string }>;
  if (list.length === 0) {
    console.log('[cron · hard-delete-purge] no users past the 14-day window');
    return;
  }

  // Audit-log each pending deletion BEFORE the row disappears
  for (const u of list) {
    await db.insert(schema.auditLog).values({
      action: 'user.hard_delete_purged',
      targetType: 'user',
      targetId: u.id,
      metadata: { email_hash: Buffer.from(u.email).toString('base64').slice(0, 32) },
    }).catch(() => { /* best-effort */ });
  }

  // Bulk delete · ON DELETE CASCADE handles every dependent table
  await db.execute(sql`
    DELETE FROM users
    WHERE deleted_at IS NOT NULL
      AND deleted_at < NOW() - INTERVAL '14 days'
  `);

  console.log(`[cron · hard-delete-purge] purged ${list.length} user${list.length === 1 ? '' : 's'} past the 14-day grace`);
}

/**
 * Daily · find verdict_time_capsules rows where deliver_at <= NOW() AND
 * delivered_at IS NULL, send the re-link email, stamp delivered_at.
 * The user opted in from /verdict-report.html for the 6 / 12 / 24-month
 * intervals. Email body just says "you sealed this N months ago, here
 * it is again" with a link back to the same report page.
 */
async function timeCapsuleDeliver() {
  const dueRows = await db.execute(sql`
    SELECT tc.id, tc.decision_id, tc.user_id, tc.interval_months,
           u.email, u.first_name,
           d.question
    FROM verdict_time_capsules tc
    JOIN users u ON u.id = tc.user_id
    JOIN decisions d ON d.id = tc.decision_id
    WHERE tc.delivered_at IS NULL
      AND tc.deliver_at <= NOW()
      AND u.deleted_at IS NULL
    ORDER BY tc.deliver_at
    LIMIT 100
  `);

  let sent = 0;
  for (const r of dueRows as unknown as Array<{
    id: string; decision_id: string; user_id: string; interval_months: number;
    email: string; first_name: string | null; question: string;
  }>) {
    const greeting = r.first_name ? `Hi ${r.first_name},` : 'Hi,';
    const url = `${APP_BASE_URL}/verdict-report?id=${r.decision_id}&capsule=${r.interval_months}mo`;
    const intervalText = r.interval_months === 6 ? 'six months'
      : r.interval_months === 12 ? 'one year' : 'two years';
    try {
      await sendTransactional({
        to: { email: r.email, name: r.first_name ?? undefined },
        subject: `Your Counsel.day record from ${intervalText} ago`,
        textContent: [
          greeting, '',
          `${intervalText} ago you sealed a decision on Counsel.day:`,
          '',
          `> ${r.question}`,
          '',
          'You asked to be reminded when this much time had passed. The record is here:',
          url, '',
          'Open it on a quiet evening if you want to compare what was true then with what is true now.',
          '', '· Counsel.day',
        ].join('\n'),
        htmlContent:
          `<p>${greeting}</p>` +
          `<p>${intervalText} ago you sealed a decision on Counsel.day:</p>` +
          `<blockquote style="border-left:3px solid #722F37;padding:6px 0 6px 16px;margin:14px 0;font-style:italic;">${r.question}</blockquote>` +
          `<p>You asked to be reminded when this much time had passed. The record is here:</p>` +
          `<p><a href="${url}" style="color:#722F37;">${url}</a></p>` +
          `<p>Open it on a quiet evening if you want to compare what was true then with what is true now.</p>` +
          `<p>· Counsel.day</p>`,
      });
      await db.execute(sql`UPDATE verdict_time_capsules SET delivered_at = NOW() WHERE id = ${r.id}`);
      sent += 1;
    } catch (err) {
      console.warn(`[cron · time-capsule] failed for capsule ${r.id}:`, (err as Error).message);
    }
  }
  console.log(`[cron · time-capsule] delivered ${sent}/${(dueRows as unknown as unknown[]).length} due capsules`);
}

/**
 * Wrapper that writes a cron.<job>.completed audit_log row after every
 * successful run, with the elapsed time. Used so the operator looking
 * at /admin-audit-log can confirm that the daily/hourly crons actually
 * fired · before this every systemd-triggered job ran silently and the
 * audit log looked "stale" for hours on end (Task 2 from 2026-05-22).
 *
 * On failure the wrapper still writes a row with status=failed and the
 * error message metadata, then re-raises so the outer process exits non-
 * zero and systemctl status surfaces the failure.
 */
async function runWithHeartbeat<T>(job: string, fn: () => Promise<T>): Promise<T> {
  const started = Date.now();
  try {
    const result = await fn();
    await db.insert(schema.auditLog).values({
      action: `cron.${job}.completed`,
      targetType: 'cron',
      metadata: { job, duration_ms: Date.now() - started, status: 'ok' },
    }).catch(() => {});
    return result;
  } catch (err) {
    await db.insert(schema.auditLog).values({
      action: `cron.${job}.failed`,
      targetType: 'cron',
      metadata: { job, duration_ms: Date.now() - started, status: 'failed', error: (err as Error).message?.slice(0, 500) ?? 'unknown' },
    }).catch(() => {});
    throw err;
  }
}

/**
 * Weekly ops digest · runs Sunday evening per locked-settings ("Weekly
 * Sunday-evening ops digest by email"). Aggregates the last 7 days
 * of platform activity and emails the operator at OPS_DIGEST_EMAIL
 * (defaults to admin@counsel.day). Cheap query · just COUNT()s
 * against indexed columns.
 */
// ---------------------------------------------------------------------------
// THE DAILY COUNSEL · journal-digest
// ---------------------------------------------------------------------------
// Runs every Sunday evening (NZ local cron) and ships a Monday-morning
// verdict to every user who logged 3+ journal entries in the past week
// of UNSEALED entries. The verdict is written in the Counsel.day
// editorial voice · observational, not advisory · referencing specific
// phrases the user used. Three sections: positives (3-5 recurring),
// strains (1-2 recurring), throughline (one paragraph), and one
// concrete question for the week ahead.
//
// Free tier · weekly verdict only
// Pro tier  · weekly + monthly deep-dive on the last Sunday of the month
//
// Privacy: the prompt is run against the user's own entries only ·
// never cross-user · the prompt sees no other user's writing.
// ---------------------------------------------------------------------------
async function journalDigest() {
  // Window: the previous Monday-Sunday in UTC. Sunday-night cron means
  // "today" is the Sunday at the end of the window.
  const now = new Date();
  const sunday = new Date(now);
  sunday.setUTCHours(0, 0, 0, 0);
  while (sunday.getUTCDay() !== 0) sunday.setUTCDate(sunday.getUTCDate() - 1);
  const monday = new Date(sunday);
  monday.setUTCDate(monday.getUTCDate() - 6);
  const weekStartsOn = monday.toISOString().slice(0, 10);
  const weekEndsOn = sunday.toISOString().slice(0, 10);

  // Pull every user with at least 3 UNSEALED entries falling on dates
  // inside the window. Re-running on the same Sunday is idempotent
  // because of the unique index on (user_id, week_starts_on, kind).
  type Candidate = { user_id: string; email: string; first_name: string | null; entry_count: string };
  const candidates = await db.execute<Candidate>(sql`
    SELECT u.id::text AS user_id, u.email, u.first_name, COUNT(*)::text AS entry_count
    FROM users u
    JOIN journal_entries j ON j.user_id = u.id
    WHERE j.deleted_at IS NULL
      AND j.unseals_at <= NOW()
      AND j.entry_date BETWEEN ${weekStartsOn}::date AND ${weekEndsOn}::date
      AND u.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM journal_verdicts v
        WHERE v.user_id = u.id AND v.week_starts_on = ${weekStartsOn}::date AND v.kind = 'weekly'
      )
    GROUP BY u.id, u.email, u.first_name
    HAVING COUNT(*) >= 3
  `);

  let sent = 0;
  for (const c of candidates as unknown as Candidate[]) {
    try {
      const verdict = await generateJournalVerdict(c.user_id, weekStartsOn, weekEndsOn);
      if (!verdict) continue;
      await emailJournalVerdict(c.email, c.first_name, verdict, weekStartsOn, weekEndsOn);
      await db.update(schema.journalVerdicts)
        .set({ deliveredEmailAt: new Date() })
        .where(eq(schema.journalVerdicts.id, verdict.id));
      sent++;
    } catch (err) {
      console.error('[cron · journal-digest] user ' + c.user_id + ' failed', (err as Error).message);
    }
  }
  console.log('[cron · journal-digest] processed ' + (candidates as unknown as Candidate[]).length + ' users, emailed ' + sent);
}

async function generateJournalVerdict(userId: string, weekStartsOn: string, weekEndsOn: string): Promise<{ id: string; positives: string[]; strains: string[]; throughline: string; question: string } | null> {
  // Read the unsealed entries for the window.
  const entries = await db.execute<{ entry_date: string; text_content: string | null; transcript: string | null }>(sql`
    SELECT entry_date::text AS entry_date, text_content, transcript
    FROM journal_entries
    WHERE user_id = ${userId}::uuid
      AND deleted_at IS NULL
      AND unseals_at <= NOW()
      AND entry_date BETWEEN ${weekStartsOn}::date AND ${weekEndsOn}::date
    ORDER BY entry_date ASC
  `);
  if ((entries as unknown[]).length < 3) return null;

  const body = (entries as unknown as Array<{ entry_date: string; text_content: string | null; transcript: string | null }>).map((e) => {
    const text = (e.text_content || e.transcript || '').trim();
    return `[${e.entry_date}]\n${text}`;
  }).join('\n\n');

  const systemPrompt = await resolvePrompt('journal_weekly_verdict', JOURNAL_WEEKLY_VERDICT_SYSTEM_DEFAULT);
  const userPrompt = `Here are the journal entries for the week of ${weekStartsOn} to ${weekEndsOn}. Each entry begins with the date in brackets.\n\n${body}\n\nReturn ONLY valid JSON with keys: positives (array of 3-5 short observational strings, each starts with a verb, no advice), strains (array of 1-2), throughline (one paragraph, 2-4 sentences, observational), question_for_next (one specific concrete question for the week ahead).`;

  let res;
  try {
    res = await callAnthropic(
      { source: 'journal_weekly_verdict' },
      {
        model: VERDICT_MODEL,
        max_tokens: 1200,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      },
    );
  } catch (err) {
    console.warn('[journal-verdict] anthropic call failed', (err as Error).message);
    return null;
  }
  const textBlock = res.message.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') return null;

  let parsed: { positives?: string[]; strains?: string[]; throughline?: string; question_for_next?: string };
  try {
    // Strip code-fence wrappers if Claude adds them.
    const jsonText = textBlock.text.replace(/^```(?:json)?\n?|\n?```$/g, '').trim();
    parsed = JSON.parse(jsonText);
  } catch {
    console.warn('[journal-verdict] JSON parse failed');
    return null;
  }

  const positives = Array.isArray(parsed.positives) ? parsed.positives.slice(0, 5).map(String) : [];
  const strains = Array.isArray(parsed.strains) ? parsed.strains.slice(0, 2).map(String) : [];
  const throughline = typeof parsed.throughline === 'string' ? parsed.throughline : '';
  const question = typeof parsed.question_for_next === 'string' ? parsed.question_for_next : '';

  if (positives.length === 0 || !throughline || !question) return null;

  const inserted = await db.insert(schema.journalVerdicts).values({
    userId,
    weekStartsOn,
    weekEndsOn,
    kind: 'weekly',
    entriesCount: (entries as unknown[]).length,
    positives: positives as unknown as object,
    strains: strains as unknown as object,
    throughline,
    questionForNext: question,
    model: VERDICT_MODEL,
    tokensIn: res.tokensInput,
    tokensOut: res.tokensOutput,
    costCents: res.costCents,
  }).returning({ id: schema.journalVerdicts.id });

  return { id: inserted[0].id, positives, strains, throughline, question };
}

async function emailJournalVerdict(
  email: string,
  firstName: string | null,
  v: { positives: string[]; strains: string[]; throughline: string; question: string },
  weekStartsOn: string,
  weekEndsOn: string,
) {
  const greeting = firstName ? `Hi ${firstName},` : 'Hi,';
  const weekStr = new Date(weekStartsOn).toLocaleDateString('en-NZ', { day: '2-digit', month: 'short' })
    + ' to ' + new Date(weekEndsOn).toLocaleDateString('en-NZ', { day: '2-digit', month: 'short' });
  const positivesText = v.positives.map((p) => '  · ' + p).join('\n');
  const strainsText = v.strains.length ? v.strains.map((s) => '  · ' + s).join('\n') : '  · None named this week.';

  const text = [
    greeting,
    '',
    `Your Counsel · Daily verdict for ${weekStr}.`,
    '',
    'What stood out as working:',
    positivesText,
    '',
    'What kept coming up as a strain:',
    strainsText,
    '',
    'Throughline:',
    v.throughline,
    '',
    'A question for the week ahead:',
    v.question,
    '',
    `Open the full verdict at ${APP_BASE_URL}/daily`,
    '',
    '· A note from Counsel: if one of the strains above has been recurring across the past month, a 30-night sealed decision can hold it · the same evening rhythm, with a verdict on the close date. Compose one at ' + APP_BASE_URL + '/compose · or skip the nudge and let the journal do its work.',
    '',
    '· Counsel.day',
  ].join('\n');

  const html = `
    <div style="font-family: Georgia, serif; max-width: 540px; color: #0a0a0a; line-height: 1.55;">
      <p style="font-family: 'Geist Mono', monospace; font-size: 11px; letter-spacing: 0.14em; color: #6b635a; text-transform: uppercase;">COUNSEL &middot; DAILY &middot; WEEKLY VERDICT</p>
      <h2 style="font-family: Newsreader, Georgia, serif; font-weight: 400; font-size: 24px; margin: 0 0 4px;">Week of <em style="color: #722F37;">${weekStr}</em></h2>
      <p>${greeting}</p>
      <h3 style="font-family: 'Geist Mono', monospace; font-size: 11px; letter-spacing: 0.14em; color: #722F37; margin-top: 26px;">WHAT STOOD OUT AS WORKING</h3>
      <ul style="margin: 0; padding-left: 18px;">${v.positives.map((p) => `<li style="margin-bottom: 6px;">${escapeHtml(p)}</li>`).join('')}</ul>
      <h3 style="font-family: 'Geist Mono', monospace; font-size: 11px; letter-spacing: 0.14em; color: #722F37; margin-top: 24px;">WHAT KEPT COMING UP AS A STRAIN</h3>
      ${v.strains.length
        ? `<ul style="margin: 0; padding-left: 18px;">${v.strains.map((s) => `<li style="margin-bottom: 6px;">${escapeHtml(s)}</li>`).join('')}</ul>`
        : '<p style="font-style: italic; color: #6b635a;">None named this week.</p>'}
      <h3 style="font-family: 'Geist Mono', monospace; font-size: 11px; letter-spacing: 0.14em; color: #722F37; margin-top: 24px;">THROUGHLINE</h3>
      <p>${escapeHtml(v.throughline)}</p>
      <h3 style="font-family: 'Geist Mono', monospace; font-size: 11px; letter-spacing: 0.14em; color: #722F37; margin-top: 24px;">A QUESTION FOR THE WEEK AHEAD</h3>
      <p style="font-family: Newsreader, Georgia, serif; font-style: italic; font-size: 18px; color: #0a0a0a;">${escapeHtml(v.question)}</p>
      <p style="margin-top: 30px;"><a href="${APP_BASE_URL}/daily" style="color: #722F37; border-bottom: 1px solid #722F37; padding-bottom: 1px; text-decoration: none;">Open the verdict on Counsel.day</a></p>
      <p style="margin-top: 30px; padding: 14px 16px; background: #f4e6e8; border-left: 3px solid #722F37; font-family: Georgia, serif; font-size: 14px; line-height: 1.55; color: #364556;">
        <strong style="color: #0a0a0a;">A note from Counsel.</strong> If one of the strains above has been recurring for weeks, a 30-night sealed decision can hold it &middot; the same evening rhythm, with a verdict on the close date. <a href="${APP_BASE_URL}/compose" style="color: #722F37; border-bottom: 1px solid #722F37; padding-bottom: 1px; text-decoration: none;">Compose one</a>, or skip the nudge and let the journal do its work.
      </p>
      <p style="font-family: 'Geist Mono', monospace; font-size: 11px; color: #6b635a; margin-top: 30px;">&middot; Counsel.day</p>
    </div>
  `.trim();

  await sendTransactional({
    to: { email, name: firstName ?? undefined },
    subject: `Counsel · Daily · your week of ${weekStr}`,
    textContent: text,
    htmlContent: html,
  });
}

const JOURNAL_WEEKLY_VERDICT_SYSTEM_DEFAULT = `You are the Counsel.day editorial voice writing a weekly verdict on a user's daily journal entries. You are observational, not advisory. You quote the user's own phrasing back to them. You do not give advice, you do not diagnose, you do not coach. You name what is recurring, what is working, what is straining. You write one specific concrete question for the week ahead. No bullet points in the throughline; one prose paragraph of 2-4 sentences. Never use the words "feel", "you should", "you might consider", "try to", "remember to". Lead with what is working before what is straining.`;

async function weeklyDigest() {
  const opsEmail = process.env.OPS_DIGEST_EMAIL ?? 'admin@counsel.day';

  type DigestRow = {
    signups: string; verified: string;
    decisions_new: string; decisions_completed: string;
    verdicts_generated: string; verdicts_tokens: string; verdicts_cost_cents: string;
    chatbot_turns: string; chatbot_escalated: string;
    push_sent: string;
    refund_requested: string; refund_processed: string;
    cron_failed: string;
    active_sessions: string;
  };
  const rows = await db.execute<DigestRow>(sql`
    SELECT
      (SELECT count(*)::text FROM users WHERE created_at > NOW() - INTERVAL '7 days') AS signups,
      (SELECT count(*)::text FROM users WHERE email_verified_at > NOW() - INTERVAL '7 days') AS verified,
      (SELECT count(*)::text FROM decisions WHERE created_at > NOW() - INTERVAL '7 days') AS decisions_new,
      (SELECT count(*)::text FROM decisions WHERE status = 'completed' AND updated_at > NOW() - INTERVAL '7 days') AS decisions_completed,
      (SELECT count(*)::text FROM verdicts WHERE generated_at > NOW() - INTERVAL '7 days') AS verdicts_generated,
      (SELECT COALESCE(SUM(tokens_input + tokens_output), 0)::text FROM verdicts WHERE generated_at > NOW() - INTERVAL '7 days') AS verdicts_tokens,
      (SELECT COALESCE(SUM(cost_cents), 0)::text FROM anthropic_calls WHERE called_at > NOW() - INTERVAL '7 days' AND ok = true) AS verdicts_cost_cents,
      (SELECT count(*)::text FROM chatbot_queries WHERE asked_at > NOW() - INTERVAL '7 days') AS chatbot_turns,
      (SELECT count(*)::text FROM chatbot_queries WHERE asked_at > NOW() - INTERVAL '7 days' AND escalated = true) AS chatbot_escalated,
      (SELECT count(*)::text FROM audit_log WHERE created_at > NOW() - INTERVAL '7 days' AND action = 'push.sent') AS push_sent,
      (SELECT count(*)::text FROM audit_log WHERE created_at > NOW() - INTERVAL '7 days' AND action = 'refund.requested') AS refund_requested,
      (SELECT count(*)::text FROM audit_log WHERE created_at > NOW() - INTERVAL '7 days' AND action = 'refund.processed') AS refund_processed,
      (SELECT count(*)::text FROM audit_log WHERE created_at > NOW() - INTERVAL '7 days' AND action LIKE 'cron.%.failed') AS cron_failed,
      (SELECT count(*)::text FROM sessions WHERE expires_at > NOW()) AS active_sessions
  `);
  const r = rows[0] as DigestRow;

  const costUsd = (Number(r.verdicts_cost_cents) / 100).toFixed(2);
  const escRate = Number(r.chatbot_turns) > 0
    ? ((Number(r.chatbot_escalated) / Number(r.chatbot_turns)) * 100).toFixed(1) + '%'
    : 'n/a';
  const weekEnding = new Date().toLocaleDateString('en-NZ', { day: '2-digit', month: 'short', year: 'numeric' });

  const text = [
    'Counsel.day · weekly ops digest',
    'Week ending ' + weekEnding,
    '',
    '· Signups: ' + r.signups + ' (' + r.verified + ' verified)',
    '· Decisions started: ' + r.decisions_new,
    '· Decisions completed: ' + r.decisions_completed,
    '· Verdicts generated: ' + r.verdicts_generated,
    '· Anthropic spend (ledger): $' + costUsd + ' USD across ' + r.verdicts_tokens + ' tokens',
    '· Chatbot turns: ' + r.chatbot_turns + ' (' + escRate + ' escalated to support)',
    '· Push notifications sent: ' + r.push_sent,
    '· Refund requests: ' + r.refund_requested + ' new, ' + r.refund_processed + ' processed',
    '· Cron failures: ' + r.cron_failed + (Number(r.cron_failed) > 0 ? ' (CHECK /admin-audit-log.html)' : ''),
    '· Active sessions: ' + r.active_sessions,
    '',
    'Full detail · https://counsel.day/admin.html',
    '',
    '· Counsel.day',
  ].join('\n');
  const html = `
    <h2 style="font-family: Newsreader, Georgia, serif; color: #0a0a0a;">Counsel.day &middot; <em style="color: #722F37;">weekly ops digest</em></h2>
    <p style="font-family: 'Geist Mono', monospace; font-size: 12px; color: #6b635a;">Week ending ${weekEnding}</p>
    <table style="font-family: Georgia, serif; border-collapse: collapse; width: 100%; max-width: 540px;">
      <tr><td style="padding: 8px 12px; border-bottom: 1px solid #e8e6e1;">Signups</td><td style="padding: 8px 12px; border-bottom: 1px solid #e8e6e1; text-align: right;"><strong>${r.signups}</strong> (${r.verified} verified)</td></tr>
      <tr><td style="padding: 8px 12px; border-bottom: 1px solid #e8e6e1;">Decisions started</td><td style="padding: 8px 12px; border-bottom: 1px solid #e8e6e1; text-align: right;"><strong>${r.decisions_new}</strong></td></tr>
      <tr><td style="padding: 8px 12px; border-bottom: 1px solid #e8e6e1;">Decisions completed</td><td style="padding: 8px 12px; border-bottom: 1px solid #e8e6e1; text-align: right;"><strong>${r.decisions_completed}</strong></td></tr>
      <tr><td style="padding: 8px 12px; border-bottom: 1px solid #e8e6e1;">Verdicts generated</td><td style="padding: 8px 12px; border-bottom: 1px solid #e8e6e1; text-align: right;"><strong>${r.verdicts_generated}</strong></td></tr>
      <tr><td style="padding: 8px 12px; border-bottom: 1px solid #e8e6e1;">Anthropic spend</td><td style="padding: 8px 12px; border-bottom: 1px solid #e8e6e1; text-align: right;"><strong>$${costUsd} USD</strong></td></tr>
      <tr><td style="padding: 8px 12px; border-bottom: 1px solid #e8e6e1;">Chatbot turns</td><td style="padding: 8px 12px; border-bottom: 1px solid #e8e6e1; text-align: right;"><strong>${r.chatbot_turns}</strong> &middot; ${escRate} escalated</td></tr>
      <tr><td style="padding: 8px 12px; border-bottom: 1px solid #e8e6e1;">Push notifications sent</td><td style="padding: 8px 12px; border-bottom: 1px solid #e8e6e1; text-align: right;"><strong>${r.push_sent}</strong></td></tr>
      <tr><td style="padding: 8px 12px; border-bottom: 1px solid #e8e6e1;">Refunds</td><td style="padding: 8px 12px; border-bottom: 1px solid #e8e6e1; text-align: right;"><strong>${r.refund_requested}</strong> new &middot; ${r.refund_processed} processed</td></tr>
      <tr><td style="padding: 8px 12px; border-bottom: 1px solid #e8e6e1; color: ${Number(r.cron_failed) > 0 ? '#722F37' : '#0a0a0a'};">Cron failures</td><td style="padding: 8px 12px; border-bottom: 1px solid #e8e6e1; text-align: right; color: ${Number(r.cron_failed) > 0 ? '#722F37' : '#0a0a0a'};"><strong>${r.cron_failed}</strong></td></tr>
      <tr><td style="padding: 8px 12px;">Active sessions</td><td style="padding: 8px 12px; text-align: right;"><strong>${r.active_sessions}</strong></td></tr>
    </table>
    <p style="font-family: Georgia, serif; margin-top: 18px;">Full detail: <a href="https://counsel.day/admin.html" style="color: #722F37;">counsel.day/admin.html</a></p>
    <p style="font-family: 'Geist Mono', monospace; font-size: 11px; color: #6b635a; margin-top: 24px;">&middot; Counsel.day</p>
  `.trim();

  await sendTransactional({
    to: { email: opsEmail, name: 'Counsel.day operator' },
    subject: 'Counsel.day · weekly ops digest · ' + weekEnding,
    textContent: text,
    htmlContent: html,
  });

  console.log('[cron · weekly-digest] sent to ' + opsEmail);
}

/**
 * Daily security-audit · runs `npm audit --json` against the live
 * install, classifies findings, persists a snapshot to disk, and
 * emails the operator when critical/high vulnerabilities appear or
 * the totals change vs the previous snapshot.
 *
 * Auto-application policy (per James 2026-05-23): for semver-safe
 * fixes (patch/minor + transitive-overridable), the email contains
 * a ready-to-paste package.json overrides block. The cron does NOT
 * mutate the server's working tree · /opt/counsel-day-app is a
 * tar-deploy target, not a git checkout, so any change would be
 * blown away on next deploy. James applies in his local repo.
 *
 * Breaking-fix paths (major version bumps) email-only with the
 * advisory URL · human review required.
 */
async function securityAudit() {
  const opsEmail = process.env.OPS_DIGEST_EMAIL ?? 'admin@counsel.day';
  let snapshot: AuditSnapshot;
  try {
    snapshot = await runSecurityAudit();
  } catch (err) {
    // npm audit failure · email the operator with the error so the
    // silent-failure window is short.
    await sendTransactional({
      to: { email: opsEmail, name: 'Counsel.day operator' },
      subject: 'Counsel.day · security audit FAILED to run',
      textContent: 'The daily security-audit cron failed:\n\n' + (err as Error).message + '\n\nCheck journalctl on the box.',
      htmlContent: '<p>The daily security-audit cron failed:</p><pre style="font-family: monospace; background: #fafaf8; padding: 12px; border-left: 3px solid #722F37;">' + escapeHtml((err as Error).message) + '</pre><p>Check journalctl on the box.</p>',
    }).catch(() => {});
    throw err;
  }

  const { totals, findings, proposal, totalDependencies, generatedAt } = snapshot;
  const critical = totals.critical;
  const high = totals.high;
  const moderate = totals.moderate;

  console.log('[cron · security-audit] ' + critical + ' critical, ' + high + ' high, ' + moderate + ' moderate across ' + totalDependencies + ' deps');

  // Quiet mode · if there are zero critical/high findings, we don't
  // email (just persist the snapshot and let the dashboard show it).
  // This avoids inbox fatigue when the project is healthy.
  if (critical === 0 && high === 0) {
    return;
  }

  // Build the email · severity headline first, instructions block
  // verbatim from the proposal builder, list of breaking items as
  // a follow-up section.
  const headline = (critical > 0 ? critical + ' critical · ' : '')
    + (high > 0 ? high + ' high' : '')
    + (moderate > 0 ? ' · ' + moderate + ' moderate (no email when only moderate)' : '');

  const lines = [
    'Counsel.day · daily security-audit',
    'Run at ' + new Date(generatedAt).toLocaleString('en-NZ'),
    '',
    'Severity totals: ' + headline,
    'Total dependencies scanned: ' + totalDependencies,
    '',
    '== Findings (' + findings.length + ') ==',
    ...findings.slice(0, 25).map((f) => '  · ' + f.severity.toUpperCase() + ' · ' + f.package + ' · ' + f.title + (f.advisoryUrl ? '\n      ' + f.advisoryUrl : '')),
    findings.length > 25 ? '  ... ' + (findings.length - 25) + ' more · see /admin-security.html' : '',
    '',
    proposal.instructions,
    '',
    '== How to apply ==',
    'View full snapshot: https://counsel.day/admin-security.html',
    'Local fix: cd counsel-day-app && (edit overrides) && rm -f package-lock.json && npm install && git commit -am "deps · security fixes" && git push',
    '',
    '· Counsel.day',
  ].filter((s) => s !== undefined);
  const text = lines.join('\n');

  // Build inline HTML email · severity-coloured headline, monospaced
  // instructions block (the operator copy-pastes the overrides), each
  // finding as a row with the advisory link.
  const findingsHtml = findings.map((f) => {
    const sevColor = f.severity === 'critical' || f.severity === 'high' ? '#722F37' : (f.severity === 'moderate' ? '#3a3530' : '#6b635a');
    return '<tr>'
      + '<td style="padding: 6px 10px; border-bottom: 1px solid #e8e6e1; color:' + sevColor + '; font-family: Geist Mono, monospace; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; font-weight: 600;">' + f.severity + '</td>'
      + '<td style="padding: 6px 10px; border-bottom: 1px solid #e8e6e1; font-family: Geist Mono, monospace; font-size: 12px;">' + f.package + '</td>'
      + '<td style="padding: 6px 10px; border-bottom: 1px solid #e8e6e1; font-family: Georgia, serif; font-size: 13px; color: #3a3530;">' + escapeHtml(f.title) + (f.advisoryUrl ? '<br><a href="' + f.advisoryUrl + '" style="color: #722F37; font-size: 11px;">' + f.advisoryUrl + '</a>' : '') + '</td>'
      + '<td style="padding: 6px 10px; border-bottom: 1px solid #e8e6e1; font-family: Geist Mono, monospace; font-size: 11px; color: ' + (f.classification === 'breaking' ? '#722F37' : '#3a3530') + ';">' + f.classification + '</td>'
      + '</tr>';
  }).join('');

  const html = `
    <h2 style="font-family: Newsreader, Georgia, serif; color: #0a0a0a; margin: 0 0 4px;">Counsel.day &middot; <em style="color: #722F37;">daily security audit</em></h2>
    <p style="font-family: 'Geist Mono', monospace; font-size: 11px; color: #6b635a; margin: 0 0 18px;">${new Date(generatedAt).toLocaleString('en-NZ')} &middot; ${totalDependencies} dependencies scanned</p>
    <p style="font-family: Georgia, serif; font-size: 16px; margin: 0 0 14px;"><strong style="color: ${critical > 0 ? '#722F37' : '#0a0a0a'};">${critical} critical</strong>, <strong>${high} high</strong>, ${moderate} moderate</p>
    <table style="font-family: Georgia, serif; border-collapse: collapse; width: 100%; max-width: 720px; margin-bottom: 20px;">
      <thead><tr style="background: #fafaf8;">
        <th style="text-align: left; padding: 8px 10px; border-bottom: 2px solid #0a0a0a; font-family: 'Geist Mono', monospace; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase;">Severity</th>
        <th style="text-align: left; padding: 8px 10px; border-bottom: 2px solid #0a0a0a; font-family: 'Geist Mono', monospace; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase;">Package</th>
        <th style="text-align: left; padding: 8px 10px; border-bottom: 2px solid #0a0a0a; font-family: 'Geist Mono', monospace; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase;">Advisory</th>
        <th style="text-align: left; padding: 8px 10px; border-bottom: 2px solid #0a0a0a; font-family: 'Geist Mono', monospace; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase;">Action</th>
      </tr></thead>
      <tbody>${findingsHtml}</tbody>
    </table>
    <div style="font-family: 'Geist Mono', monospace; font-size: 12px; line-height: 1.55; background: #fafaf8; border-left: 3px solid #722F37; padding: 14px 16px; white-space: pre-wrap;">${escapeHtml(proposal.instructions)}</div>
    <p style="font-family: Georgia, serif; margin-top: 18px;">Full snapshot: <a href="https://counsel.day/admin-security.html" style="color: #722F37;">counsel.day/admin-security.html</a></p>
    <p style="font-family: 'Geist Mono', monospace; font-size: 11px; color: #6b635a; margin-top: 24px;">&middot; Counsel.day</p>
  `.trim();

  await sendTransactional({
    to: { email: opsEmail, name: 'Counsel.day operator' },
    subject: 'Counsel.day · security audit · ' + critical + ' critical, ' + high + ' high',
    textContent: text,
    htmlContent: html,
  });

  // Audit-log the run so /admin-audit-log.html surfaces it.
  await db.insert(schema.auditLog).values({
    action: 'cron.security_audit.alert',
    targetType: 'cron',
    metadata: {
      critical, high, moderate,
      auto_applicable: proposal.autoApplicableCount,
      breaking: proposal.breakingCount,
    },
  }).catch(() => {});

  console.log('[cron · security-audit] alert email sent to ' + opsEmail);
}

// Minimal HTML escape · used inside the security-audit email builder.
function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

async function main() {
  const job = process.argv[2];
  switch (job) {
    case 'evening-prompt':       return runWithHeartbeat(job, eveningPrompt);
    case 'verdict-generate':     return runWithHeartbeat(job, verdictGenerate);
    case 'session-purge':        return runWithHeartbeat(job, sessionPurge);
    case 'invite-expiry':        return runWithHeartbeat(job, inviteExpiry);
    case 'invite-reminder':      return runWithHeartbeat(job, inviteReminder);
    case 'hard-delete-purge':    return runWithHeartbeat(job, hardDeletePurge);
    case 'audit-prune':          return runWithHeartbeat(job, auditPrune);
    case 'time-capsule-deliver': return runWithHeartbeat(job, timeCapsuleDeliver);
    case 'weekly-digest':        return runWithHeartbeat(job, weeklyDigest);
    case 'security-audit':       return runWithHeartbeat(job, securityAudit);
    case 'verdict-tts':          return runWithHeartbeat(job, verdictTts);
    case 'journal-digest':       return runWithHeartbeat(job, journalDigest);
    default:
      console.error(`Unknown job: ${job}. Valid: evening-prompt, verdict-generate, session-purge, invite-expiry, invite-reminder, hard-delete-purge, audit-prune, time-capsule-deliver, weekly-digest, security-audit, journal-digest`);
      process.exit(2);
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('cron crashed:', err);
  process.exit(1);
});
