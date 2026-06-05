-- 0031 · journal_verdict_test_runs · admin testing harness for Journal verdicts
--
-- Parallels verdict_test_runs (Decision testing). Stores every test run
-- the operator fires from /admin-journal-testing.html: the fixture
-- entries, the prompt used, the AI synthesis fields (positives, strains,
-- throughline, question), token + cost, and which admin triggered it.
--
-- No back-pointer to a production journal_verdicts row. Test runs are
-- entirely separate · they do not write production verdicts, do not
-- send email, do not affect any user's vault.
--
-- The `kind` column distinguishes the three modes the test page supports:
--   weekly                · 7 entries → 1 weekly verdict (1 Claude call)
--   monthly_full_pipeline · 30 entries → 4 weekly verdicts → 1 monthly themed (5 Claude calls)
--   monthly_direct        · 30 entries → 1 monthly verdict directly (1 Claude call)
--
-- For full-pipeline runs, the four intermediate weekly verdicts are
-- stored in `intermediate_verdicts_json` so the operator can inspect
-- what the monthly themed verdict was synthesised FROM, not just the
-- final output.

CREATE TABLE IF NOT EXISTS journal_verdict_test_runs (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Test setup
  kind                        TEXT NOT NULL CHECK (kind IN ('weekly', 'monthly_full_pipeline', 'monthly_direct')),
  fixture_label               TEXT,                -- optional human label · "solid week", "stressful month" etc.
  entries_json                JSONB NOT NULL,      -- [{ entry_date, text_content }, ...]

  -- AI call config
  ai_model                    TEXT NOT NULL,
  prompt_used                 TEXT NOT NULL,       -- the resolved system prompt at call time
  monthly_prompt_used         TEXT,                -- monthly themed prompt (only for monthly modes)

  -- AI output · the final user-facing verdict
  positives_json              JSONB NOT NULL DEFAULT '[]'::jsonb,
  strains_json                JSONB NOT NULL DEFAULT '[]'::jsonb,
  throughline                 TEXT NOT NULL,
  question_for_next           TEXT NOT NULL,

  -- For monthly_full_pipeline: the four intermediate weekly verdicts
  -- that were fed into the final monthly synthesis. Each entry has the
  -- same shape as the final output above. Null for other modes.
  intermediate_verdicts_json  JSONB,

  -- Cost tracking · sum across all Anthropic calls for this run
  tokens_input                INTEGER NOT NULL DEFAULT 0,
  tokens_output               INTEGER NOT NULL DEFAULT 0,
  cost_cents                  INTEGER NOT NULL DEFAULT 0,
  anthropic_call_count        INTEGER NOT NULL DEFAULT 1,

  -- Audit
  triggered_by_user_id        UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS journal_verdict_test_runs_created_at_idx
  ON journal_verdict_test_runs (created_at DESC);
CREATE INDEX IF NOT EXISTS journal_verdict_test_runs_triggered_by_idx
  ON journal_verdict_test_runs (triggered_by_user_id);
CREATE INDEX IF NOT EXISTS journal_verdict_test_runs_kind_idx
  ON journal_verdict_test_runs (kind);
