-- 0032 · practitioner_applications · outreach + pipeline tracking
--
-- Strategic batch 2026-06-05 · the existing practitioner_applications
-- table tracks inbound applications with a 4-state status enum
-- (pending/approved/rejected/withdrawn). We need a SEPARATE dimension
-- to track sales-pipeline state for COLD outreach + warm follow-up ·
-- whether the lead came in cold or applied unprompted, and where they
-- sit in the funnel right now.
--
-- New columns:
--   outreach_stage          · the kanban column the lead sits in
--   outreach_notes          · free-form salesperson notes
--   last_contacted_at       · for follow-up cadence
--   source                  · counsellors_page | apply_form | cold_outbound | referral
--   tags                    · jsonb array of free-form tags (geo, specialty, etc.)

ALTER TABLE practitioner_applications
  ADD COLUMN IF NOT EXISTS outreach_stage TEXT NOT NULL DEFAULT 'new'
    CHECK (outreach_stage IN (
      'new',          -- just landed (cold lead or fresh inbound)
      'contacted',    -- first outreach sent
      'replied',      -- they responded
      'meeting_set',  -- demo/call scheduled
      'converted',    -- referral_code issued + they're active
      'declined',     -- they said no
      'dormant'       -- no contact in 60+ days
    )),
  ADD COLUMN IF NOT EXISTS outreach_notes TEXT,
  ADD COLUMN IF NOT EXISTS last_contacted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'apply_form'
    CHECK (source IN ('counsellors_page', 'apply_form', 'cold_outbound', 'referral')),
  ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Pipeline lookups happen by outreach_stage.
CREATE INDEX IF NOT EXISTS practitioner_applications_outreach_stage_idx
  ON practitioner_applications (outreach_stage, last_contacted_at);
