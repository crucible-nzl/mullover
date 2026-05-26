-- 0029 · decisions pulse mode + 6-month re-check timestamps
--
-- PULSE MODE: a flagship decision that never closes. Same evening
-- mechanic, but unseals_at is NULL and the verdict cron generates a
-- rolling 30-day verdict at user request (or monthly auto). Lets a
-- user ask "how am I feeling about the marriage / the job / the city
-- this month" in a 30-day rolling window. Distinct from a daily
-- journal because it pins to a specific question and the verdict is
-- structured (themes + trajectory + question) not free-form positives.
--
-- 6-MONTH RE-CHECK: when a closed flagship decision wants to be
-- revisited later, reopen_at stores the ISO timestamp · the
-- evening-prompt cron picks up rows where reopen_at <= NOW() and
-- emails the user "six months ago you decided X · re-vote for 14
-- nights to see if your conviction has shifted." When the user
-- accepts, /api/decision/restart spawns a new decision pre-filled
-- with the original question + a back-pointer to the parent.
--
-- mode column · 'standard' for the current 7-90 night sealed flagship,
-- 'pulse' for the always-on variant.

ALTER TABLE decisions
  ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS reopen_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reopen_of UUID REFERENCES decisions(id) ON DELETE SET NULL;

ALTER TABLE decisions
  DROP CONSTRAINT IF EXISTS decisions_mode_check;

ALTER TABLE decisions
  ADD CONSTRAINT decisions_mode_check CHECK (mode IN ('standard', 'pulse'));

-- Pulse rows must have unseals_at NULL (the contract); standard rows
-- must have unseals_at SET. Keep the existing duration check loose for
-- pulse rows since 7-365 is meaningless there.
ALTER TABLE decisions
  DROP CONSTRAINT IF EXISTS decisions_duration_check;

ALTER TABLE decisions
  ADD CONSTRAINT decisions_duration_check CHECK (
    (mode = 'pulse')
    OR (duration_days BETWEEN 7 AND 365)
  );

CREATE INDEX IF NOT EXISTS decisions_mode_idx ON decisions (mode);
CREATE INDEX IF NOT EXISTS decisions_reopen_at_idx ON decisions (reopen_at) WHERE reopen_at IS NOT NULL;
