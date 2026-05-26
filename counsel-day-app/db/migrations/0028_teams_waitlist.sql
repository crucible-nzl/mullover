-- 0028 · Counsel · Teams waitlist
--
-- Validation play before committing to the B2B build. The landing page
-- at /for-teams.html collects email + company + team size + role from
-- HR Ops / People Leaders who want the workplace version of the same
-- sealed-vote mechanic. If 10+ qualified signups land in 30 days,
-- scope the Counsel · Teams MVP. If 3 land, learning was cheap. If 0,
-- kill the vertical.
--
-- Fields kept deliberately tight · don't ask for company size if you
-- won't use it for triage. Anything else can be asked in the follow-up
-- conversation.

CREATE TABLE IF NOT EXISTS teams_waitlist (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT NOT NULL,
  full_name       TEXT,
  company         TEXT,
  role            TEXT,                        -- "Head of People", "VP Engineering", etc · free text
  team_size       TEXT,                        -- bucketed string: '5-25', '25-100', '100-500', '500+'
  country         TEXT,                        -- ISO-3166 alpha-2 (NZ, AU, GB, US, ...) · free text fallback
  source          TEXT,                        -- "linkedin", "newsletter", "friend", "search", ...
  notes           TEXT,                        -- "we tried Lattice for a year and stopped because ..."
  user_agent      TEXT,
  ip_hash         TEXT,
  contacted_at    TIMESTAMPTZ,
  status          TEXT NOT NULL DEFAULT 'pending', -- pending | contacted | qualified | not_a_fit | piloted
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS teams_waitlist_status_idx ON teams_waitlist (status, created_at DESC);
CREATE INDEX IF NOT EXISTS teams_waitlist_email_idx ON teams_waitlist (email);
