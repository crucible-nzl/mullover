-- 0034 · decommission Counsel Journal
--
-- The Counsel Journal product (the standalone evening-reflection tool,
-- historically "The Daily Counsel" / "/daily") was cut on 2026-08-09 to
-- focus the company entirely on Counsel.day Decision. This migration drops
-- the four Journal-only tables. All Journal application code (API routes,
-- cron jobs, the audio Vault, the admin testing harness) and the Journal
-- static pages were removed in the same change; nothing in the running app
-- references these tables anymore.
--
-- Tables dropped (created by 0026_daily_counsel.sql and 0031_journal_
-- verdict_test_runs.sql):
--   journal_entries          · one row per evening entry (text/audio)
--   journal_verdicts         · weekly + monthly journal verdicts
--   daily_subscriptions      · the $4.99 USD/mo Journal Pro subscription
--   journal_verdict_test_runs· admin journal-testing harness runs
--
-- No other table holds a foreign key INTO these (journal_entries held the
-- only Journal->Decision link, attached_decision_id -> decisions, which is
-- removed with the table), so a plain DROP is clean. CASCADE is used
-- defensively to remove any dependent indexes/constraints.
--
-- IRREVERSIBLE · this destroys any rows in these tables. Pre-launch there
-- is no production Journal data; recovery, if ever needed, is via the
-- nightly pg_dump in /var/backups or a Hetzner snapshot. Any live Stripe
-- "daily_pro" subscription must be cancelled + its Price/Product archived
-- in the Stripe dashboard separately · dropping daily_subscriptions stops
-- the app mirroring those events but does NOT stop Stripe billing.

DROP TABLE IF EXISTS journal_verdict_test_runs CASCADE;
DROP TABLE IF EXISTS journal_verdicts          CASCADE;
DROP TABLE IF EXISTS journal_entries           CASCADE;
DROP TABLE IF EXISTS daily_subscriptions       CASCADE;
