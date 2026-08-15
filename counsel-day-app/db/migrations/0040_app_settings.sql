-- 0040 · Generic operator settings, starting with the verdict AI model.
--
-- The original spec (§ Verdict AI in the locked settings) called for the
-- model to be admin-switchable; what shipped was the VERDICT_AI_MODEL env
-- var, which needs a Hetzner console session and a service restart to
-- change. This table lets the admin portal own such values: the app reads
-- the setting at call time, so a change applies to the NEXT verdict run
-- with no restart and no deploy.
--
-- Key/value on purpose: settings are rare, tiny, and read at most a few
-- times per minute. Values are validated on write (admin API) AND on read
-- (resolver checks against the known-model list), so a bad row can never
-- reach an Anthropic API call · it just falls back to the env default.

CREATE TABLE IF NOT EXISTS app_settings (
    key         TEXT PRIMARY KEY,
    value       TEXT        NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by  UUID        REFERENCES users(id) ON DELETE SET NULL
);
