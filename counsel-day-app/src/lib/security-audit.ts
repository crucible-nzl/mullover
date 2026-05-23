/**
 * Daily security-audit runner.
 *
 * Shells to `npm audit --json` in /opt/counsel-day-app, parses the
 * output, classifies each vulnerability by severity + how safe its
 * fix is to apply, and returns a structured result the cron job
 * can email + persist.
 *
 * Why not just `npm audit fix --force`: npm's auto-fix happily
 * proposes major-version DOWNGRADES (we saw this with next@9.3.3
 * and drizzle-kit@0.18.1 during the hardening batch) which would
 * catastrophically break the project. The classifier here keeps
 * humans in the loop for breaking changes.
 *
 * Snapshot file:
 *   /var/log/counsel-day/security-audit-latest.json  (current state)
 *   /var/log/counsel-day/security-audit-<date>.json   (daily history)
 * Both readable by the deploy user (we already added /var/log/
 * counsel-day to systemd ReadWritePaths).
 */

import { spawn } from 'node:child_process';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const APP_DIR = process.env.APP_DIR ?? '/opt/counsel-day-app';
const SNAPSHOT_DIR = process.env.SECURITY_SNAPSHOT_DIR ?? '/var/log/counsel-day';

export type Severity = 'info' | 'low' | 'moderate' | 'high' | 'critical';

export type AuditFinding = {
  package: string;
  severity: Severity;
  // The advisory's title, e.g. "PostCSS line return parsing error"
  title: string;
  // Comma-joined CVE ids if any (e.g. "CVE-2023-44270")
  cves: string;
  // GitHub Security Advisory URL · the canonical reference
  advisoryUrl: string | null;
  // Vulnerable range as reported by npm audit
  vulnerableRange: string;
  // Current installed version (best-effort · npm audit doesn't always give this)
  currentVersion: string | null;
  // What npm thinks would fix it. null when nothing is auto-fixable
  // (we'd need an override or a major upgrade we can't do).
  fixAvailable:
    | { name: string; version: string; isSemVerMajor: boolean }
    | null;
  // Our classification for whether the fix is safe to auto-apply.
  // 'safe-override' · transitive dep we can pin via package.json overrides
  // 'safe-upgrade'  · direct dep · patch or minor bump within semver
  // 'breaking'      · major version bump · requires human review
  // 'unfixable'     · npm reports no fix available
  classification: 'safe-override' | 'safe-upgrade' | 'breaking' | 'unfixable';
  // Whether this is a direct dependency (top-level in package.json) or a
  // transitive (pulled in by another package). Direct deps are easier
  // to upgrade; transitives need overrides.
  isDirect: boolean;
};

export type AuditSnapshot = {
  generatedAt: string;
  // Aggregate counts from npm's metadata block. Source of truth for
  // dashboard tiles ("3 high, 2 moderate, 0 critical").
  totals: Record<Severity, number>;
  // Total dependency count (production + dev) at audit time.
  totalDependencies: number;
  findings: AuditFinding[];
  // What we propose the operator do · a markdown-style instruction
  // block ready to paste into an email or admin UI.
  proposal: {
    autoApplicableCount: number;
    breakingCount: number;
    // Ready-to-paste JSON overrides for the safe transitive fixes
    proposedOverrides: Record<string, string>;
    // Human-readable instructions
    instructions: string;
  };
  // Raw npm audit JSON · stashed for debugging. Stripped of the
  // verbose metadata.advisories block to keep the file small.
  raw: unknown;
};

type NpmVuln = {
  name: string;
  severity: Severity;
  isDirect: boolean;
  via: Array<string | {
    source?: number;
    name?: string;
    dependency?: string;
    title?: string;
    url?: string;
    severity?: Severity;
    cwe?: string[];
    cvss?: { score: number };
    range?: string;
  }>;
  effects: string[];
  range: string;
  nodes: string[];
  fixAvailable: boolean | {
    name: string;
    version: string;
    isSemVerMajor: boolean;
  };
};

type NpmAuditJson = {
  vulnerabilities?: Record<string, NpmVuln>;
  metadata?: {
    vulnerabilities?: Record<Severity, number>;
    dependencies?: {
      prod?: number;
      dev?: number;
      total?: number;
    };
  };
};

function runNpmAudit(): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = spawn('npm', ['audit', '--json'], {
      cwd: APP_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk) => { stdout += String(chunk); });
    proc.stderr.on('data', (chunk) => { stderr += String(chunk); });
    proc.on('close', (code) => resolve({ stdout, stderr, exitCode: code ?? -1 }));
    proc.on('error', (err) => resolve({ stdout, stderr: stderr + String(err), exitCode: -1 }));
  });
}

function classify(vuln: NpmVuln): AuditFinding['classification'] {
  if (!vuln.fixAvailable) return 'unfixable';
  if (vuln.fixAvailable === true) {
    // npm signalled a fix exists but no shape · usually means "run audit
    // fix" will resolve it without breaking. Treat as safe-upgrade.
    return 'safe-upgrade';
  }
  if (vuln.fixAvailable.isSemVerMajor) return 'breaking';
  // Non-major fix exists. If we're the direct dep, an upgrade applies
  // cleanly; if transitive, we need an override.
  return vuln.isDirect ? 'safe-upgrade' : 'safe-override';
}

function firstAdvisory(via: NpmVuln['via']): { title: string; url: string | null; cves: string[] } {
  for (const v of via) {
    if (typeof v === 'string') continue;
    if (v.title || v.url) {
      return {
        title: v.title ?? 'Unknown advisory',
        url: v.url ?? null,
        // npm audit doesn't surface CVEs cleanly in modern output ·
        // CWE is what's there. Use the URL as the canonical reference.
        cves: [],
      };
    }
  }
  return { title: 'See advisory link', url: null, cves: [] };
}

function buildProposal(findings: AuditFinding[]): AuditSnapshot['proposal'] {
  const overrides: Record<string, string> = {};
  let autoApplicable = 0;
  let breaking = 0;

  for (const f of findings) {
    if (f.classification === 'safe-override' && f.fixAvailable) {
      // Pin the vulnerable package to the fix version using ^minor so
      // future patches still flow through automatically.
      overrides[f.package] = '^' + f.fixAvailable.version;
      autoApplicable++;
    } else if (f.classification === 'safe-upgrade') {
      autoApplicable++;
    } else if (f.classification === 'breaking') {
      breaking++;
    }
  }

  const overrideJson = JSON.stringify(overrides, null, 2);
  const safeUpgrades = findings.filter((f) => f.classification === 'safe-upgrade');
  const breakingItems = findings.filter((f) => f.classification === 'breaking');

  const instructions = [
    autoApplicable > 0
      ? '== Safe to apply (' + autoApplicable + ' fix' + (autoApplicable === 1 ? '' : 'es') + ') =='
      : '== No safe fixes available ==',
    '',
    Object.keys(overrides).length > 0
      ? 'Paste this into package.json "overrides" block (merge with existing entries):\n\n' + overrideJson + '\n\nThen run: cd counsel-day-app && rm -f package-lock.json && npm install && npm audit'
      : '',
    safeUpgrades.length > 0
      ? '\nDirect-dep upgrades (run individually):\n' + safeUpgrades.map((f) => '  npm install ' + f.package + '@' + (f.fixAvailable?.version ?? 'latest')).join('\n')
      : '',
    breaking > 0
      ? '\n\n== REQUIRES REVIEW (' + breaking + ' breaking fix' + (breaking === 1 ? '' : 'es') + ') ==\n'
        + breakingItems.map((f) => '  ' + f.package + ' · ' + f.severity.toUpperCase() + ' · ' + f.title + (f.advisoryUrl ? '\n    ' + f.advisoryUrl : '')).join('\n')
      : '',
  ].filter((s) => s).join('\n');

  return {
    autoApplicableCount: autoApplicable,
    breakingCount: breaking,
    proposedOverrides: overrides,
    instructions,
  };
}

export async function runSecurityAudit(): Promise<AuditSnapshot> {
  const { stdout, stderr, exitCode } = await runNpmAudit();
  // npm audit exits non-zero when vulnerabilities are found · that's
  // not an error condition for us, we still parse the JSON.
  let parsed: NpmAuditJson;
  try {
    parsed = JSON.parse(stdout) as NpmAuditJson;
  } catch (err) {
    throw new Error('npm audit returned unparseable JSON (exit ' + exitCode + '): ' + String(err).slice(0, 200) + ' :: stderr=' + stderr.slice(0, 200));
  }

  const totals: Record<Severity, number> = {
    info: parsed.metadata?.vulnerabilities?.info ?? 0,
    low: parsed.metadata?.vulnerabilities?.low ?? 0,
    moderate: parsed.metadata?.vulnerabilities?.moderate ?? 0,
    high: parsed.metadata?.vulnerabilities?.high ?? 0,
    critical: parsed.metadata?.vulnerabilities?.critical ?? 0,
  };
  const totalDependencies = parsed.metadata?.dependencies?.total ?? 0;

  const findings: AuditFinding[] = [];
  for (const [pkgName, vuln] of Object.entries(parsed.vulnerabilities ?? {})) {
    const adv = firstAdvisory(vuln.via);
    const fix = vuln.fixAvailable === true || vuln.fixAvailable === false
      ? null
      : { name: vuln.fixAvailable.name, version: vuln.fixAvailable.version, isSemVerMajor: vuln.fixAvailable.isSemVerMajor };
    findings.push({
      package: pkgName,
      severity: vuln.severity,
      title: adv.title,
      cves: adv.cves.join(', '),
      advisoryUrl: adv.url,
      vulnerableRange: vuln.range ?? '',
      currentVersion: null,
      fixAvailable: fix,
      classification: classify(vuln),
      isDirect: vuln.isDirect,
    });
  }
  // Sort by severity (critical first) then by package name for stable output.
  const sevRank: Record<Severity, number> = { critical: 0, high: 1, moderate: 2, low: 3, info: 4 };
  findings.sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || a.package.localeCompare(b.package));

  const snapshot: AuditSnapshot = {
    generatedAt: new Date().toISOString(),
    totals,
    totalDependencies,
    findings,
    proposal: buildProposal(findings),
    raw: parsed,
  };

  await persistSnapshot(snapshot);
  return snapshot;
}

async function persistSnapshot(snapshot: AuditSnapshot): Promise<void> {
  try {
    if (!existsSync(SNAPSHOT_DIR)) {
      await mkdir(SNAPSHOT_DIR, { recursive: true });
    }
    const dated = join(SNAPSHOT_DIR, 'security-audit-' + snapshot.generatedAt.slice(0, 10) + '.json');
    const latest = join(SNAPSHOT_DIR, 'security-audit-latest.json');
    const payload = JSON.stringify(snapshot, null, 2);
    await writeFile(dated, payload, 'utf8');
    await writeFile(latest, payload, 'utf8');
  } catch (err) {
    console.warn('[security-audit] failed to persist snapshot:', (err as Error).message);
  }
}

export async function readLatestSnapshot(): Promise<AuditSnapshot | null> {
  try {
    const path = join(SNAPSHOT_DIR, 'security-audit-latest.json');
    if (!existsSync(path)) return null;
    const text = await readFile(path, 'utf8');
    return JSON.parse(text) as AuditSnapshot;
  } catch (err) {
    console.warn('[security-audit] failed to read snapshot:', (err as Error).message);
    return null;
  }
}
