/* ============================================================
   Counsel.day · Admin Operations Dashboard · prototype JS
   ----------------------------------------------------------
   Self-contained interactive prototype. State lives in memory;
   resets on reload. All actions update the in-memory data and
   trigger toast feedback + audit log entries.

   In production this file is replaced (or wrapped) with calls
   to the FastAPI admin API; the data shape here mirrors the
   API response shape we expect on the other side.
   ============================================================ */

(function () {
  'use strict';

  // ============================================================
  // Sample data · 30 users with realistic distributions
  // ============================================================
  const compactData = [
    // [id, email, name, country, edition, status, signupAt, lastSignIn, decisions, activeDecisions, votes, notes, lifetimeRevenue, authMethod, mfaEnabled, vip]
    ['user_b7e2', 'j.lloyd@example.com', 'J. Lloyd', 'NZ', 'solo', 'active', '2026-05-11T13:42', '2026-05-12T14:18', 0, 0, 0, 0, 0, 'google', false, false],
    ['user_3a91', 'm.tanaka@example.com', 'M. Tanaka', 'AU', 'couple', 'active', '2026-05-11T11:08', '2026-05-12T11:08', 1, 1, 14, 5, 9.99, 'magic-link', false, false],
    ['user_f4d8', 's.okonkwo@example.com', 'S. Okonkwo', 'UK', 'solo', 'active', '2026-05-10T21:33', '2026-05-12T08:14', 1, 1, 1, 0, 0, 'google', false, false],
    ['user_19c5', 'r.fernandes@example.com', 'R. Fernandes', 'US', 'couple', 'active', '2026-05-10T19:14', '2026-05-12T07:22', 1, 1, 12, 3, 9.99, 'magic-link', false, false],
    ['user_82b0', 'p.morrison@example.com', 'P. Morrison', 'NZ', 'couple-annual', 'active', '2025-08-22T17:52', '2026-05-12T06:33', 4, 1, 78, 32, 99, 'google', true, true],
    ['user_5ec6', 'k.williams@example.com', 'K. Williams', 'AU', 'solo', 'active', '2026-05-10T14:01', '2026-05-11T14:01', 1, 0, 5, 2, 0, 'magic-link', false, false],
    ['user_d3a7', 'l.brennan@example.com', 'L. Brennan', 'CA', 'solo', 'active', '2026-05-10T10:22', '2026-05-11T10:22', 0, 0, 0, 0, 0, 'google', false, false],
    ['user_0e44', 'a.chen@example.com', 'A. Chen', 'NZ', 'couple', 'active', '2026-05-09T22:48', '2026-05-12T09:33', 1, 0, 21, 8, 9.99, 'magic-link', false, false],
    ['user_4c12', 'h.singh@example.com', 'H. Singh', 'IN', 'family-annual', 'active', '2026-02-04T08:30', '2026-05-08T06:30', 3, 2, 78, 32, 149, 'google', false, false],
    ['user_ad9f', 'j.olsen@example.com', 'J. Olsen', 'NO', 'solo-annual', 'active', '2026-05-03T20:14', '2026-05-07T20:14', 3, 0, 22, 9, 49, 'magic-link', false, false],
    ['user_5e1a', 't.nicolas@example.com', 'T. Nicolas', 'FR', 'couple-annual', 'active', '2025-05-18T16:00', '2026-05-07T09:42', 7, 0, 156, 84, 99, 'google', true, false],
    ['user_7b3c', 'e.murphy@example.com', 'E. Murphy', 'IE', 'couple', 'active', '2026-04-28T14:00', '2026-05-07T07:18', 1, 0, 28, 11, 9.99, 'magic-link', false, false],
    ['user_99c8', 'd.hoffmann@example.com', 'D. Hoffmann', 'DE', 'family', 'active', '2026-04-24T09:00', '2026-05-06T19:08', 2, 1, 36, 14, 29.98, 'magic-link', false, false],
    ['user_2f06', 'c.johnson@example.com', 'C. Johnson', 'US', 'solo', 'idle', '2026-04-21T12:00', '2026-05-06T11:33', 0, 0, 0, 0, 0, 'google', false, false],
    ['user_8e51', 'n.silva@example.com', 'N. Silva', 'BR', 'couple-annual', 'active', '2025-09-14T11:30', '2026-05-05T22:11', 5, 1, 112, 47, 99, 'google', false, false],
    ['user_b7a2', 'g.papadopoulos@example.com', 'G. Papadopoulos', 'GR', 'family', 'active', '2026-04-15T08:00', '2026-05-04T18:55', 1, 0, 14, 6, 14.99, 'magic-link', false, false],
    ['user_6cd9', 'r.kim@example.com', 'R. Kim', 'KR', 'solo', 'idle', '2026-04-11T20:00', '2026-05-02T14:22', 0, 0, 0, 0, 0, 'google', false, false],
    ['user_3e7f', 'q.adekoya@example.com', 'Q. Adekoya', 'NG', 'solo', 'idle', '2026-04-08T07:30', '2026-04-28T09:14', 2, 0, 18, 4, 4.99, 'magic-link', false, false],
    ['user_5b1e', 's.fairhall@example.com', 'S. Fairhall', 'NZ', 'couple', 'suspended', '2026-04-02T10:00', '2026-04-22T11:48', 1, 0, 12, 3, 9.99, 'magic-link', false, false],
    ['user_aa84', 'v.romano@example.com', 'V. Romano', 'IT', 'solo', 'deleting', '2026-03-31T15:00', '2026-04-15T17:02', 0, 0, 0, 0, 0, 'magic-link', false, false],
    ['user_c1d9', 'a.dubois@example.com', 'A. Dubois', 'FR', 'solo', 'active', '2026-03-28T10:00', '2026-04-22T18:30', 1, 0, 7, 2, 0, 'google', false, false],
    ['user_3f47', 'l.gomez@example.com', 'L. Gomez', 'MX', 'couple', 'active', '2026-03-22T14:00', '2026-04-20T11:11', 2, 0, 24, 10, 19.98, 'magic-link', false, false],
    ['user_e2b8', 'o.takahashi@example.com', 'O. Takahashi', 'JP', 'solo', 'active', '2026-03-19T07:00', '2026-04-18T19:23', 0, 0, 0, 0, 0, 'google', false, false],
    ['user_15ac', 'p.ferreira@example.com', 'P. Ferreira', 'PT', 'solo-annual', 'idle', '2026-03-14T16:00', '2026-04-15T08:09', 4, 0, 26, 11, 49, 'google', false, false],
    ['user_9b22', 'r.nielsen@example.com', 'R. Nielsen', 'DK', 'family', 'active', '2026-03-08T13:00', '2026-04-25T11:35', 1, 0, 8, 2, 14.99, 'magic-link', false, false],
    ['user_7c4d', 'm.ahmed@example.com', 'M. Ahmed', 'EG', 'solo', 'idle', '2026-03-02T09:00', '2026-04-04T14:18', 0, 0, 0, 0, 0, 'google', false, false],
    ['user_0a76', 'k.kowalski@example.com', 'K. Kowalski', 'PL', 'solo', 'active', '2026-02-22T11:00', '2026-04-30T21:00', 1, 0, 9, 3, 0, 'google', false, false],
    ['user_d51f', 'b.haaland@example.com', 'B. Haaland', 'NO', 'solo', 'active', '2026-02-15T08:00', '2026-04-22T07:14', 2, 0, 18, 7, 4.99, 'magic-link', false, false],
    ['user_eb43', 'n.kapoor@example.com', 'N. Kapoor', 'IN', 'solo', 'idle', '2026-02-08T15:00', '2026-03-28T11:42', 0, 0, 0, 0, 0, 'google', false, false],
    ['user_18bc', 'r.eriksson@example.com', 'R. Eriksson', 'SE', 'solo', 'idle', '2026-02-01T10:00', '2026-04-12T15:00', 1, 0, 5, 1, 0, 'magic-link', false, false],
  ];

  const COUNTRY_CITY = {
    NZ: 'Auckland', AU: 'Sydney', UK: 'London', US: 'New York', CA: 'Toronto',
    IE: 'Dublin', DE: 'Berlin', FR: 'Paris', BR: 'São Paulo', IN: 'Bangalore',
    NO: 'Oslo', GR: 'Athens', KR: 'Seoul', NG: 'Lagos', IT: 'Milan',
    MX: 'Mexico City', JP: 'Tokyo', PT: 'Lisbon', DK: 'Copenhagen', EG: 'Cairo',
    PL: 'Warsaw', SE: 'Stockholm',
  };

  function expand(arr) {
    const [id, email, name, country, edition, status, signupAt, lastSignIn, decisions, activeDecisions, votes, notes, lifetimeRevenue, authMethod, mfaEnabled, vip] = arr;
    const auth0Sub = (authMethod === 'google' ? 'google-oauth2|' : 'email|') + id.replace('user_', '') + '8X2bN3kP4mZ';
    return {
      id, email, displayName: name, country, edition, status, signupAt, lastSignIn,
      decisions, activeDecisions, votes, notes, lifetimeRevenue, authMethod,
      auth0Sub, mfaEnabled, vip,
      device: authMethod === 'google' ? 'Chrome 128 / macOS' : 'Safari 17 / iOS 17',
      city: COUNTRY_CITY[country] || country,
      ip: '203.0.113.' + (id.charCodeAt(5) % 200 + 30),
      notificationTime: '19:00',
      notificationChannel: 'email',
      locale: 'en-' + country,
      stripeCustomer: 'cus_' + id.replace('user_', '').toUpperCase() + '9aN2',
      cardOnFile: lifetimeRevenue > 0,
      internalNotes: [],
    };
  }

  // ============================================================
  // State
  // ============================================================
  const state = {
    users: compactData.map(expand),
    selectedIds: new Set(),
    openUserId: 'user_b7e2',
    filter: 'all',
    search: '',
    sortBy: 'lastSignIn',
    sortDir: 'desc',
    page: 1,
    perPage: 10,
    activeTab: 'account',
    operator: 'James (admin)',
  };

  // ============================================================
  // Utilities
  // ============================================================
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const NOW = new Date('2026-05-12T14:32:00');

  function timeAgo(timestamp) {
    const t = new Date(timestamp);
    const diff = (NOW - t) / 1000;
    if (diff < 0) return 'in the future';
    if (diff < 60) return Math.floor(diff) + 's ago';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    if (diff < 86400 * 7) return Math.floor(diff / 86400) + 'd ago';
    return t.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' });
  }

  function fmtDate(timestamp) {
    return new Date(timestamp).toLocaleDateString('en-NZ', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function fmtShortDate(timestamp) {
    return new Date(timestamp).toLocaleDateString('en-NZ', { day: '2-digit', month: 'short' });
  }

  function fmtDateTime(timestamp) {
    return new Date(timestamp).toLocaleString('en-NZ', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  }

  function editionPill(edition) {
    const map = {
      'solo':          { cls: 'grey',  label: 'Solo' },
      'solo-annual':   { cls: 'green', label: 'Solo Annual' },
      'couple':        { cls: 'clay',  label: 'Couple' },
      'couple-annual': { cls: 'rose',  label: 'Couple Annual' },
      'family':        { cls: 'clay',  label: 'Family' },
      'family-annual': { cls: 'rose',  label: 'Family Annual' },
    };
    const p = map[edition] || map.solo;
    return `<span class="pill ${p.cls}">${p.label}</span>`;
  }

  function statusPill(status) {
    const map = {
      active: { cls: 'green', label: 'Active' },
      idle: { cls: 'clay', label: 'Idle' },
      suspended: { cls: 'rose', label: 'Suspended' },
      deleting: { cls: 'grey', label: 'Deleting' },
    };
    const p = map[status] || map.active;
    return `<span class="pill ${p.cls}">${p.label}</span>`;
  }

  function editionLabel(e) {
    return ({
      'solo':          'Solo · 1st decision free, then $4.99 USD each',
      'solo-annual':   'Solo Annual · $49 USD/year (up to 100 Solo decisions)',
      'couple':        'Couple · $9.99 USD per decision (two participants)',
      'couple-annual': 'Couple Annual · $99 USD/year (up to 100 Couple decisions)',
      'family':        'Family · $14.99 USD per decision (3-6 participants)',
      'family-annual': 'Family Annual · $149 USD/year (up to 100 Family decisions)',
    })[e] || 'Solo';
  }

  function isAnnual(edition) {
    return edition === 'solo-annual' || edition === 'couple-annual' || edition === 'family-annual';
  }
  function isSoloFamily(edition, audience) {
    if (audience === 'solo')   return edition === 'solo'   || edition === 'solo-annual';
    if (audience === 'couple') return edition === 'couple' || edition === 'couple-annual';
    if (audience === 'family') return edition === 'family' || edition === 'family-annual';
    return false;
  }
  function planAnnualPrice(edition) {
    return ({ 'solo-annual': 49, 'couple-annual': 99, 'family-annual': 149 })[edition] || 0;
  }
  function planPerDecisionPrice(edition) {
    return ({ 'solo': 4.99, 'couple': 9.99, 'family': 14.99 })[edition] || 0;
  }

  // ============================================================
  // Filter / sort / paginate
  // ============================================================
  function visibleUsers() {
    let r = state.users.slice();
    if      (state.filter === 'solo')      r = r.filter(u => isSoloFamily(u.edition, 'solo'));
    else if (state.filter === 'couple')    r = r.filter(u => isSoloFamily(u.edition, 'couple'));
    else if (state.filter === 'family')    r = r.filter(u => isSoloFamily(u.edition, 'family'));
    else if (state.filter === 'annual')    r = r.filter(u => isAnnual(u.edition));
    else if (state.filter === 'suspended') r = r.filter(u => u.status === 'suspended');
    else if (state.filter === 'deleting')  r = r.filter(u => u.status === 'deleting');
    if (state.search) {
      const s = state.search.toLowerCase();
      r = r.filter(u => u.email.toLowerCase().includes(s) || u.id.toLowerCase().includes(s) || (u.displayName || '').toLowerCase().includes(s));
    }
    r.sort((a, b) => {
      let va = a[state.sortBy], vb = b[state.sortBy];
      if (state.sortBy === 'lastSignIn' || state.sortBy === 'signupAt') {
        va = new Date(va).getTime(); vb = new Date(vb).getTime();
      }
      if (typeof va === 'string') { va = va.toLowerCase(); vb = vb.toLowerCase(); }
      if (va < vb) return state.sortDir === 'asc' ? -1 : 1;
      if (va > vb) return state.sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return r;
  }

  function paged() {
    const filtered = visibleUsers();
    const totalPages = Math.max(1, Math.ceil(filtered.length / state.perPage));
    if (state.page > totalPages) state.page = totalPages;
    const start = (state.page - 1) * state.perPage;
    return { filtered, page: filtered.slice(start, start + state.perPage), totalPages };
  }

  // ============================================================
  // Audit log generation (cached per user)
  // ============================================================
  function buildAuditLog(u) {
    if (u._auditLog) return u._auditLog;
    const events = [];

    events.push({ ts: u.signupAt + ':00', category: 'account', summary: 'Account created via ' + (u.authMethod === 'google' ? 'Google OAuth' : 'magic-link email'), meta: 'Auth0 sub: ' + u.auth0Sub, source: 'Auth0' });

    const signupMs = new Date(u.signupAt).getTime();
    const lastMs = new Date(u.lastSignIn).getTime();
    const span = lastMs - signupMs;
    const signinCount = Math.min(6, Math.max(1, Math.floor(span / (86400 * 1000) / 5)));
    for (let i = 1; i <= signinCount; i++) {
      const t = new Date(signupMs + (span * i / (signinCount + 1)));
      events.push({
        ts: t.toISOString().slice(0, 16),
        category: 'auth',
        summary: 'Signed in via ' + (u.authMethod === 'google' ? 'Google' : 'magic-link'),
        meta: u.device + ' · ' + u.city + ', ' + u.country,
        source: 'Auth0',
      });
    }

    events.push({ ts: u.lastSignIn, category: 'auth', summary: 'Signed in via ' + (u.authMethod === 'google' ? 'Google' : 'magic-link'), meta: u.device + ' · ' + u.city + ', ' + u.country, source: 'Auth0' });

    if (u.mfaEnabled) {
      events.push({ ts: new Date(signupMs + 86400 * 2 * 1000).toISOString().slice(0, 16), category: 'auth', summary: 'MFA enrolled (WebAuthn hardware key)', meta: 'Self-service via Auth0 dashboard', source: 'Auth0' });
    }

    if ((u.edition === 'couple' || u.edition === 'family' || u.edition === 'solo') && u.lifetimeRevenue > 0) {
      const t = new Date(signupMs + 86400 * 5 * 1000);
      const perDecisionPrice = planPerDecisionPrice(u.edition);
      const planLabel = u.edition === 'family' ? 'Family' : (u.edition === 'couple' ? 'Couple' : 'Solo');
      events.push({ ts: t.toISOString().slice(0, 16), category: 'subscription', summary: 'First paid ' + planLabel + ' decision composed · charged upfront', meta: '$' + perDecisionPrice.toFixed(2) + ' USD captured on Stripe ' + u.stripeCustomer, source: 'Stripe' });
    }

    if (isAnnual(u.edition)) {
      const t = new Date(signupMs + 86400 * 14 * 1000);
      const annualPrice = planAnnualPrice(u.edition);
      const planLabel = ({ 'solo-annual': 'Solo Annual', 'couple-annual': 'Couple Annual', 'family-annual': 'Family Annual' })[u.edition];
      events.push({ ts: t.toISOString().slice(0, 16), category: 'subscription', summary: 'Subscribed to ' + planLabel, meta: 'Stripe charge $' + annualPrice.toFixed(2) + ' USD · subscription id sub_3PqK' + u.id.slice(-4) + 'aN1tE3 · renews annually', source: 'Stripe' });
    }

    for (let i = 0; i < Math.min(u.decisions, 4); i++) {
      const t = new Date(signupMs + 86400 * (10 * (i + 1)) * 1000);
      if (t < NOW) {
        const num = String(140 + i * 13 + (u.id.charCodeAt(5) % 30)).padStart(4, '0');
        events.push({ ts: t.toISOString().slice(0, 16), category: 'decision', summary: 'Decision №' + num + ' opened (Strong/Lean · 30 days)', meta: u.activeDecisions > i ? 'Active' : 'Verdict revealed', source: 'App' });
      }
    }

    if (u.vip) {
      events.push({ ts: '2026-05-10T11:24', category: 'admin', summary: 'Marked as VIP by operator', meta: 'Operator: James · Reason: long-term Couple Annual subscriber, qualitative feedback', source: 'Admin portal' });
    }

    if (u.status === 'suspended') {
      events.push({ ts: '2026-04-28T16:14', category: 'admin', summary: 'Account suspended by operator', meta: 'Operator: James · Reason: TOS report under investigation', source: 'Admin portal' });
    }

    if (u.status === 'deleting') {
      events.push({ ts: '2026-04-15T17:30', category: 'admin', summary: 'Account deletion initiated by user', meta: '24h SLA · cascade through Auth0 + Postgres scheduled', source: 'App · self-service' });
    }

    events.sort((a, b) => new Date(b.ts) - new Date(a.ts));
    u._auditLog = events;
    return events;
  }

  function logEvent(u, evt) {
    u._auditLog = null;
    const log = buildAuditLog(u);
    log.unshift(Object.assign({ ts: new Date().toISOString().slice(0, 16), source: 'Admin portal' }, evt));
    u._auditLog = log;
  }

  // ============================================================
  // Toast + modal
  // ============================================================
  function toast(msg, kind) {
    kind = kind || 'info';
    const c = $('#toast-container');
    if (!c) return;
    const el = document.createElement('div');
    el.className = 'toast toast-' + kind;
    el.textContent = msg;
    c.appendChild(el);
    setTimeout(() => el.classList.add('toast-out'), 3000);
    setTimeout(() => el.remove(), 3500);
  }

  function modal({ title, body, primaryLabel, primary, secondary }) {
    primaryLabel = primaryLabel || 'Confirm';
    secondary = secondary || 'Cancel';
    const overlay = $('#modal-overlay');
    const content = $('#modal-content');
    content.innerHTML =
      '<div class="modal-header"><h3>' + esc(title) + '</h3><a class="modal-close" data-close>✕</a></div>' +
      '<div class="modal-body">' + body + '</div>' +
      '<div class="modal-footer"><a class="modal-btn" data-close>' + esc(secondary) + '</a><a class="modal-btn primary" id="modal-primary">' + esc(primaryLabel) + '</a></div>';
    overlay.hidden = false;
    const close = () => { overlay.hidden = true; content.innerHTML = ''; };
    content.querySelectorAll('[data-close]').forEach(b => b.onclick = close);
    overlay.onclick = (e) => { if (e.target === overlay) close(); };
    $('#modal-primary').onclick = () => { if (primary) primary({ content, close }); };
  }

  // ============================================================
  // Verdict AI · state
  // ============================================================
  const verdictAI = {
    models: [
      { id: 'claude-opus-4-7',     label: 'Opus 4.7 (1M context)', purpose: 'Verdict synthesis · highest fidelity for nuanced couple-vote analysis', latencyP50: '8.4s', costPer1k: '$15 in / $75 out' },
      { id: 'claude-sonnet-4-6',   label: 'Sonnet 4.6',            purpose: 'Verdict synthesis · default for launch (cost-optimised, validated quality)', latencyP50: '3.1s', costPer1k: '$3 in / $15 out' },
      { id: 'claude-haiku-4-5',    label: 'Haiku 4.5',             purpose: 'Drafting + light summaries · fastest, lowest cost',                       latencyP50: '0.9s', costPer1k: '$0.80 in / $4 out' },
    ],
    selectedModel: 'claude-sonnet-4-6',
    temperature: 0.4,
    topP: 0.95,
    maxTokens: 4096,
    systemPrompt:
      'You are the Verdict synthesiser for Counsel.day, a private decision tool used by couples (two linked users) facing a meaningful joint question. You receive:\n' +
      '\n' +
      '  · the decision question itself, framed by one partner;\n' +
      '  · the duration (typically 30 days);\n' +
      '  · for each partner, their independent daily votes on a {Strongly for, Lean for, Lean against, Strongly against} scale, with timestamps;\n' +
      '  · optional sealed notes each partner wrote during the period (never shown to the other partner).\n' +
      '\n' +
      'Your job is to deliver a single verdict document that:\n' +
      '  1. Names the position each partner actually arrived at, in their own intensity, not flattened.\n' +
      '  2. Describes the *shape* of how each position moved across the period (early conviction, drift, late reversal, settled stance).\n' +
      '  3. Surfaces where the partners agree, where they diverge, and the magnitude of divergence.\n' +
      '  4. Names a recommendation when both positions point the same way, or describes the live disagreement plainly when they do not.\n' +
      '  5. Offers two or three concrete next steps the couple can take together, in plain language, no jargon.\n' +
      '\n' +
      'Constraints:\n' +
      '  · Never invent reasoning a partner did not write. If a note is empty, do not speculate about it.\n' +
      '  · Never side with one partner against the other. The verdict is a mirror, not a tiebreaker.\n' +
      '  · Use the two partners\' first names exactly as supplied. No surnames, no titles.\n' +
      '  · Write in clean editorial prose, no bullet points unless instructed, no headings unless instructed.\n' +
      '  · Keep total length to 600-900 words.',
    secret: {
      bound: false,
      source: 'Infisical · self-hosted',
      project: 'counsel-day-prod',
      environment: 'production',
      path: '/anthropic/api_key',
      lastRotated: null,
      nextRotation: null,
      rotationCadence: 'every 60 days',
      reference: 'inf://counsel-day-prod/production/anthropic/api_key',
    },
    log: [
      { ts: '2026-05-12T13:18', decisionId: '0156', partners: 'James + Alexandra',       model: 'claude-sonnet-4-6', tokensIn: 4820, tokensOut: 1142, costUsd: 0.032, latencyMs: 3210, status: 'ok' },
      { ts: '2026-05-11T19:02', decisionId: '0155', partners: 'M. Tanaka + K. Tanaka',   model: 'claude-sonnet-4-6', tokensIn: 3994, tokensOut: 988,  costUsd: 0.027, latencyMs: 2820, status: 'ok' },
      { ts: '2026-05-10T08:44', decisionId: '0154', partners: 'P. Morrison + R. Morrison', model: 'claude-opus-4-7',   tokensIn: 5612, tokensOut: 1418, costUsd: 0.193, latencyMs: 9140, status: 'ok · operator escalated to Opus' },
      { ts: '2026-05-09T22:11', decisionId: '0153', partners: 'N. Silva + L. Silva',     model: 'claude-sonnet-4-6', tokensIn: 4310, tokensOut: 1056, costUsd: 0.029, latencyMs: 3010, status: 'ok' },
      { ts: '2026-05-08T17:33', decisionId: '0152', partners: 'A. Chen + S. Chen',       model: 'claude-sonnet-4-6', tokensIn: 4112, tokensOut: 1020, costUsd: 0.028, latencyMs: 2890, status: 'ok' },
      { ts: '2026-05-07T11:09', decisionId: '0151', partners: 'H. Singh + R. Singh',     model: 'claude-sonnet-4-6', tokensIn: 4988, tokensOut: 1244, costUsd: 0.033, latencyMs: 3110, status: 'ok' },
    ],
  };

  // ============================================================
  // Chart.js charts
  // ============================================================
  const charts = {};
  function initCharts() {
    if (typeof Chart === 'undefined') return;
    Chart.defaults.font.family = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    Chart.defaults.font.size = 11.5;
    Chart.defaults.color = '#64748b';
    Chart.defaults.borderColor = '#e2e8f0';

    const days = Array.from({ length: 30 }, (_, i) => {
      const d = new Date('2026-04-12T00:00:00');
      d.setDate(d.getDate() + i);
      return d.toLocaleDateString('en-NZ', { day: '2-digit', month: 'short' });
    });

    const freeSeries  = [3, 2, 1, 4, 2, 5, 3, 6, 4, 7, 5, 6, 8, 5, 7, 6, 8, 7, 5, 8, 6, 7, 9, 6, 8, 7, 9, 8, 6, 9];
    const paidSeries  = [0, 0, 1, 0, 1, 1, 0, 1, 1, 2, 1, 2, 1, 2, 3, 2, 3, 2, 3, 4, 3, 4, 3, 4, 5, 4, 5, 4, 5, 6];

    const signupsCanvas = document.getElementById('chart-signups');
    if (signupsCanvas) {
      if (charts.signups) charts.signups.destroy();
      charts.signups = new Chart(signupsCanvas, {
        type: 'line',
        data: {
          labels: days,
          datasets: [
            { label: 'Free signups', data: freeSeries, borderColor: '#2563eb', backgroundColor: 'rgba(37, 99, 235, 0.08)', tension: 0.35, fill: true, pointRadius: 2, pointHoverRadius: 5, borderWidth: 2 },
            { label: 'Paid (II + III)', data: paidSeries, borderColor: '#10b981', backgroundColor: 'rgba(16, 185, 129, 0.08)', tension: 0.35, fill: true, pointRadius: 2, pointHoverRadius: 5, borderWidth: 2 },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { position: 'top', align: 'end', labels: { boxWidth: 10, boxHeight: 10, padding: 14, usePointStyle: true } },
            tooltip: { backgroundColor: '#0f172a', titleColor: '#f8fafc', bodyColor: '#cbd5e1', padding: 10, cornerRadius: 6, displayColors: true },
          },
          scales: {
            x: { grid: { display: false }, ticks: { maxTicksLimit: 8, autoSkip: true } },
            y: { beginAtZero: true, grid: { color: '#f1f5f9', drawBorder: false }, ticks: { precision: 0 } },
          },
        },
      });
    }

    const revenueDaily = [0, 0, 9.99, 0, 9.99, 9.99, 0, 9.99, 9.99, 19.98, 9.99, 19.98, 9.99, 19.98, 0, 19.98, 99, 19.98, 29.97, 39.96, 29.97, 39.96, 29.97, 39.96, 49.95, 99, 49.95, 39.96, 49.95, 59.94];

    const revenueCanvas = document.getElementById('chart-revenue');
    if (revenueCanvas) {
      if (charts.revenue) charts.revenue.destroy();
      charts.revenue = new Chart(revenueCanvas, {
        type: 'bar',
        data: {
          labels: days,
          datasets: [
            { label: 'Daily revenue (USD)', data: revenueDaily, backgroundColor: '#2563eb', borderRadius: 3, hoverBackgroundColor: '#1d4ed8', barThickness: 'flex', maxBarThickness: 14 },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: '#0f172a', titleColor: '#f8fafc', bodyColor: '#cbd5e1', padding: 10, cornerRadius: 6,
              callbacks: { label: (ctx) => '$' + ctx.parsed.y.toFixed(2) + ' USD' },
            },
          },
          scales: {
            x: { grid: { display: false }, ticks: { maxTicksLimit: 8, autoSkip: true } },
            y: { beginAtZero: true, grid: { color: '#f1f5f9', drawBorder: false }, ticks: { callback: (v) => '$' + v } },
          },
        },
      });
    }
  }

  // ============================================================
  // Verdict AI · render + handlers
  // ============================================================
  function renderVerdictAI() {
    const mount = $('#verdict-ai-mount');
    if (!mount) return;
    const ai = verdictAI;
    const model = ai.models.find(m => m.id === ai.selectedModel) || ai.models[0];

    mount.innerHTML =
      '<div class="ai-config">' +
        '<div class="ai-side">' +
          '<div class="ai-panel">' +
            '<h4>Model<span class="helper">' + ai.models.length + ' available</span></h4>' +
            '<div class="ai-models">' +
              ai.models.map(m =>
                '<label class="ai-model-opt' + (m.id === ai.selectedModel ? ' checked' : '') + '">' +
                  '<input type="radio" name="ai-model" value="' + m.id + '" data-ai="model"' + (m.id === ai.selectedModel ? ' checked' : '') + '>' +
                  '<div><strong>' + esc(m.label) + '</strong>' +
                    '<div class="id">' + esc(m.id) + '</div>' +
                    '<div class="meta">' + esc(m.purpose) + '</div>' +
                    '<div class="meta">Latency p50 ' + esc(m.latencyP50) + ' · ' + esc(m.costPer1k) + ' per 1K tokens</div>' +
                  '</div>' +
                '</label>'
              ).join('') +
            '</div>' +
          '</div>' +
          '<div class="ai-panel">' +
            '<h4>Sampling parameters<span class="helper">Tune for verdict tone</span></h4>' +
            '<div class="ai-field">' +
              '<label>Temperature <span class="hint">0 = deterministic · 1 = exploratory</span></label>' +
              '<input type="number" min="0" max="1" step="0.05" value="' + ai.temperature + '" data-ai="temperature">' +
            '</div>' +
            '<div class="ai-field">' +
              '<label>Top-p <span class="hint">Nucleus sampling cutoff</span></label>' +
              '<input type="number" min="0" max="1" step="0.01" value="' + ai.topP + '" data-ai="topP">' +
            '</div>' +
            '<div class="ai-field">' +
              '<label>Max output tokens <span class="hint">Verdicts cap at 900 words ≈ 1300 tokens</span></label>' +
              '<input type="number" min="256" max="8192" step="64" value="' + ai.maxTokens + '" data-ai="maxTokens">' +
            '</div>' +
          '</div>' +
          '<div class="ai-panel">' +
            '<h4>API key · Infisical<span class="helper">' + esc(ai.secret.rotationCadence) + '</span></h4>' +
            '<div class="ai-key-row">' +
              '<input type="text" value="' + (ai.secret.bound ? 'sk-ant-api03-' + '•'.repeat(48) : 'placeholder · not yet bound to Infisical') + '" readonly>' +
              '<span class="key-status' + (ai.secret.bound ? ' bound' : '') + '">' + (ai.secret.bound ? 'Bound' : 'Placeholder') + '</span>' +
            '</div>' +
            '<div class="ai-secret-info">' +
              '<span class="k">Source</span><span class="v">' + esc(ai.secret.source) + '</span>' +
              '<span class="k">Project · env</span><span class="v">' + esc(ai.secret.project) + ' · ' + esc(ai.secret.environment) + '</span>' +
              '<span class="k">Path</span><span class="v mono">' + esc(ai.secret.path) + '</span>' +
              '<span class="k">Reference</span><span class="v mono">' + esc(ai.secret.reference) + '</span>' +
              '<span class="k">Last rotated</span><span class="v">' + (ai.secret.lastRotated ? fmtDateTime(ai.secret.lastRotated) : 'Never · rotate on first bind') + '</span>' +
              '<span class="k">Next rotation</span><span class="v">' + (ai.secret.nextRotation ? fmtDate(ai.secret.nextRotation) : 'Pending first bind') + '</span>' +
            '</div>' +
            '<div class="ai-btn-row">' +
              '<a class="ai-btn primary" data-ai-act="bind-key">' + (ai.secret.bound ? 'Re-bind from Infisical' : 'Bind API key from Infisical') + '</a>' +
              '<a class="ai-btn" data-ai-act="rotate-key"' + (ai.secret.bound ? '' : ' style="opacity:0.5;pointer-events:none;"') + '>Rotate now</a>' +
              '<a class="ai-btn" data-ai-act="open-infisical">Open Infisical dashboard</a>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="ai-main">' +
          '<div class="ai-panel">' +
            '<h4>Verdict system prompt<span class="helper">Editable · versioned · saved to Postgres</span></h4>' +
            '<div class="ai-field">' +
              '<label>System prompt <span class="hint">Sent on every verdict request as the system role</span></label>' +
              '<textarea data-ai="systemPrompt">' + esc(ai.systemPrompt) + '</textarea>' +
              '<div class="ai-prompt-meta">' +
                '<span><strong id="ai-prompt-chars">' + ai.systemPrompt.length + '</strong> chars</span>' +
                '<span><strong id="ai-prompt-tokens">~' + Math.ceil(ai.systemPrompt.length / 4) + '</strong> tokens (estimated, cached)</span>' +
                '<span>Cached on Anthropic side per 5-min window</span>' +
              '</div>' +
            '</div>' +
            '<div class="ai-btn-row">' +
              '<a class="ai-btn primary" data-ai-act="save-prompt">Save prompt</a>' +
              '<a class="ai-btn" data-ai-act="test-verdict">Test verdict on sample data</a>' +
              '<a class="ai-btn" data-ai-act="restore-default">Restore default</a>' +
              '<a class="ai-btn" data-ai-act="export-config">Export config (JSON)</a>' +
            '</div>' +
            '<div style="margin-top: 12px; padding: 10px 12px; background: var(--cms-warning-soft); color: var(--cms-warning-text); border-radius: 6px; font-size: 12px; line-height: 1.5;">' +
              '<strong>Prompt changes apply to the next verdict generation only.</strong> Verdicts already generated are not regenerated; the prompt that produced a verdict is captured in its decision record for audit.' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    renderVerdictLog();
  }

  function renderVerdictLog() {
    const mount = $('#verdict-log-mount');
    if (!mount) return;
    const head =
      '<div class="ai-log-row head">' +
        '<span>Generated</span>' +
        '<span>Decision · partners</span>' +
        '<span>Model</span>' +
        '<span class="num">Tokens in</span>' +
        '<span class="num">Tokens out</span>' +
        '<span class="num">Cost</span>' +
      '</div>';
    const rows = verdictAI.log.map(r =>
      '<div class="ai-log-row">' +
        '<span class="ts">' + fmtDateTime(r.ts) + '</span>' +
        '<span class="id"><strong>№' + esc(r.decisionId) + '</strong> · ' + esc(r.partners) + '</span>' +
        '<span class="id">' + esc(r.model) + '</span>' +
        '<span class="num">' + r.tokensIn.toLocaleString() + '</span>' +
        '<span class="num">' + r.tokensOut.toLocaleString() + '</span>' +
        '<span class="num">$' + r.costUsd.toFixed(3) + '</span>' +
      '</div>'
    ).join('');
    mount.innerHTML = head + rows;
  }

  // Verdict AI · input + click handlers
  document.addEventListener('input', (e) => {
    const key = e.target.dataset && e.target.dataset.ai;
    if (!key) return;
    const v = e.target.value;
    if (key === 'temperature' || key === 'topP') verdictAI[key] = parseFloat(v);
    else if (key === 'maxTokens') verdictAI[key] = parseInt(v, 10);
    else if (key === 'model') {
      verdictAI.selectedModel = v;
      renderVerdictAI();
    } else if (key === 'systemPrompt') {
      verdictAI.systemPrompt = v;
      const chars = $('#ai-prompt-chars'); if (chars) chars.textContent = v.length;
      const toks = $('#ai-prompt-tokens'); if (toks) toks.textContent = '~' + Math.ceil(v.length / 4);
    }
  });

  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-ai-act]');
    if (!t) return;
    const act = t.dataset.aiAct;
    if (act === 'bind-key') {
      modal({
        title: 'Bind Claude API key from Infisical',
        body:
          '<p>This will fetch the live API key from Infisical at <span class="mono" style="font-family: var(--font-mono); font-size: 12px; color: var(--cms-muted);">' + esc(verdictAI.secret.reference) + '</span> and bind it to the runtime config of the FastAPI service.</p>' +
          '<p style="color: var(--cms-muted); font-size: 13px;">The key itself never appears in this UI or in Postgres. The FastAPI service reads it from Infisical at boot, holds it in process memory only, and re-fetches on rotation events via the Infisical webhook.</p>' +
          '<p style="color: var(--cms-muted); font-size: 13px;">In this prototype, binding sets a placeholder bound state without contacting Infisical.</p>',
        primaryLabel: 'Bind from Infisical',
        primary: ({ close }) => {
          const now = new Date().toISOString().slice(0, 16);
          const next = new Date(); next.setDate(next.getDate() + 60);
          verdictAI.secret.bound = true;
          verdictAI.secret.lastRotated = now;
          verdictAI.secret.nextRotation = next.toISOString().slice(0, 10);
          close();
          toast('API key bound from Infisical · next rotation ' + fmtDate(next.toISOString()), 'success');
          renderVerdictAI();
        },
      });
    } else if (act === 'rotate-key') {
      modal({
        title: 'Rotate Claude API key now',
        body:
          '<p>Generate a new key in the Anthropic console, store it at <span class="mono" style="font-family: var(--font-mono); font-size: 12px; color: var(--cms-muted);">' + esc(verdictAI.secret.reference) + '</span> in Infisical, then push the rotation event to FastAPI.</p>' +
          '<p style="color: var(--cms-muted); font-size: 13px;">The old key is kept active for a 24-hour overlap window so in-flight verdict requests do not fail. After 24 hours the old key is revoked via the Anthropic Admin API.</p>',
        primaryLabel: 'Rotate now',
        primary: ({ close }) => {
          const now = new Date().toISOString().slice(0, 16);
          const next = new Date(); next.setDate(next.getDate() + 60);
          verdictAI.secret.lastRotated = now;
          verdictAI.secret.nextRotation = next.toISOString().slice(0, 10);
          close();
          toast('Key rotation queued · old key revokes in 24h', 'success');
          renderVerdictAI();
        },
      });
    } else if (act === 'open-infisical') {
      toast('Would open https://app.infisical.com/dashboard/' + verdictAI.secret.project + '/' + verdictAI.secret.environment + verdictAI.secret.path, 'info');
    } else if (act === 'save-prompt') {
      toast('Prompt saved · version v' + (verdictAI.log.length + 1) + ' · applies to next verdict', 'success');
    } else if (act === 'test-verdict') {
      modal({
        title: 'Test verdict on sample data',
        body:
          '<p>Run the configured model + prompt against a fixed sample decision (James + Alexandra · "Should we move into the city?" · 30 days · 60 votes · 4 notes).</p>' +
          '<p style="color: var(--cms-muted); font-size: 13px;">Estimated cost at <strong>' + esc((verdictAI.models.find(m => m.id === verdictAI.selectedModel) || verdictAI.models[0]).label) + '</strong>: ~$0.15 USD per run. Result is shown here only, not stored against any real decision.</p>' +
          (verdictAI.secret.bound ? '' : '<p style="color: var(--cms-warning-text); background: var(--cms-warning-soft); padding: 8px 12px; border-radius: 6px; font-size: 12.5px;"><strong>Note:</strong> API key is not yet bound from Infisical. Test will run against the placeholder and return a mock verdict.</p>'),
        primaryLabel: 'Run test verdict',
        primary: ({ close }) => {
          close();
          toast('Test verdict queued · result will appear in the log when ready', 'info');
        },
      });
    } else if (act === 'restore-default') {
      toast('Use the source-controlled default from /prompts/verdict_v1.md (not implemented in prototype)', 'info');
    } else if (act === 'export-config') {
      const cfg = {
        model: verdictAI.selectedModel,
        temperature: verdictAI.temperature,
        top_p: verdictAI.topP,
        max_tokens: verdictAI.maxTokens,
        system_prompt: verdictAI.systemPrompt,
        secret_reference: verdictAI.secret.reference,
        exported_at: new Date().toISOString(),
      };
      const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'verdict-ai-config-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('Config exported as JSON', 'success');
    }
  });

  // ============================================================
  // Marketing tags · state
  // ============================================================
  const marketingTags = {
    gtm:       { id: '',                                    enabled: false, scope: 'all', consentRequired: true },
    ga4:       { id: '',                                    enabled: false, scope: 'all', consentRequired: true },
    posthog:   { id: '', host: 'https://app.posthog.com',   enabled: false, scope: 'all', consentRequired: true },
    metaPixel: { id: '',                                    enabled: false, scope: 'all', consentRequired: true },
    consent: {
      bannerCopy: 'Counsel.day uses cookies to understand how you arrived and what helped you decide to sign up. Your votes, notes, and decisions inside the product are always private and never shared with these tools.',
      primaryLabel: 'Accept all',
      rejectLabel: 'Essentials only',
      privacyLink: '/privacy',
    },
  };

  function tagStatus(t) {
    if (!t.enabled) return { cls: 'disabled', label: 'Disabled' };
    if (!t.id) return { cls: '', label: 'Not set' };
    return { cls: 'configured', label: 'Configured' };
  }

  function renderMarketingTags() {
    const mount = $('#marketing-tags-mount');
    if (!mount) return;

    const tags = [
      { key: 'gtm',       name: 'Google Tag Manager',   vendor: 'Google',   placeholder: 'GTM-XXXXXXX',     hint: 'Container ID (GTM-XXXXXXX). Loads first and dispatches the others.' },
      { key: 'ga4',       name: 'Google Analytics 4',   vendor: 'Google',   placeholder: 'G-XXXXXXXXXX',    hint: 'Measurement ID (G-XXXXXXXXXX).' },
      { key: 'posthog',   name: 'PostHog',              vendor: 'PostHog',  placeholder: 'phc_XXXXXXXXXXX', hint: 'Project API key (phc_…) + host URL.' },
      { key: 'metaPixel', name: 'Meta Pixel',           vendor: 'Meta',     placeholder: '987654321098765', hint: 'Pixel ID (15-16 digit number).' },
    ];

    const cards = tags.map(t => {
      const cfg = marketingTags[t.key];
      const st = tagStatus(cfg);
      const isPosthog = t.key === 'posthog';
      return (
        '<div class="tag-card" data-tag="' + t.key + '">' +
          '<div class="tag-card-head">' +
            '<div class="name">' + esc(t.name) + '<span class="vendor">' + esc(t.vendor) + '</span></div>' +
            '<span class="tag-status ' + st.cls + '">' + esc(st.label) + '</span>' +
          '</div>' +
          '<div class="tag-field">' +
            '<label>' + (isPosthog ? 'Project API key' : 'ID') + ' <span class="hint">' + esc(t.hint) + '</span></label>' +
            '<input type="text" data-tag-field="' + t.key + '.id" value="' + esc(cfg.id) + '" placeholder="' + esc(t.placeholder) + '" autocomplete="off" spellcheck="false">' +
          '</div>' +
          (isPosthog
            ? '<div class="tag-field">' +
                '<label>Host <span class="hint">EU users may prefer eu.posthog.com</span></label>' +
                '<input type="text" data-tag-field="posthog.host" value="' + esc(cfg.host) + '" placeholder="https://app.posthog.com" autocomplete="off" spellcheck="false">' +
              '</div>'
            : '') +
          '<div class="tag-field-row">' +
            '<div class="tag-field">' +
              '<label>Surface</label>' +
              '<select data-tag-field="' + t.key + '.scope">' +
                '<option value="all"' + (cfg.scope === 'all' ? ' selected' : '') + '>Marketing + app</option>' +
                '<option value="marketing"' + (cfg.scope === 'marketing' ? ' selected' : '') + '>Marketing surface only</option>' +
                '<option value="app"' + (cfg.scope === 'app' ? ' selected' : '') + '>App surface only</option>' +
                '<option value="campaigns"' + (cfg.scope === 'campaigns' ? ' selected' : '') + '>Campaign landings only</option>' +
              '</select>' +
            '</div>' +
            '<div class="tag-field">' +
              '<label>Status</label>' +
              '<select data-tag-field="' + t.key + '.enabled">' +
                '<option value="true"'  + (cfg.enabled       ? ' selected' : '') + '>Enabled</option>' +
                '<option value="false"' + (!cfg.enabled      ? ' selected' : '') + '>Disabled</option>' +
              '</select>' +
            '</div>' +
          '</div>' +
          '<div class="tag-toggles">' +
            '<label><input type="checkbox" data-tag-field="' + t.key + '.consentRequired"' + (cfg.consentRequired ? ' checked' : '') + '> Require consent before loading</label>' +
          '</div>' +
          '<div class="tag-actions">' +
            '<a class="ai-btn primary" data-tag-act="save" data-key="' + t.key + '">Save</a>' +
            '<a class="ai-btn" data-tag-act="test" data-key="' + t.key + '">Test fire</a>' +
            (cfg.id ? '<a class="ai-btn danger" data-tag-act="clear" data-key="' + t.key + '">Clear ID</a>' : '') +
          '</div>' +
        '</div>'
      );
    }).join('');

    const c = marketingTags.consent;
    const consentPanel =
      '<div class="consent-panel">' +
        '<h4>Cookie consent banner<span class="helper">Shown on first visit · gates non-essential tags</span></h4>' +
        '<div class="consent-grid">' +
          '<div class="tag-field">' +
            '<label>Banner copy <span class="hint">Plain text · 1-2 sentences</span></label>' +
            '<textarea data-tag-field="consent.bannerCopy" rows="4" style="font-family: var(--font-ui); font-size: 13px; padding: 10px 12px; border: 1px solid var(--cms-border-strong); border-radius: 6px; resize: vertical;">' + esc(c.bannerCopy) + '</textarea>' +
            '<div class="tag-field-row" style="margin-top: 10px;">' +
              '<div class="tag-field">' +
                '<label>Primary label</label>' +
                '<input type="text" data-tag-field="consent.primaryLabel" value="' + esc(c.primaryLabel) + '" style="font-family: var(--font-ui);">' +
              '</div>' +
              '<div class="tag-field">' +
                '<label>Reject label</label>' +
                '<input type="text" data-tag-field="consent.rejectLabel" value="' + esc(c.rejectLabel) + '" style="font-family: var(--font-ui);">' +
              '</div>' +
            '</div>' +
            '<div class="tag-field" style="margin-top: 10px;">' +
              '<label>Privacy link URL</label>' +
              '<input type="text" data-tag-field="consent.privacyLink" value="' + esc(c.privacyLink) + '" placeholder="/privacy">' +
            '</div>' +
            '<div class="tag-actions" style="margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--cms-border);">' +
              '<a class="ai-btn primary" data-tag-act="save-consent">Save banner</a>' +
              '<a class="ai-btn" data-tag-act="export-config">Export full config (JSON)</a>' +
              '<a class="ai-btn" data-tag-act="reset-consent">Reset to default</a>' +
            '</div>' +
          '</div>' +
          '<div class="preview">' +
            '<span class="preview-label">Live preview</span>' +
            esc(c.bannerCopy) +
            '<div class="preview-actions">' +
              '<a class="preview-btn primary">' + esc(c.primaryLabel) + '</a>' +
              '<a class="preview-btn">' + esc(c.rejectLabel) + '</a>' +
            '</div>' +
          '</div>' +
          '<div class="preview" style="background: var(--cms-surface-2); color: var(--cms-text);">' +
            '<span class="preview-label" style="color: var(--cms-muted);">Tags currently loading</span>' +
            tags.map(t => {
              const cfg = marketingTags[t.key];
              const status = cfg.enabled && cfg.id
                ? '<span style="color: var(--cms-success); font-weight: 600;">✓</span>'
                : '<span style="color: var(--cms-muted);">·</span>';
              const scopeLabel = ({ all: 'all surfaces', marketing: 'marketing', app: 'app', campaigns: 'campaigns' })[cfg.scope];
              return '<div style="display: grid; grid-template-columns: 18px 1fr auto; gap: 10px; padding: 4px 0; font-family: var(--font-ui); font-size: 12px; align-items: center;">' +
                status +
                '<span>' + esc(t.name) + '</span>' +
                '<span style="font-family: var(--font-mono); font-size: 11px; color: var(--cms-muted);">' + esc(scopeLabel) + '</span>' +
              '</div>';
            }).join('') +
          '</div>' +
        '</div>' +
      '</div>';

    mount.innerHTML = '<div class="tag-grid">' + cards + '</div>' + consentPanel;
  }

  // Marketing tags · input handler (delegated)
  document.addEventListener('input', (e) => {
    const tgt = e.target.dataset && e.target.dataset.tagField;
    if (!tgt) return;
    const [section, field] = tgt.split('.');
    if (section === 'consent') {
      marketingTags.consent[field] = e.target.value;
      const preview = $('#marketing-tags-mount .preview');
      if (preview && (field === 'bannerCopy' || field === 'primaryLabel' || field === 'rejectLabel')) {
        renderMarketingTags();
      }
      return;
    }
    const cfg = marketingTags[section];
    if (!cfg) return;
    let v = e.target.value;
    if (field === 'enabled') v = (v === 'true');
    else if (field === 'consentRequired') v = e.target.checked;
    cfg[field] = v;
    if (field === 'enabled' || field === 'id') {
      const card = e.target.closest('.tag-card');
      if (card) {
        const st = tagStatus(cfg);
        const pill = card.querySelector('.tag-status');
        if (pill) {
          pill.className = 'tag-status ' + st.cls;
          pill.textContent = st.label;
        }
      }
    }
  });

  // Marketing tags · click handler (delegated)
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tag-act]');
    if (!t) return;
    const act = t.dataset.tagAct;
    const key = t.dataset.key;
    if (act === 'save') {
      const cfg = marketingTags[key];
      if (cfg.enabled && !cfg.id) {
        toast('Cannot enable ' + key + ' without an ID', 'warning');
        return;
      }
      toast(key + ' saved · ' + (cfg.enabled ? 'will load on next deploy' : 'disabled'), 'success');
      renderMarketingTags();
    } else if (act === 'test') {
      const cfg = marketingTags[key];
      if (!cfg.id) { toast('Set an ID before firing a test event', 'warning'); return; }
      toast('Test event fired to ' + key + ' (' + cfg.id + ')', 'info');
    } else if (act === 'clear') {
      marketingTags[key].id = '';
      marketingTags[key].enabled = false;
      toast(key + ' ID cleared', 'info');
      renderMarketingTags();
    } else if (act === 'save-consent') {
      toast('Consent banner saved', 'success');
    } else if (act === 'reset-consent') {
      marketingTags.consent = {
        bannerCopy: 'Counsel.day uses cookies to understand how you arrived and what helped you decide to sign up. Your votes, notes, and decisions inside the product are always private and never shared with these tools.',
        primaryLabel: 'Accept all',
        rejectLabel: 'Essentials only',
        privacyLink: '/privacy',
      };
      toast('Consent banner reset to default', 'info');
      renderMarketingTags();
    } else if (act === 'export-config') {
      const blob = new Blob([JSON.stringify(marketingTags, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'counsel-day-marketing-tags-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('Marketing tag config exported as JSON', 'success');
    }
  });

  // ============================================================
  // Render
  // ============================================================
  function render() {
    renderToolbar();
    renderTable();
    renderPagination();
    renderUserDetail();
    renderVerdictAI();
    renderMarketingTags();
  }

  function renderToolbar() {
    const totals = {
      all:       state.users.length,
      solo:      state.users.filter(u => isSoloFamily(u.edition, 'solo')).length,
      couple:    state.users.filter(u => isSoloFamily(u.edition, 'couple')).length,
      family:    state.users.filter(u => isSoloFamily(u.edition, 'family')).length,
      annual:    state.users.filter(u => isAnnual(u.edition)).length,
      suspended: state.users.filter(u => u.status === 'suspended').length,
      deleting:  state.users.filter(u => u.status === 'deleting').length,
    };
    const chips = $('#um-filters');
    if (chips) {
      chips.innerHTML = [
        ['all',       'All · ' + totals.all],
        ['solo',      'Solo · ' + totals.solo],
        ['couple',    'Couple · ' + totals.couple],
        ['family',    'Family · ' + totals.family],
        ['annual',    'Annual · ' + totals.annual],
        ['suspended', 'Suspended · ' + totals.suspended],
        ['deleting',  'Deleting · ' + totals.deleting],
      ].map(([f, label]) => '<a data-filter="' + f + '"' + (state.filter === f ? ' class="active"' : '') + '>' + label + '</a>').join('');
    }
    const { filtered } = paged();
    const start = filtered.length === 0 ? 0 : (state.page - 1) * state.perPage + 1;
    const end = Math.min(start + state.perPage - 1, filtered.length);
    const info = $('#um-stats-info'); if (info) info.textContent = 'Showing ' + start + '-' + end + ' of ' + filtered.length;
    const sortLabel = ({ 'lastSignIn': 'Last sign-in', 'signupAt': 'Signed up', 'email': 'Email', 'lifetimeRevenue': 'Lifetime $', 'decisions': 'Decisions' })[state.sortBy] || state.sortBy;
    const sort = $('#um-stats-sort'); if (sort) sort.textContent = 'Sort: ' + sortLabel + ' ' + (state.sortDir === 'desc' ? '↓' : '↑');
    const n = state.selectedIds.size;
    const bulkLabel = $('#um-bulk-label'); if (bulkLabel) bulkLabel.textContent = 'Bulk on selected (' + n + ')';
    $$('#um-bulk-actions .bulk-act').forEach(a => {
      if (a.dataset.bulk === 'add' || a.dataset.bulk === 'export') return;
      a.classList.toggle('disabled', n === 0);
    });
  }

  function renderTable() {
    const tbody = $('#um-tbody');
    if (!tbody) return;
    const { page, filtered } = paged();
    if (page.length === 0) {
      tbody.innerHTML = '<tr><td colspan="11" style="padding: 48px; text-align: center; font-family: \'Newsreader\', Georgia, serif; font-style: italic; color: var(--muted);">No users match the current filters. <a data-action="clear-filters" style="color: var(--burgundy); border-bottom: 1px solid var(--burgundy); cursor: pointer; margin-left: 8px;">Clear filters</a></td></tr>';
      return;
    }
    tbody.innerHTML = page.map(u => {
      const selected = state.selectedIds.has(u.id);
      const open = u.id === state.openUserId;
      return '<tr class="' + (selected ? 'selected ' : '') + (open ? 'open ' : '') + '" data-id="' + u.id + '">' +
        '<td class="cb"><input type="checkbox" data-action="toggle-select" data-id="' + u.id + '"' + (selected ? ' checked' : '') + '></td>' +
        '<td>' + esc(u.email) + (u.vip ? ' <span class="pill green" style="margin-left: 4px;">VIP</span>' : '') + '</td>' +
        '<td class="mono">' + u.id + '</td>' +
        '<td>' + editionPill(u.edition) + '</td>' +
        '<td>' + esc(u.country) + '</td>' +
        '<td class="mono">' + fmtShortDate(u.signupAt) + '</td>' +
        '<td class="mono">' + timeAgo(u.lastSignIn) + '</td>' +
        '<td class="num">' + u.decisions + '</td>' +
        '<td class="num">$' + u.lifetimeRevenue.toFixed(2) + '</td>' +
        '<td>' + statusPill(u.status) + '</td>' +
        '<td class="actions-cell"><a data-action="view" data-id="' + u.id + '">' + (open ? 'Hide' : 'View') + '</a><a data-action="reset" data-id="' + u.id + '">Reset</a></td>' +
        '</tr>';
    }).join('');
  }

  function renderPagination() {
    const { filtered, totalPages } = paged();
    const start = filtered.length === 0 ? 0 : (state.page - 1) * state.perPage + 1;
    const end = Math.min(start + state.perPage - 1, filtered.length);
    const info = $('#um-page-info');
    if (info) info.innerHTML = 'Showing <strong>' + start + '-' + end + '</strong> of ' + filtered.length + ' users';
    const pages = $('#um-page-controls');
    if (pages) {
      let html = '<a data-page="prev">‹ Prev</a>';
      for (let i = 1; i <= totalPages; i++) {
        html += '<a data-page="' + i + '"' + (i === state.page ? ' class="active"' : '') + '>' + i + '</a>';
      }
      html += '<a data-page="next">Next ›</a>';
      pages.innerHTML = html;
    }
  }

  function renderUserDetail() {
    const mount = $('#user-detail-mount');
    if (!mount) return;
    if (!state.openUserId) {
      mount.innerHTML = '<div class="user-detail" style="padding: 48px; text-align: center; font-family: \'Newsreader\', Georgia, serif; font-style: italic; color: var(--muted);">Select a user from the table above to inspect their account, subscription, usage, action history, and internal notes.</div>';
      return;
    }
    const u = state.users.find(x => x.id === state.openUserId);
    if (!u) { state.openUserId = null; renderUserDetail(); return; }

    const tabs = [
      ['account', 'Account & auth'],
      ['subscription', 'Subscription & billing'],
      ['usage', 'Usage & engagement'],
      ['audit', 'Audit log · ' + buildAuditLog(u).length],
      ['notes', 'Internal notes · ' + u.internalNotes.length],
    ];

    mount.innerHTML =
      '<div class="user-detail">' +
        '<div class="user-detail-head">' +
          '<div><div class="who">' + esc(u.email) + '<span class="sub">' + u.id + ' · ' + u.country + ' · signed up ' + fmtDate(u.signupAt) + '</span></div></div>' +
          '<div class="badges">' + statusPill(u.status) + ' ' + editionPill(u.edition) + (u.vip ? ' <span class="pill green">VIP</span>' : '') + '</div>' +
        '</div>' +
        '<div class="user-detail-tabs">' +
          tabs.map(([k, label]) => '<a data-tab="' + k + '"' + (state.activeTab === k ? ' class="active"' : '') + '>' + esc(label) + '</a>').join('') +
        '</div>' +
        '<div class="user-detail-body">' + renderTab(u) + '</div>' +
        '<div class="user-detail-actions">' +
          '<span class="label">Operator actions</span>' +
          '<a class="primary" data-act="reset" data-id="' + u.id + '">Send password reset (magic link via Auth0)</a>' +
          '<a data-act="open-auth0" data-id="' + u.id + '">Open in Auth0 dashboard</a>' +
          '<a data-act="tier" data-id="' + u.id + '">Change subscription tier</a>' +
          '<a data-act="signout" data-id="' + u.id + '">Force sign out (all devices)</a>' +
          '<a data-act="note" data-id="' + u.id + '">Add internal note</a>' +
          '<a data-act="vip" data-id="' + u.id + '">' + (u.vip ? 'Remove VIP flag' : 'Mark as VIP') + '</a>' +
          '<a data-act="email" data-id="' + u.id + '">Email this user</a>' +
          (u.status === 'suspended'
            ? '<a class="danger" data-act="restore" data-id="' + u.id + '">Restore account</a>'
            : (u.status === 'deleting'
                ? '<a class="danger" data-act="cancel-delete" data-id="' + u.id + '">Cancel deletion</a>'
                : '<a class="danger" data-act="suspend" data-id="' + u.id + '">Suspend account</a>')) +
          (u.status === 'deleting' ? '' : '<a class="danger" data-act="delete" data-id="' + u.id + '">Initiate deletion (24h SLA)</a>') +
        '</div>' +
      '</div>';
  }

  function renderTab(u) {
    switch (state.activeTab) {
      case 'account': return renderAccountTab(u);
      case 'subscription': return renderSubscriptionTab(u);
      case 'usage': return renderUsageTab(u);
      case 'audit': return renderAuditTab(u);
      case 'notes': return renderNotesTab(u);
      default: return '';
    }
  }

  function row(k, v) { return '<div class="user-detail-row"><span class="k">' + esc(k) + '</span><span class="v">' + v + '</span></div>'; }

  function renderAccountTab(u) {
    const auth = u.authMethod === 'google' ? 'Google (via Auth0)' : 'Magic-link email (via Auth0)';
    return '<div class="detail-rows">' +
      row('Email', esc(u.email) + ' <span class="mono">(verified)</span>') +
      row('Display name', esc(u.displayName || '·')) +
      row('Auth0 sub', '<span class="mono">' + esc(u.auth0Sub) + '</span>') +
      row('Auth method', auth) +
      row('Created', fmtDateTime(u.signupAt) + ' NZDT') +
      row('Last sign-in', fmtDateTime(u.lastSignIn) + ' · ' + timeAgo(u.lastSignIn)) +
      row('Device', esc(u.device) + ' · ' + esc(u.city) + ', ' + esc(u.country) + ' <span class="mono">(via Auth0)</span>') +
      row('IP', '<span class="mono">' + esc(u.ip) + '</span>') +
      row('2-factor', (u.mfaEnabled ? 'Enabled · WebAuthn' : 'Not enabled') + ' <span class="mono">(managed in Auth0)</span>') +
      row('Prompt time', u.notificationTime + ' · NZDT · ' + u.notificationChannel + ' channel') +
      row('Locale', esc(u.locale)) +
      row('Marketing emails', 'Opted in to weekly digest') +
    '</div>';
  }

  function renderSubscriptionTab(u) {
    const taxRegion = ({ NZ: 'New Zealand · 15% GST', AU: 'Australia · 10% GST', UK: 'UK · 20% VAT', DE: 'Germany · 19% VAT', FR: 'France · 20% VAT', US: 'US · per state via Stripe Tax' })[u.country] || 'Per Stripe Tax rules';
    const annual = isAnnual(u.edition);
    const annualPrice = planAnnualPrice(u.edition);
    const recentCount = u.lifetimeRevenue > 0
      ? (annual ? '1 annual charge · ' + fmtShortDate(u.signupAt) : Math.ceil(u.lifetimeRevenue / planPerDecisionPrice(u.edition === 'solo-annual' ? 'solo' : (u.edition === 'couple-annual' ? 'couple' : (u.edition === 'family-annual' ? 'family' : u.edition)))) + ' decision charge(s) · last ' + fmtShortDate(u.lastSignIn))
      : 'No history';
    const pendingLabel = 'Upfront charging · nothing pending';
    return '<div class="detail-rows">' +
      row('Plan', '<strong>' + editionLabel(u.edition) + '</strong>') +
      row('State', u.status === 'suspended' ? 'Suspended' : (u.lifetimeRevenue > 0 ? 'Active · paying' : 'Active · no paid history')) +
      row('Stripe customer', '<span class="mono">' + esc(u.stripeCustomer) + '</span>') +
      row('Lifetime $', '<strong>$' + u.lifetimeRevenue.toFixed(2) + ' USD</strong>') +
      row('Card on file', u.cardOnFile ? 'Visa · ending 4242 · expires 03/2028' : 'None') +
      row('Pending', pendingLabel) +
      row('Recent charges', recentCount) +
      row('Refunds', 'None') +
      row('Tax region', taxRegion) +
      row('Promo code', u.id === 'user_82b0' ? 'PRACTITIONER50 redeemed once' : 'No code redeemed') +
      row('Participants', u.decisions > 0 ? 'Has run ' + u.decisions + ' decision' + (u.decisions === 1 ? '' : 's') + ' on this plan' : 'No decisions yet on this plan') +
      row('Renewal', annual
        ? 'Annual · renews ' + fmtDate(new Date(new Date(u.signupAt).getTime() + 86400 * 365 * 1000).toISOString()) + ' · $' + annualPrice.toFixed(2) + ' USD'
        : 'Per-decision · no recurring charge') +
      (annual ? row('Annual decision cap', 'Up to 100 ' + (u.edition === 'solo-annual' ? 'Solo' : (u.edition === 'couple-annual' ? 'Couple' : 'Family')) + ' decisions per year · break-even at 10') : '') +
    '</div>';
  }

  function renderUsageTab(u) {
    const completed = u.decisions - u.activeDecisions;
    const stage = u.decisions === 0 ? 'Signed up · not yet voted' : (u.activeDecisions === 0 ? 'Completed verdict · returning' : 'Active in decision');
    const sessions = Math.max(2, Math.floor(u.votes / 3));
    const chars = u.notes * 220;
    return '<div class="detail-rows">' +
      row('Decisions', '<strong>' + u.decisions + ' ever</strong> · ' + u.activeDecisions + ' active · ' + completed + ' complete') +
      row('Votes cast', u.votes.toString()) +
      row('Notes written', u.notes + (u.notes > 0 ? ' · approx ' + chars.toLocaleString() + ' chars total' : '')) +
      row('Verdicts read', completed.toString()) +
      row('Verdict ratings', completed > 0 ? 'Avg 4.2 / 5 across ' + completed + ' rated' : 'No verdicts yet') +
      row('Sessions', sessions + ' · avg 4 min each') +
      row('Last activity', timeAgo(u.lastSignIn) + ' (sign-in)') +
      row('Funnel stage', stage) +
      row('Support touches', '0 inbound emails') +
      row('VIP flag', u.vip ? 'Flagged as VIP' : 'Not flagged') +
      row('Risk score', u.status === 'suspended' ? 'Elevated · pending investigation' : 'Low (default)') +
    '</div>';
  }

  function renderAuditTab(u) {
    const events = buildAuditLog(u);
    if (events.length === 0) return '<div class="empty-note">No actions yet on this account.</div>';
    return '<div class="audit-log">' + events.map(e =>
      '<div class="audit-row audit-' + e.category + '">' +
        '<div class="audit-ts"><div class="ts-time">' + fmtDateTime(e.ts) + '</div><div class="ts-rel">' + timeAgo(e.ts) + '</div></div>' +
        '<div class="audit-dot"></div>' +
        '<div class="audit-body"><div class="audit-summary">' + esc(e.summary) + '</div>' +
          (e.meta ? '<div class="audit-meta">' + esc(e.meta) + '</div>' : '') +
          '<div class="audit-source">via ' + esc(e.source) + '</div>' +
        '</div>' +
      '</div>'
    ).join('') + '</div>';
  }

  function renderNotesTab(u) {
    if (u.internalNotes.length === 0) return '<div class="empty-note">No internal notes yet. Click "Add internal note" below to start a private operator-only thread. Notes are visible to operators only; never shown to the user.</div>';
    return '<div class="notes-list">' + u.internalNotes.map(n =>
      '<div class="note-item"><div class="note-meta">' + fmtDateTime(n.ts) + ' · ' + esc(n.operator) + '</div><div class="note-body">' + esc(n.body) + '</div></div>'
    ).join('') + '</div>';
  }

  // ============================================================
  // Actions
  // ============================================================
  function actReset(u) {
    modal({
      title: 'Send password reset',
      body: '<p>Send a magic-link sign-in email to <strong>' + esc(u.email) + '</strong>?</p><p style="color: var(--muted); font-size: 14px;">Auth0 generates a one-time link valid for 1 hour and delivers it via Brevo to the user\'s verified email. The reset is logged in the audit trail. The user does not lose access to existing sessions.</p>',
      primaryLabel: 'Send reset email',
      primary: ({ close }) => {
        logEvent(u, { category: 'auth', summary: 'Password reset email sent by operator', meta: 'Sent to ' + u.email + ' · One-hour expiry · Operator: ' + state.operator, source: 'Admin portal' });
        close();
        toast('Password reset sent to ' + u.email, 'success');
        if (state.activeTab === 'audit') renderUserDetail();
      },
    });
  }

  function actSuspend(u) {
    modal({
      title: 'Suspend account',
      body: '<p>Suspend the account for <strong>' + esc(u.email) + '</strong>?</p><p style="color: var(--muted); font-size: 14px;">The user will not be able to sign in. Active decisions stay sealed; no votes can be cast while suspended. The suspension is reversible at any time. Auth0 blocks the user immediately on suspension.</p>',
      primaryLabel: 'Suspend account',
      primary: ({ close }) => {
        u.status = 'suspended';
        logEvent(u, { category: 'admin', summary: 'Account suspended by operator', meta: 'Operator: ' + state.operator + ' · Auth0 user blocked', source: 'Admin portal' });
        close();
        toast('Account suspended: ' + u.email, 'warning');
        render();
      },
    });
  }

  function actRestore(u) {
    u.status = 'active';
    logEvent(u, { category: 'admin', summary: 'Account restored by operator', meta: 'Operator: ' + state.operator + ' · Auth0 user unblocked', source: 'Admin portal' });
    toast('Account restored: ' + u.email, 'success');
    render();
  }

  function actToggleVip(u) {
    u.vip = !u.vip;
    logEvent(u, { category: 'admin', summary: u.vip ? 'Marked as VIP by operator' : 'VIP flag removed by operator', meta: 'Operator: ' + state.operator, source: 'Admin portal' });
    toast(u.vip ? 'Marked ' + u.email + ' as VIP' : 'VIP flag removed from ' + u.email, 'success');
    render();
  }

  function actNote(u) {
    modal({
      title: 'Add internal note',
      body: '<p>Internal notes are visible to operators only. Never shown to the user.</p><textarea id="note-text" rows="6" placeholder="Type your note about this user…"></textarea>',
      primaryLabel: 'Save note',
      primary: ({ content, close }) => {
        const text = content.querySelector('#note-text').value.trim();
        if (!text) { toast('Note is empty', 'warning'); return; }
        u.internalNotes.unshift({ ts: new Date().toISOString().slice(0, 16), operator: state.operator, body: text });
        logEvent(u, { category: 'admin', summary: 'Internal note added by operator', meta: 'Operator: ' + state.operator + ' · ' + text.length + ' chars', source: 'Admin portal' });
        close();
        toast('Note added for ' + u.email, 'success');
        state.activeTab = 'notes';
        renderUserDetail();
      },
    });
  }

  function actChangeTier(u) {
    const checked = (id) => u.edition === id ? ' checked' : '';
    modal({
      title: 'Change subscription plan',
      body:
        '<p>Change plan for <strong>' + esc(u.email) + '</strong>. Current plan: <strong>' + esc(editionLabel(u.edition)) + '</strong>.</p>' +
        '<p style="font-family: var(--font-ui); font-size: 11px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: var(--cms-muted); margin: 14px 0 8px;">Per decision</p>' +
        '<div class="tier-options">' +
          '<label class="tier-opt"><input type="radio" name="tier" value="solo"'          + checked('solo')          + '> <strong>Solo</strong> · 1st decision free, then $4.99 USD each</label>' +
          '<label class="tier-opt"><input type="radio" name="tier" value="couple"'        + checked('couple')        + '> <strong>Couple</strong> · $9.99 USD per decision (two participants)</label>' +
          '<label class="tier-opt"><input type="radio" name="tier" value="family"'        + checked('family')        + '> <strong>Family</strong> · $14.99 USD per decision (3-6 participants)</label>' +
        '</div>' +
        '<p style="font-family: var(--font-ui); font-size: 11px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: var(--cms-muted); margin: 18px 0 8px;">Annual · up to 100 decisions per year</p>' +
        '<div class="tier-options">' +
          '<label class="tier-opt"><input type="radio" name="tier" value="solo-annual"'   + checked('solo-annual')   + '> <strong>Solo Annual</strong> · $49 USD/year</label>' +
          '<label class="tier-opt"><input type="radio" name="tier" value="couple-annual"' + checked('couple-annual') + '> <strong>Couple Annual</strong> · $99 USD/year</label>' +
          '<label class="tier-opt"><input type="radio" name="tier" value="family-annual"' + checked('family-annual') + '> <strong>Family Annual</strong> · $149 USD/year</label>' +
        '</div>' +
        '<p style="color: var(--muted); font-size: 13px; margin-top: 14px;">The change takes effect immediately. Annual plans charge upfront and renew yearly; cancel anytime from the account page. Downgrades preserve any active decisions; no further upgrades are billed at the old price. Annual decision caps (100/year) reset on each renewal.</p>',
      primaryLabel: 'Apply tier',
      primary: ({ content, close }) => {
        const sel = content.querySelector('input[name="tier"]:checked');
        if (!sel) return;
        const newTier = sel.value, oldTier = u.edition;
        if (newTier === oldTier) { close(); return; }
        u.edition = newTier;
        logEvent(u, { category: 'subscription', summary: 'Tier changed by operator: ' + oldTier + ' → ' + newTier, meta: 'Operator: ' + state.operator + ' · Stripe customer ' + u.stripeCustomer, source: 'Admin portal' });
        close();
        toast('Tier changed for ' + u.email + ': ' + oldTier + ' → ' + newTier, 'success');
        render();
      },
    });
  }

  function actEmail(u) {
    modal({
      title: 'Email this user',
      body:
        '<p>Send a one-off email to <strong>' + esc(u.email) + '</strong> via Brevo.</p>' +
        '<div style="margin-bottom: 12px;"><label class="form-label">Subject</label><input type="text" id="email-subject" placeholder="Subject line…"></div>' +
        '<div><label class="form-label">Body</label><textarea id="email-body" rows="8" placeholder="Write your email…"></textarea></div>' +
        '<p style="color: var(--muted); font-size: 13px; margin-top: 14px;">Sent from <strong>hello@counsel.day</strong>. Counts toward the user\'s transactional email budget for the day. A copy is logged in the audit trail and not stored long-term.</p>',
      primaryLabel: 'Send email',
      primary: ({ content, close }) => {
        const subj = content.querySelector('#email-subject').value.trim();
        const body = content.querySelector('#email-body').value.trim();
        if (!subj || !body) { toast('Subject and body required', 'warning'); return; }
        logEvent(u, { category: 'admin', summary: 'Operator sent email: "' + subj.slice(0, 80) + (subj.length > 80 ? '…' : '') + '"', meta: 'Via Brevo from hello@counsel.day · ' + body.length + ' chars · Operator: ' + state.operator, source: 'Admin portal' });
        close();
        toast('Email sent to ' + u.email, 'success');
        if (state.activeTab === 'audit') renderUserDetail();
      },
    });
  }

  function actSignout(u) {
    modal({
      title: 'Force sign out',
      body: '<p>Sign <strong>' + esc(u.email) + '</strong> out of all active devices?</p><p style="color: var(--muted); font-size: 14px;">All existing Auth0 sessions for this user are revoked immediately. They will need to sign in again on each device. Useful when a user reports a lost or compromised device.</p>',
      primaryLabel: 'Force sign out',
      primary: ({ close }) => {
        logEvent(u, { category: 'auth', summary: 'All sessions revoked by operator', meta: 'Operator: ' + state.operator, source: 'Auth0 Management API' });
        close();
        toast('All sessions revoked: ' + u.email, 'success');
        if (state.activeTab === 'audit') renderUserDetail();
      },
    });
  }

  function actDelete(u) {
    modal({
      title: 'Initiate account deletion',
      body: '<p><strong>This will permanently delete the account for ' + esc(u.email) + ' within 24 hours.</strong></p><p style="color: var(--muted); font-size: 14px;">Coordinated cascade: Auth0 user deletion via Management API, then Postgres user row, votes, notes, and decisions. Backups expire within 30 days. No tombstone records. This is reversible only during the 24-hour SLA window via "Cancel deletion".</p>',
      primaryLabel: 'Initiate deletion',
      primary: ({ close }) => {
        u.status = 'deleting';
        logEvent(u, { category: 'admin', summary: 'Account deletion initiated by operator', meta: 'Operator: ' + state.operator + ' · 24h SLA · Cascade through Auth0 + Postgres + decisions', source: 'Admin portal' });
        close();
        toast('Deletion initiated for ' + u.email + ' (24h SLA)', 'warning');
        render();
      },
    });
  }

  function actCancelDelete(u) {
    u.status = 'active';
    logEvent(u, { category: 'admin', summary: 'Account deletion cancelled by operator within SLA', meta: 'Operator: ' + state.operator + ' · cascade aborted before any data removed', source: 'Admin portal' });
    toast('Deletion cancelled: ' + u.email, 'success');
    render();
  }

  function actOpenAuth0(u) {
    toast('Would open https://manage.auth0.com/dashboard/.../users/' + encodeURIComponent(u.auth0Sub), 'info');
  }

  // Bulk
  function actBulkReset() {
    const ids = Array.from(state.selectedIds);
    if (ids.length === 0) return;
    modal({
      title: 'Send password reset to ' + ids.length + ' user' + (ids.length === 1 ? '' : 's'),
      body: '<p>Send a magic-link reset email to each of the ' + ids.length + ' selected user' + (ids.length === 1 ? '' : 's') + '?</p><p style="color: var(--muted); font-size: 14px;">Each reset is independent; the user receives a one-time link valid for 1 hour. The bulk operation is logged once per user in the audit trail.</p>',
      primaryLabel: 'Send all',
      primary: ({ close }) => {
        ids.forEach(id => {
          const u = state.users.find(x => x.id === id);
          if (u) logEvent(u, { category: 'auth', summary: 'Password reset email sent (bulk operation)', meta: 'Operator: ' + state.operator + ' · Bulk batch of ' + ids.length, source: 'Admin portal' });
        });
        close();
        toast('Password reset sent to ' + ids.length + ' user' + (ids.length === 1 ? '' : 's'), 'success');
        state.selectedIds.clear();
        render();
      },
    });
  }

  function actBulkSuspend() {
    const ids = Array.from(state.selectedIds);
    if (ids.length === 0) return;
    modal({
      title: 'Suspend ' + ids.length + ' user' + (ids.length === 1 ? '' : 's'),
      body: '<p>Suspend the ' + ids.length + ' selected user' + (ids.length === 1 ? '' : 's') + '?</p><p style="color: var(--muted); font-size: 14px;">Each user is blocked at the Auth0 layer; existing decisions are sealed but not destroyed. Reversible per-user via the user detail panel.</p>',
      primaryLabel: 'Suspend all',
      primary: ({ close }) => {
        ids.forEach(id => {
          const u = state.users.find(x => x.id === id);
          if (u) { u.status = 'suspended'; logEvent(u, { category: 'admin', summary: 'Account suspended (bulk operation)', meta: 'Operator: ' + state.operator + ' · Bulk batch of ' + ids.length, source: 'Admin portal' }); }
        });
        close();
        toast(ids.length + ' user' + (ids.length === 1 ? '' : 's') + ' suspended', 'warning');
        state.selectedIds.clear();
        render();
      },
    });
  }

  function actExportCsv() {
    const { filtered } = paged();
    const header = 'id,email,display_name,country,edition,status,signup_at,last_sign_in,decisions,active_decisions,votes,notes,lifetime_revenue,auth_method,vip\n';
    const rows = filtered.map(u =>
      [u.id, '"' + u.email + '"', '"' + u.displayName + '"', u.country, u.edition, u.status, u.signupAt, u.lastSignIn, u.decisions, u.activeDecisions, u.votes, u.notes, u.lifetimeRevenue.toFixed(2), u.authMethod, u.vip].join(',')
    ).join('\n');
    const csv = header + rows;
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'counsel-day-users-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Exported ' + filtered.length + ' users as CSV', 'success');
  }

  function actAddUser() {
    toast('Add user flow would open a form (out of scope for this prototype)', 'info');
  }

  // ============================================================
  // Event handlers (delegated)
  // ============================================================
  document.addEventListener('click', (e) => {
    let t;

    if ((t = e.target.closest('[data-filter]'))) {
      state.filter = t.dataset.filter;
      state.page = 1;
      state.selectedIds.clear();
      render();
      return;
    }
    if (e.target.closest('[data-action="clear-filters"]')) {
      state.filter = 'all';
      state.search = '';
      const si = $('#um-search'); if (si) si.value = '';
      state.page = 1;
      render();
      return;
    }
    if ((t = e.target.closest('[data-action="view"]'))) {
      e.preventDefault(); e.stopPropagation();
      state.openUserId = state.openUserId === t.dataset.id ? null : t.dataset.id;
      state.activeTab = 'account';
      renderTable();
      renderUserDetail();
      const mount = $('#user-detail-mount');
      if (mount && state.openUserId) mount.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if ((t = e.target.closest('[data-action="reset"]'))) {
      e.preventDefault(); e.stopPropagation();
      const u = state.users.find(x => x.id === t.dataset.id);
      if (u) actReset(u);
      return;
    }
    if ((t = e.target.closest('[data-action="toggle-select"]'))) {
      const id = t.dataset.id;
      if (state.selectedIds.has(id)) state.selectedIds.delete(id);
      else state.selectedIds.add(id);
      renderToolbar();
      renderTable();
      return;
    }
    if ((t = e.target.closest('[data-page]'))) {
      const p = t.dataset.page;
      const { totalPages } = paged();
      if (p === 'prev') state.page = Math.max(1, state.page - 1);
      else if (p === 'next') state.page = Math.min(totalPages, state.page + 1);
      else state.page = parseInt(p, 10);
      state.selectedIds.clear();
      render();
      return;
    }
    if ((t = e.target.closest('.user-detail-tabs [data-tab]'))) {
      state.activeTab = t.dataset.tab;
      renderUserDetail();
      return;
    }
    if ((t = e.target.closest('[data-act]'))) {
      const u = state.users.find(x => x.id === t.dataset.id);
      if (!u) return;
      const handler = ({ reset: actReset, suspend: actSuspend, restore: actRestore, vip: actToggleVip, note: actNote, tier: actChangeTier, email: actEmail, signout: actSignout, delete: actDelete, 'cancel-delete': actCancelDelete, 'open-auth0': actOpenAuth0 })[t.dataset.act];
      if (handler) handler(u);
      return;
    }
    if ((t = e.target.closest('#um-bulk-actions .bulk-act'))) {
      if (t.classList.contains('disabled')) return;
      const kind = t.dataset.bulk;
      if (kind === 'reset') actBulkReset();
      else if (kind === 'suspend') actBulkSuspend();
      else if (kind === 'export') actExportCsv();
      else if (kind === 'add') actAddUser();
      else toast('Bulk ' + kind + ' would be wired to backend in production', 'info');
      return;
    }
    if ((t = e.target.closest('[data-sort]'))) {
      const col = t.dataset.sort;
      if (state.sortBy === col) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      else { state.sortBy = col; state.sortDir = 'desc'; }
      render();
      return;
    }
  });

  document.addEventListener('input', (e) => {
    if (e.target.id === 'um-search') {
      state.search = e.target.value;
      state.page = 1;
      render();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const overlay = $('#modal-overlay');
      if (overlay && !overlay.hidden) {
        overlay.hidden = true;
        $('#modal-content').innerHTML = '';
      }
    }
  });

  // ============================================================
  // Init
  // ============================================================
  function boot() {
    render();
    initCharts();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
