-- 0010 · sessions.mfa_verified_at · timestamp of the last fresh TOTP
-- code accepted during this session. Set during sign-in by
-- /api/signin/mfa-verify and refreshed by /api/me/mfa/step-up.
--
-- Used by destructive admin actions to enforce a 5-minute step-up
-- window: even if the operator's session is hijacked, the attacker
-- can't promote/demote/soft-delete users or deactivate paid products
-- without producing a fresh TOTP code in the last five minutes.
--
-- NULL means: no MFA verified for this session (either user has no
-- MFA enrolled OR they signed in via magic-link without challenge ·
-- both treated identically by the gate).

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS mfa_verified_at TIMESTAMPTZ;
