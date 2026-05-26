-- 0027 · vote tags · follow-up chips on low-conviction / negative votes
--
-- Inspired by the business-professional review: when someone votes
-- "no" or with low conviction, the UI now asks a follow-up · a short
-- bank of chips (workload, sleep, time, money, the other person,
-- something else). The selected chip becomes a tag on the vote.
-- The verdict cron clusters tags across votes to produce theme insight
-- that's grounded in cause, not just direction.
--
-- jsonb (not text[]) so we can later add chip-specific notes per tag
-- without another migration. Always an array; empty = no tags.

ALTER TABLE votes
  ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS votes_tags_gin_idx ON votes USING gin (tags);
