/**
 * Counsel.day · canonical database schema (Drizzle ORM).
 *
 * v1 covers: users + auth, decisions + participants + votes, verdicts,
 * consent log, audit log. Every change here MUST be paired with a new
 * numbered migration in db/migrations/. Never edit a shipped migration;
 * always add a new one.
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  numeric,
  date,
  jsonb,
  inet,
  uniqueIndex,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// USERS · the account holder. One row per real person.
// ---------------------------------------------------------------------------
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    firstName: text('first_name'),
    passwordHash: text('password_hash'), // null until they set a password
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    marketingConsent: boolean('marketing_consent').notNull().default(false),
    decisionKindIntent: text('decision_kind_intent'), // 'solo' | 'couple' | 'family' | 'exploring'
    currentPlan: text('current_plan').notNull().default('free'),
    stripeCustomerId: text('stripe_customer_id'),
    isAdmin: boolean('is_admin').notNull().default(false),
    // Comp flag · operator-granted "unlimited free decisions". Set by
    // an admin via /admin-users PATCH comp_grant. See migration 0023.
    compUnlimited: boolean('comp_unlimited').notNull().default(false),
    compReason: text('comp_reason'),
    compGrantedAt: timestamp('comp_granted_at', { withTimezone: true }),
    compGrantedBy: uuid('comp_granted_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    emailUnique: uniqueIndex('users_email_unique').on(t.email),
    stripeUnique: uniqueIndex('users_stripe_unique').on(t.stripeCustomerId),
    planCheck: check(
      'users_plan_check',
      sql`${t.currentPlan} IN ('free', 'solo', 'couple', 'family', 'consumer_annual')`
    ),
  })
);

// ---------------------------------------------------------------------------
// SESSIONS · server-side session store. Cookie holds only the session id.
// ---------------------------------------------------------------------------
export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(), // opaque random token
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    userAgent: text('user_agent'),
    ipAddress: inet('ip_address'),
    mfaVerifiedAt: timestamp('mfa_verified_at', { withTimezone: true }),
    // Touched on every authed request by readSession. Drives the
    // "Last active" column on /admin-users instead of the stale
    // MAX(sessions.created_at) we used before.
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('sessions_user_idx').on(t.userId),
    expiresIdx: index('sessions_expires_idx').on(t.expiresAt),
  })
);

// ---------------------------------------------------------------------------
// EMAIL VERIFICATION TOKENS · single-use, 1-hour expiry by default.
// ---------------------------------------------------------------------------
export const emailVerificationTokens = pgTable(
  'email_verification_tokens',
  {
    token: text('token').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    email: text('email').notNull(), // record the email at issue time
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('evt_user_idx').on(t.userId),
  })
);

// ---------------------------------------------------------------------------
// PASSWORD RESET TOKENS · single-use, 30-minute expiry.
// ---------------------------------------------------------------------------
export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    token: text('token').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('prt_user_idx').on(t.userId),
  })
);

// ---------------------------------------------------------------------------
// DECISIONS · the unit of work. One row per question being decided.
// ---------------------------------------------------------------------------
export const decisions = pgTable(
  'decisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    question: text('question').notNull(),
    format: text('format').notNull(), // 'yes_no' | 'strong_lean' | 'a_b'
    durationDays: integer('duration_days').notNull(),
    tier: text('tier').notNull(), // 'solo_free' | 'solo_paid' | 'couple' | 'family'
    status: text('status').notNull().default('pending_invites'),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    unsealsAt: timestamp('unseals_at', { withTimezone: true }),
    stripePaymentIntentId: text('stripe_payment_intent_id'),
    amountPaidCents: integer('amount_paid_cents').notNull().default(0),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    refundedAt: timestamp('refunded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    ownerIdx: index('decisions_owner_idx').on(t.ownerUserId),
    statusIdx: index('decisions_status_idx').on(t.status),
    formatCheck: check(
      'decisions_format_check',
      sql`${t.format} IN ('yes_no', 'strong_lean', 'a_b')`
    ),
    tierCheck: check(
      'decisions_tier_check',
      sql`${t.tier} IN ('solo_free', 'solo_paid', 'couple', 'family')`
    ),
    statusCheck: check(
      'decisions_status_check',
      sql`${t.status} IN ('pending_payment', 'pending_invites', 'active', 'sealed', 'verdict_generating', 'completed', 'cancelled', 'refunded')`
    ),
    durationCheck: check(
      'decisions_duration_check',
      sql`${t.durationDays} BETWEEN 7 AND 365`
    ),
  })
);

// ---------------------------------------------------------------------------
// PARTICIPANTS · 1 row for solo, 2 for couple, 3-6 for family.
// ---------------------------------------------------------------------------
export const participants = pgTable(
  'participants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    decisionId: uuid('decision_id')
      .notNull()
      .references(() => decisions.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    inviteEmail: text('invite_email'),
    inviteToken: text('invite_token'),
    inviteAcceptedAt: timestamp('invite_accepted_at', { withTimezone: true }),
    displayName: text('display_name').notNull(),
    position: integer('position').notNull(), // 1, 2, 3...
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    decisionIdx: index('participants_decision_idx').on(t.decisionId),
    userIdx: index('participants_user_idx').on(t.userId),
    inviteTokenUnique: uniqueIndex('participants_invite_token_unique').on(t.inviteToken),
    decisionPositionUnique: uniqueIndex('participants_decision_position_unique').on(
      t.decisionId,
      t.position
    ),
  })
);

// ---------------------------------------------------------------------------
// VOTES · one per participant per day. SEALED at insert; never readable
// (by anyone other than the voter) until decisions.unsealsAt passes.
// ---------------------------------------------------------------------------
export const votes = pgTable(
  'votes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    decisionId: uuid('decision_id')
      .notNull()
      .references(() => decisions.id, { onDelete: 'cascade' }),
    participantId: uuid('participant_id')
      .notNull()
      .references(() => participants.id, { onDelete: 'cascade' }),
    voteDate: date('vote_date').notNull(),
    direction: text('direction').notNull(),
    conviction: numeric('conviction', { precision: 3, scale: 2 }),
    note: text('note'),
    sealedAt: timestamp('sealed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    decisionDateIdx: index('votes_decision_date_idx').on(t.decisionId, t.voteDate),
    participantIdx: index('votes_participant_idx').on(t.participantId),
    participantDateUnique: uniqueIndex('votes_participant_date_unique').on(
      t.participantId,
      t.voteDate
    ),
    directionCheck: check(
      'votes_direction_check',
      sql`${t.direction} IN ('yes', 'no', 'strong_yes', 'lean_yes', 'lean_no', 'strong_no', 'a', 'b')`
    ),
  })
);

// ---------------------------------------------------------------------------
// VERDICTS · one per decision, generated by Claude after unsealsAt.
// ---------------------------------------------------------------------------
export const verdicts = pgTable(
  'verdicts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    decisionId: uuid('decision_id')
      .notNull()
      .references(() => decisions.id, { onDelete: 'cascade' }),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
    aiModel: text('ai_model'),
    synthesisText: text('synthesis_text'),
    perParticipantSummary: jsonb('per_participant_summary'),
    themes: jsonb('themes'),
    nextConversationPrompt: text('next_conversation_prompt'),
    promptUsed: text('prompt_used'),
    tokensInput: integer('tokens_input'),
    tokensOutput: integer('tokens_output'),
    costCents: integer('cost_cents'),
    // Premium-report payload computed by python/analyse_verdict.py at
    // cron-time and stored frozen. Shape documented in
    // db/migrations/0011_verdict_analysis_and_time_capsules.sql.
    analysisJson: jsonb('analysis_json'),
    // TTS narration · written by verdictTts() in cron.ts after the
    // synthesis is generated. Audio served by Caddy from
    // /var/www/counsel.day/verdicts/<id>.mp3.
    ttsAudioUrl: text('tts_audio_url'),
    ttsCostCents: integer('tts_cost_cents'),
    ttsGeneratedAt: timestamp('tts_generated_at', { withTimezone: true }),
  },
  (t) => ({
    decisionUnique: uniqueIndex('verdicts_decision_unique').on(t.decisionId),
  })
);

// ---------------------------------------------------------------------------
// VERDICT TEST RUNS · /admin-testing-area persists every Anthropic call here
// so /admin overview can sum real spend and /admin-verdict-logs can show a
// "Testing verdicts" tab next to production. Mirrors verdicts but stores the
// operator-supplied fixture too (questions/votes/notes that wouldn't exist
// on a real decision row).
// ---------------------------------------------------------------------------
export const verdictTestRuns = pgTable(
  'verdict_test_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    triggeredByUserId: uuid('triggered_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    question: text('question').notNull(),
    format: text('format').notNull(),
    durationDays: integer('duration_days').notNull(),
    tier: text('tier').notNull(),
    participantsJson: jsonb('participants_json').notNull(),
    aiModel: text('ai_model'),
    synthesisText: text('synthesis_text'),
    promptUsed: text('prompt_used'),
    tokensInput: integer('tokens_input'),
    tokensOutput: integer('tokens_output'),
    costCents: integer('cost_cents'),
    analysisJson: jsonb('analysis_json'),
    label: text('label'),
  }
);

// ---------------------------------------------------------------------------
// ANTHROPIC CALLS · self-tracked ledger of every messages.create() call.
// Anthropic's Admin API has multi-hour ingestion lag; this table is the
// single source of truth for what Counsel.day has actually spent in the
// product (verdicts, testing area, future chatbot). All inserts go
// through src/lib/anthropic-call.ts so no path can forget to log.
// ---------------------------------------------------------------------------
export const anthropicCalls = pgTable(
  'anthropic_calls',
  {
    id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
    calledAt: timestamp('called_at', { withTimezone: true }).notNull().defaultNow(),
    source: text('source').notNull(),
    model: text('model').notNull(),
    tokensInput: integer('tokens_input').notNull().default(0),
    tokensOutput: integer('tokens_output').notNull().default(0),
    costCents: integer('cost_cents').notNull().default(0),
    decisionId: uuid('decision_id').references(() => decisions.id, { onDelete: 'set null' }),
    testRunId: uuid('test_run_id').references(() => verdictTestRuns.id, { onDelete: 'set null' }),
    requestId: text('request_id'),
    durationMs: integer('duration_ms').notNull().default(0),
    ok: boolean('ok').notNull().default(true),
    error: text('error'),
  }
);

// ---------------------------------------------------------------------------
// CHATBOT QUERIES · captures every user → helper-bot turn for KB tuning.
// Cost metadata lives in anthropic_calls; this table stores the actual
// prompt + reply text. Linked by anthropic_call_id for cross-pivot.
// ---------------------------------------------------------------------------
export const chatbotQueries = pgTable(
  'chatbot_queries',
  {
    id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
    askedAt: timestamp('asked_at', { withTimezone: true }).notNull().defaultNow(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    question: text('question').notNull(),
    reply: text('reply').notNull(),
    escalated: boolean('escalated').notNull().default(false),
    tokensInput: integer('tokens_input').notNull().default(0),
    tokensOutput: integer('tokens_output').notNull().default(0),
    durationMs: integer('duration_ms').notNull().default(0),
    anthropicCallId: integer('anthropic_call_id').references(() => anthropicCalls.id, { onDelete: 'set null' }),
  }
);

// ---------------------------------------------------------------------------
// PROMPTS · versioned AI system prompts. Reads via lib/prompts.ts with a
// 5-min in-memory cache. New versions are saved from /admin-prompt-editor
// without a code deploy.
// ---------------------------------------------------------------------------
export const prompts = pgTable(
  'prompts',
  {
    id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
    kind: text('kind').notNull(),
    version: integer('version').notNull(),
    text: text('text').notNull(),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    isActive: boolean('is_active').notNull().default(false),
  }
);

// ---------------------------------------------------------------------------
// VERDICT SHARES · tokenised public share links for paid verdicts. Owner
// generates a token via /api/verdict-report/share, sends the URL to the
// recipient, who reads /share.html?token=<token> without an account.
// ---------------------------------------------------------------------------
export const verdictShares = pgTable(
  'verdict_shares',
  {
    id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
    decisionId: uuid('decision_id').notNull().references(() => decisions.id, { onDelete: 'cascade' }),
    ownerUserId: uuid('owner_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull(),
    allowPartnerNames: boolean('allow_partner_names').notNull().default(true),
    allowAnalysis: boolean('allow_analysis').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    viewCount: integer('view_count').notNull().default(0),
    lastViewedAt: timestamp('last_viewed_at', { withTimezone: true }),
  }
);

// ---------------------------------------------------------------------------
// VERDICT TIME CAPSULES · 6 / 12 / 24-month opt-in re-delivery emails.
// One row per (decision, user, interval) triple. Cron job
// time-capsule-deliver scans for delivered_at IS NULL AND deliver_at <= NOW().
// ---------------------------------------------------------------------------
export const verdictTimeCapsules = pgTable(
  'verdict_time_capsules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    decisionId: uuid('decision_id')
      .notNull()
      .references(() => decisions.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    intervalMonths: integer('interval_months').notNull(),
    deliverAt: timestamp('deliver_at', { withTimezone: true }).notNull(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  }
);

// ---------------------------------------------------------------------------
// CONSENT LOG · GDPR audit trail. Every consent decision recorded.
// ---------------------------------------------------------------------------
export const consentLog = pgTable(
  'consent_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    anonId: text('anon_id'), // for pre-signup consent
    consentType: text('consent_type').notNull(),
    granted: boolean('granted').notNull(),
    source: text('source'),
    ipAddress: inet('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('consent_log_user_idx').on(t.userId),
  })
);

// ---------------------------------------------------------------------------
// SAVED CONTACTS · people the user has invited to a decision (partner, family),
// auto-saved on /api/compose so they can quick-pick on the next compose.
// ---------------------------------------------------------------------------
export const savedContacts = pgTable(
  'saved_contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    displayName: text('display_name').notNull(),
    email: text('email').notNull(),
    relationship: text('relationship'), // 'partner' | 'family' | 'friend' | 'other'
    lastInvitedAt: timestamp('last_invited_at', { withTimezone: true }),
    inviteCount: integer('invite_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('saved_contacts_user_idx').on(t.userId, t.lastInvitedAt),
    // Email is always lowercased before insert (zod .toLowerCase()) so a
    // plain unique index works · Drizzle cannot target a functional index.
    userEmailUnique: uniqueIndex('saved_contacts_user_email_unique').on(t.userId, t.email),
    relationshipCheck: check(
      'saved_contacts_relationship_check',
      sql`${t.relationship} IS NULL OR ${t.relationship} IN ('partner', 'family', 'friend', 'other')`
    ),
  })
);

// ---------------------------------------------------------------------------
// MFA · per-user TOTP secret + recovery codes, plus short-lived
// challenge tokens issued during the two-step sign-in flow.
// ---------------------------------------------------------------------------
export const mfaSecrets = pgTable('mfa_secrets', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  secret: text('secret').notNull(),
  recoveryCodes: jsonb('recovery_codes').notNull().default([]),
  enabledAt: timestamp('enabled_at', { withTimezone: true }),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const mfaChallenges = pgTable(
  'mfa_challenges',
  {
    id: text('id').primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    attempts: integer('attempts').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    expiresIdx: index('mfa_challenges_expires_idx').on(t.expiresAt),
  })
);

// ---------------------------------------------------------------------------
// RATE LIMITS · fixed-window counter keyed by "<scope>:<value>". Application
// code does key construction (e.g. "signin-ip:1.2.3.4"). One row per bucket.
// See lib/rate-limit.ts for the helper.
// ---------------------------------------------------------------------------
export const rateLimits = pgTable(
  'rate_limits',
  {
    key: text('key').primaryKey(),
    count: integer('count').notNull().default(0),
    resetAt: timestamp('reset_at', { withTimezone: true }).notNull().defaultNow(),
    lastHitAt: timestamp('last_hit_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    resetIdx: index('rate_limits_reset_idx').on(t.resetAt),
  })
);

// ---------------------------------------------------------------------------
// PRODUCTS · admin-editable price list. Stripe Prices remain the source of
// truth for billing; this table is the presentational layer + admin's
// window into which Stripe Price object maps to each tier.
// ---------------------------------------------------------------------------
export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull().unique(),
    name: text('name').notNull(),
    description: text('description'),
    priceCents: integer('price_cents').notNull(),
    currency: text('currency').notNull().default('USD'),
    stripePriceId: text('stripe_price_id'),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(100),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => ({
    activeIdx: index('products_active_idx').on(t.isActive, t.sortOrder),
  })
);

// ---------------------------------------------------------------------------
// PRACTITIONER_APPLICATIONS · intake for the referral program (counsellors +
// therapists). Form lives at /apply-practitioner.html; admin reviews
// manually before issuing a referral code + Stripe coupon.
// ---------------------------------------------------------------------------
export const practitionerApplications = pgTable(
  'practitioner_applications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind').notNull(), // 'counsellor' | 'therapist'
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    email: text('email').notNull(),
    phone: text('phone'),
    practiceName: text('practice_name').notNull(),
    role: text('role').notNull(),
    professionalBody: text('professional_body'),
    country: text('country').notNull(),
    city: text('city'),
    yearsInPractice: text('years_in_practice'),
    activeClients: text('active_clients'),
    expectedReferralsPerMonth: text('expected_referrals_per_month').notNull(),
    payoutMethod: text('payout_method').notNull(),
    clientFocus: text('client_focus'),
    website: text('website'),
    notes: text('notes'),
    status: text('status').notNull().default('pending'),
    referralCode: text('referral_code'),
    stripeCouponId: text('stripe_coupon_id'),
    reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index('practitioner_applications_status_idx').on(t.status, t.createdAt),
  })
);

// ---------------------------------------------------------------------------
// PUSH SUBSCRIPTIONS · Web Push endpoint per (user, browser/device). The
// p256dh + auth keys are the asymmetric pieces the push library needs to
// encrypt payloads to that specific subscription.
// ---------------------------------------------------------------------------
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastErrorAt: timestamp('last_error_at', { withTimezone: true }),
    lastError: text('last_error'),
  },
  (t) => ({
    userIdx: index('push_subscriptions_user_idx').on(t.userId),
    userEndpointUnique: uniqueIndex('push_subscriptions_user_endpoint_unique').on(t.userId, t.endpoint),
  })
);

// ---------------------------------------------------------------------------
// STRIPE WEBHOOK EVENTS · idempotency cache. event_id is the Stripe-assigned
// `evt_…` value; PK conflict on re-delivery short-circuits the handler.
// ---------------------------------------------------------------------------
export const stripeWebhookEvents = pgTable(
  'stripe_webhook_events',
  {
    eventId: text('event_id').primaryKey(),
    eventType: text('event_type').notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    typeIdx: index('stripe_webhook_events_type_idx').on(t.eventType, t.processedAt),
  })
);

// ---------------------------------------------------------------------------
// AUDIT LOG · every admin action recorded. Read-only after insert.
// ---------------------------------------------------------------------------
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorUserId: uuid('actor_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: uuid('target_id'),
    metadata: jsonb('metadata'),
    ipAddress: inet('ip_address'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    actorIdx: index('audit_log_actor_idx').on(t.actorUserId),
    actionIdx: index('audit_log_action_idx').on(t.action),
  })
);
