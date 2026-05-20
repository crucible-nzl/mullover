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
      sql`${t.status} IN ('pending_invites', 'active', 'sealed', 'verdict_generating', 'completed', 'cancelled', 'refunded')`
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
  },
  (t) => ({
    decisionUnique: uniqueIndex('verdicts_decision_unique').on(t.decisionId),
  })
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
