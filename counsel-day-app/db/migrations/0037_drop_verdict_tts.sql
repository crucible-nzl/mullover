-- 0037 · remove verdict TTS narration
--
-- Product decision 2026-08-10: the spoken-word narration of the verdict is
-- withdrawn. The verdict is delivered as text only. This reverses migration
-- 0019, which added the audio columns and the backfill index. The OpenAI
-- integration for TTS (src/lib/tts.ts, the verdictTts backfill cron, and the
-- inline call in verdictGenerate) has been removed from the codebase, and the
-- verdict-reveal page no longer renders an audio player.
--
-- OpenAI is still used for Whisper voice-to-text on the daily note, so the
-- OPENAI_API_KEY stays; only the TTS-specific env (OPENAI_TTS_MODEL,
-- OPENAI_TTS_VOICE, VERDICTS_AUDIO_DIR, VERDICTS_AUDIO_PUBLIC_BASE,
-- TTS_DAILY_BUDGET_USD) is now unused.
--
-- Pre-launch there are no real verdicts, so no audio files need cleaning up.
-- Any historical audit_log rows with action='tts.openai' are left in place as
-- an immutable record.

BEGIN;

DROP INDEX IF EXISTS verdicts_missing_tts_idx;

ALTER TABLE verdicts
  DROP COLUMN IF EXISTS tts_audio_url,
  DROP COLUMN IF EXISTS tts_cost_cents,
  DROP COLUMN IF EXISTS tts_generated_at;

COMMIT;
