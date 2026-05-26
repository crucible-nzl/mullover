-- 0030 · ranked-options vote format
--
-- New decision format alongside yes_no, strong_lean, a_b. The
-- composer specifies 3-6 options (e.g. four cities, five career
-- paths, three job offers). Each evening the user drags-to-rank them.
-- Stored as votes.ranked_order (jsonb array of option indices). The
-- verdict cron tallies which option appeared #1 most often, which
-- was last most often, and the conviction trajectory of #1 picks.
--
-- This unlocks two big classes of decision the consumer product
-- currently can't serve: "which of these 5 cities" / "which job
-- offer" / "which uni" · AND becomes the killer development-conversation
-- format on Counsel · Teams (rank these career paths nightly for 30
-- days).
--
-- Options are stored on the decision row as jsonb (decisions.options)
-- to avoid a JOIN on the hot path. Vote rows carry the ordering as
-- jsonb array of indices into the parent decision's options array.
-- Conviction column gets re-used as the conviction in the #1 pick.

ALTER TABLE decisions
  ADD COLUMN IF NOT EXISTS options JSONB; -- ["Wellington", "Auckland", "Christchurch", "Tauranga"]

-- Re-create the format check to include the new value.
ALTER TABLE decisions DROP CONSTRAINT IF EXISTS decisions_format_check;
ALTER TABLE decisions
  ADD CONSTRAINT decisions_format_check CHECK (
    format IN ('yes_no', 'strong_lean', 'a_b', 'ranked')
  );

-- The vote row carries the user's ranking as jsonb (array of indices).
-- The direction column stays nullable for ranked votes (use 'ranked'
-- sentinel value to satisfy the existing direction check).
ALTER TABLE votes
  ADD COLUMN IF NOT EXISTS ranked_order JSONB; -- [2, 0, 1, 3] = top pick is options[2]

-- Loosen the direction enum to include 'ranked'. Existing rows are
-- unaffected · we just permit the new value.
ALTER TABLE votes DROP CONSTRAINT IF EXISTS votes_direction_check;
ALTER TABLE votes
  ADD CONSTRAINT votes_direction_check CHECK (
    direction IN ('yes', 'no', 'strong_yes', 'lean_yes', 'lean_no', 'strong_no', 'a', 'b', 'ranked')
  );
