-- 0012 · session activity tracking + testing-area persistence
--
-- A · sessions.last_active_at
--   Currently /admin-users displays "Last sign-in" as MAX(sessions.created_at)
--   per user. For a user staying on the same 30-day session the column never
--   moves, which reads as a bug ("why is the timestamp from two days ago?").
--   This adds a column that the session-read middleware touches on every
--   authed request. /admin-users renames the column to "Last active" and
--   surfaces it from this new field.
--
-- B · verdict_test_runs
--   /admin-testing-area currently runs against the real Anthropic API but
--   returns the result inline only · nothing is persisted. That means:
--     · the Anthropic spend on /admin overview reads $0 even when there's
--       real $-on-the-bill testing cost (Task 3)
--     · the operator can't go back and inspect a testing run after the
--       page refreshes (Task 5)
--   New table mirrors verdicts but stores the operator-supplied fixture
--   so the run can be re-displayed. Joined into /admin-verdict-logs under
--   a "Testing verdicts" tab.

ALTER TABLE sessions
    ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Backfill: any existing sessions get their created_at as the seed value.
UPDATE sessions SET last_active_at = created_at WHERE last_active_at IS NULL OR last_active_at < created_at;

CREATE INDEX IF NOT EXISTS sessions_user_active_idx ON sessions (user_id, last_active_at DESC);

CREATE TABLE IF NOT EXISTS verdict_test_runs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    triggered_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Fixture supplied by the operator
    question            TEXT NOT NULL,
    format              TEXT NOT NULL,
    duration_days       INTEGER NOT NULL,
    tier                TEXT NOT NULL,
    participants_json   JSONB NOT NULL,  -- [{ display_name, votes: [...] }]

    -- Anthropic call result
    ai_model            TEXT,
    synthesis_text      TEXT,
    prompt_used         TEXT,
    tokens_input        INTEGER,
    tokens_output       INTEGER,
    cost_cents          INTEGER,
    analysis_json       JSONB,           -- python/analyse_verdict.py output

    -- Operator-supplied label so a tuning session can be tagged for later
    label               TEXT
);

CREATE INDEX IF NOT EXISTS verdict_test_runs_created_idx ON verdict_test_runs (created_at DESC);
CREATE INDEX IF NOT EXISTS verdict_test_runs_user_idx ON verdict_test_runs (triggered_by_user_id, created_at DESC);
