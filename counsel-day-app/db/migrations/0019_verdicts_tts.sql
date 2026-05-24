-- 0019 · TTS audio URL + cost tracking on verdicts
--
-- The verdict-generation cron synthesises a 600-1200 word paragraph via
-- Anthropic and stores it in verdicts.synthesis_text. After that runs,
-- a follow-up step (verdictTts in cron.ts) calls OpenAI TTS to narrate
-- the synthesis in a calm voice and stores the resulting MP3 on disk
-- under /var/www/counsel.day/verdicts/<verdict_id>.mp3 · served by
-- Caddy at https://counsel.day/verdicts/<verdict_id>.mp3.
--
-- This migration adds the column the cron writes to, plus a cost
-- column so the admin can see per-verdict TTS spend without parsing
-- the audit_log. Both columns are nullable · audio is optional and
-- existing verdicts have neither.

BEGIN;

ALTER TABLE verdicts
  ADD COLUMN IF NOT EXISTS tts_audio_url TEXT,
  ADD COLUMN IF NOT EXISTS tts_cost_cents INTEGER,
  ADD COLUMN IF NOT EXISTS tts_generated_at TIMESTAMPTZ;

-- Index so the verdictTts backfill cron doesn't seq-scan looking for
-- verdicts that have no audio yet. Partial index keeps it small.
CREATE INDEX IF NOT EXISTS verdicts_missing_tts_idx
  ON verdicts (id)
  WHERE tts_audio_url IS NULL AND synthesis_text IS NOT NULL;

COMMIT;
