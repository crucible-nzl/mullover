-- 0011 · verdict premium report
--
-- Adds the NLP analysis payload to the existing verdicts table and the
-- new verdict_time_capsules table that drives 6 / 12 / 24-month re-delivery
-- emails opted into from /verdict-report.html.
--
-- analysis_json shape (versioned · see counsel-day-app/python/analyse_verdict.py
-- for the writer and src/app/api/verdict-report/route.ts for the reader):
--
--   {
--     "version": 1,
--     "vote_matrix": [...],        per-day cross-partner direction + note
--     "trajectory": [...],         per-day score per partner for the chart
--     "participants": [...],       per-partner summary, sentiment, word cloud
--     "themes": [...],             AI-extracted + spaCy-validated themes
--     "asymmetries": [...],        per-partner unique vocab + AI observations
--     "vocabulary_overlap": {...}, common / partner-only word sets
--     "next_conversation_prompt": "..."
--   }
--
-- The column is NULLable so existing verdict rows (Opus runs before this
-- migration) keep working · the report page renders a basic view from the
-- prose-only data when analysis_json is null.

ALTER TABLE verdicts ADD COLUMN IF NOT EXISTS analysis_json JSONB;

CREATE TABLE IF NOT EXISTS verdict_time_capsules (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    decision_id   UUID NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    interval_months INTEGER NOT NULL CHECK (interval_months IN (6, 12, 24)),
    deliver_at    TIMESTAMPTZ NOT NULL,
    delivered_at  TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (decision_id, user_id, interval_months)
);

CREATE INDEX IF NOT EXISTS verdict_time_capsules_deliver_idx
    ON verdict_time_capsules (deliver_at)
    WHERE delivered_at IS NULL;
