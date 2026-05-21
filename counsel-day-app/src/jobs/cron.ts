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

      const call = await callAnthropic(
        { source: 'verdict_cron', decisionId: d.id },
        {
          model: VERDICT_MODEL,
          max_tokens: 2000,
          system: [
            { type: 'text', text: VERDICT_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
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

      await db.insert(schema.verdicts).values({
        decisionId: d.id,
        aiModel: VERDICT_MODEL,
        synthesisText: synthesis,
        themes: (structured?.themes ?? null) as unknown,
        promptUsed: VERDICT_SYSTEM_PROMPT,
        tokensInput: call.tokensInput,
        tokensOutput: call.tokensOutput,
        // Cost mirrors what callAnthropic just logged to anthropic_calls
        // · single source of truth via lib/anthropic-pricing.ts.
        costCents: call.costCents,
        analysisJson: analysis as unknown,
      });

      await db
        .update(schema.decisions)
        .set({ status: 'completed', updatedAt: new Date() })
        .where(eq(schema.decisions.id, d.id));

      // Email each participant that their verdict is ready
      const participantEmails = await db.execute(sql`
        SELECT u.email, u.first_name FROM participants p
        JOIN users u ON u.id = p.user_id
        WHERE p.decision_id = ${d.id} AND p.user_id IS NOT NULL
      `);
      for (const p of participantEmails as unknown as Array<{ email: string; first_name: string | null }>) {
        const greeting = p.first_name ? `Hi ${p.first_name},` : 'Hi,';
        const url = `${APP_BASE_URL}/verdict-reveal?decision=${d.id}`;
        await sendTransactional({
          to: { email: p.email, name: p.first_name ?? undefined },
          subject: 'Your verdict is ready',
          textContent: `${greeting}\n\nYour decision has reached day ${d.durationDays}. Both verdicts are now open:\n\n${url}\n\n· Counsel.day`,
          htmlContent: `<p>${greeting}</p><p>Your decision has reached day ${d.durationDays}. Both verdicts are now open:</p><p><a href="${url}" style="color: #722F37;">${url}</a></p><p>· Counsel.day</p>`,
        });
      }
      console.log(`[cron · verdict-generate] decision ${d.id}: verdict written, participants emailed`);
    } catch (err) {
      console.error(`[cron · verdict-generate] decision ${d.id} failed:`, err);
      // Flip back to 'active' so the next cron run retries it
      await db.update(schema.decisions).set({ status: 'active', updatedAt: new Date() }).where(eq(schema.decisions.id, d.id));
    }
  }
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
  const general = await db.execute(sql`
    DELETE FROM audit_log
    WHERE created_at < NOW() - INTERVAL '24 months'
      AND action NOT LIKE 'refund.%'
      AND action <> 'user.hard_delete_purged'
    RETURNING id
  `);
  const financial = await db.execute(sql`
    DELETE FROM audit_log
    WHERE created_at < NOW() - INTERVAL '7 years'
      AND (action LIKE 'refund.%' OR action = 'user.hard_delete_purged')
    RETURNING id
  `);
  const gCount = (general as unknown as Array<unknown>).length;
  const fCount = (financial as unknown as Array<unknown>).length;
  console.log(`[cron · audit-prune] removed ${gCount} general + ${fCount} financial audit_log rows`);
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
    default:
      console.error(`Unknown job: ${job}. Valid: evening-prompt, verdict-generate, session-purge, invite-expiry, invite-reminder, hard-delete-purge, audit-prune, time-capsule-deliver`);
      process.exit(2);
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('cron crashed:', err);
  process.exit(1);
});
