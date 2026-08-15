-- 0039 · First-party, cookieless pageview counter.
--
-- WHY THIS EXISTS
-- GA4 undercounts severely on this site, by design rather than by fault:
-- Consent Mode v2 defaults analytics_storage to 'denied', so any visitor who
-- does not accept the cookie banner produces only cookieless pings, which GA4
-- cannot turn into a "user" without behavioural-modelling volume we do not
-- have. Ad blockers remove another slice before the tag even loads. The first
-- Facebook post produced 48 short-link clicks and 9 GA4 users.
--
-- This table is the first-party alternative: same-origin (so ad blockers do
-- not touch it) and identifier-free (so it is aggregate statistics rather
-- than tracking, and does not depend on consent).
--
-- WHAT IS DELIBERATELY NOT STORED
--   · no cookies, no localStorage, no advertising identifiers
--   · no raw IP address and no full user-agent string
--   · no user id, even when the visitor is signed in · this table is for
--     traffic volume only and must never become a per-person activity log
--
-- visitor_hash is a NON-REVERSIBLE daily-rotating digest, computed as
-- sha256(server secret + UTC date + ip + coarse user-agent). Because the date
-- is an input, the same person on two different days produces two unrelated
-- values, so it supports "unique visitors today" without enabling any
-- cross-day tracking. This is the Plausible/Fathom model. Rows older than the
-- retention window below should be aggregated and dropped.

CREATE TABLE IF NOT EXISTS page_hits (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    path            TEXT        NOT NULL,
    referrer_host   TEXT,
    country         TEXT,
    device          TEXT,
    visitor_hash    TEXT        NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS page_hits_created_idx ON page_hits (created_at DESC);
CREATE INDEX IF NOT EXISTS page_hits_path_idx    ON page_hits (path);
-- Supports "unique visitors per day" without scanning the whole table.
CREATE INDEX IF NOT EXISTS page_hits_daily_idx   ON page_hits (created_at DESC, visitor_hash);
