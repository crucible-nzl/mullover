-- 0017 · audit_log append-only enforcement
--
-- Hardening: prevent UPDATE and DELETE on audit_log at the DB level so
-- a compromised app role cannot cover its tracks. The application code
-- never does either operation in any code path (verified by grep on
-- audit_log mentions); this trigger turns that convention into an
-- enforced invariant.
--
-- Two triggers:
--   · audit_log_no_update · raises on UPDATE
--   · audit_log_no_delete · raises on DELETE except by superuser
--
-- We allow superuser DELETE because the existing audit-prune cron job
-- (src/jobs/cron.ts auditPrune) deletes rows older than 24 months
-- (or 7 years for refund / hard-delete categories). That cron runs as
-- the regular app role today; we accommodate it by adding a session
-- variable check · the cron sets app.audit_prune_session=on inside its
-- transaction, which the trigger reads to permit the DELETE.
--
-- Pen-test value: any attacker with INSERT access to audit_log can
-- still WRITE forged rows, but can no longer DELETE or MODIFY existing
-- ones · the audit trail becomes immutable once written, modulo the
-- legitimate prune cron.

BEGIN;

CREATE OR REPLACE FUNCTION audit_log_block_update() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only; UPDATE is not permitted';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION audit_log_block_delete() RETURNS TRIGGER AS $$
BEGIN
  -- Allow DELETE only when the audit-prune cron sets the session flag.
  -- Postgres' current_setting() with the missing_ok=true second arg
  -- returns NULL if the variable was never set in this session, which
  -- evaluates as != 'on' and triggers the EXCEPTION.
  IF current_setting('app.audit_prune_session', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audit_log DELETE is permitted only by the audit-prune cron job';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_no_update ON audit_log;
CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_block_update();

DROP TRIGGER IF EXISTS audit_log_no_delete ON audit_log;
CREATE TRIGGER audit_log_no_delete
  BEFORE DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_block_delete();

COMMIT;
