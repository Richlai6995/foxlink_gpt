/* Generate the English customer-audit slide deck (<=10 slides). */
const path = require('path');
const pptxgen = require(path.join(__dirname, '../server/node_modules/pptxgenjs'));

const pptx = new pptxgen();
pptx.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5 in
pptx.author = 'FOXLINK GPT (CORTEX)';
pptx.title = 'CORTEX — Customer Data Confidentiality Controls';

const NAVY = '1F4E79', BLUE = '2E75B6', AMBER = 'E8A33D';
const DARK = '333333', GRAY = '8A8A8A', LIGHT = 'F2F6FA', LINE = 'D9E2EC';
const F = 'Segoe UI';
const S = pptx.ShapeType;

function footer(s, num) {
  s.addText('CORTEX · Customer Data Confidentiality — Implemented Controls', {
    x: 0.5, y: 7.05, w: 10, h: 0.3, color: GRAY, fontSize: 9, fontFace: F,
  });
  s.addText(String(num), { x: 12.4, y: 7.05, w: 0.5, h: 0.3, color: GRAY, fontSize: 9, align: 'right', fontFace: F });
}

function titleBar(s, title) {
  s.addShape(S.rect, { x: 0, y: 0, w: '100%', h: 1.0, fill: { color: NAVY } });
  s.addShape(S.rect, { x: 0, y: 1.0, w: '100%', h: 0.06, fill: { color: AMBER } });
  s.addText(title, { x: 0.55, y: 0, w: 12.3, h: 1.0, color: 'FFFFFF', bold: true, fontSize: 25, valign: 'middle', fontFace: F });
}

function content(num, title, lead, bullets, note) {
  const s = pptx.addSlide();
  s.background = { color: 'FFFFFF' };
  titleBar(s, title);
  let y = 1.35;
  if (lead) {
    s.addText(lead, { x: 0.6, y, w: 12.1, h: 0.5, color: BLUE, italic: true, bold: true, fontSize: 15, fontFace: F });
    y += 0.62;
  }
  const objs = bullets.map((b) => {
    const txt = typeof b === 'string' ? b : b.text;
    const lvl = typeof b === 'object' && b.sub ? 1 : 0;
    return { text: txt, options: { bullet: { code: '2022', indent: 18 }, indentLevel: lvl, color: DARK, fontSize: 14, paraSpaceAfter: 7, fontFace: F } };
  });
  const bottom = note ? 6.5 : 6.95;
  s.addText(objs, { x: 0.65, y, w: 12.05, h: bottom - y, valign: 'top', lineSpacingMultiple: 1.04 });
  if (note) {
    s.addText(note, { x: 0.65, y: 6.45, w: 12.05, h: 0.5, color: GRAY, italic: true, fontSize: 10.5, fontFace: F });
  }
  footer(s, num);
  return s;
}

/* ---------- Slide 1 — Title ---------- */
(() => {
  const s = pptx.addSlide();
  s.background = { color: NAVY };
  s.addShape(S.rect, { x: 0.8, y: 3.45, w: 4.2, h: 0.07, fill: { color: AMBER } });
  s.addText('CORTEX', { x: 0.8, y: 1.55, w: 11.7, h: 1.0, color: 'FFFFFF', bold: true, fontSize: 50, fontFace: F, charSpacing: 2 });
  s.addText('Customer Data Confidentiality Controls', { x: 0.8, y: 2.55, w: 11.7, h: 0.8, color: 'FFFFFF', fontSize: 27, fontFace: F });
  s.addText('Security & Access-Control Mechanisms — Implemented', { x: 0.83, y: 3.65, w: 11.7, h: 0.5, color: 'CFE0F0', fontSize: 16, fontFace: F });
  s.addText('Foxlink AI Integration Platform   ·   Prepared for Customer Security Audit   ·   2026-06-11',
    { x: 0.83, y: 6.45, w: 11.7, h: 0.4, color: '94B2D2', fontSize: 12, fontFace: F });
})();

/* ---------- Slide 2 — Defense-in-Depth ---------- */
(() => {
  const s = pptx.addSlide();
  s.background = { color: 'FFFFFF' };
  titleBar(s, 'Defense-in-Depth Across the Data Lifecycle');
  const layers = [
    ['L1', 'Identity & Access', 'Who can enter — AD/LDAP, OIDC SSO, external MFA, auto role/org binding, instant force-logout'],
    ['L2', 'Data Visibility', 'What data they can see — data policies, Oracle Multi-Org scope, KB confidentiality, tiered sharing'],
    ['L3', 'Processing & Egress', 'Where it goes — provider routing, AES-256-GCM key encryption, verifiable downstream identity (JWT)'],
    ['L4', 'Audit & Retention', 'Logged & traceable — sensitive-word alerts, multi-source audit trail, tiered auto-purge'],
  ];
  let y = 1.45; const h = 1.24, gap = 0.13;
  layers.forEach(([tag, t, sub]) => {
    s.addShape(S.roundRect, { x: 0.6, y, w: 12.13, h, fill: { color: LIGHT }, line: { color: LINE, width: 1 }, rectRadius: 0.06 });
    s.addShape(S.rect, { x: 0.6, y, w: 1.5, h, fill: { color: NAVY } });
    s.addText(tag, { x: 0.6, y, w: 1.5, h, color: 'FFFFFF', bold: true, fontSize: 30, align: 'center', valign: 'middle', fontFace: F });
    s.addText(t, { x: 2.32, y: y + 0.14, w: 10.2, h: 0.5, color: NAVY, bold: true, fontSize: 18, fontFace: F });
    s.addText(sub, { x: 2.32, y: y + 0.62, w: 10.2, h: 0.55, color: DARK, fontSize: 12.5, fontFace: F });
    y += h + gap;
  });
  footer(s, 2);
})();

/* ---------- Slide 3 — L1 ---------- */
content(3, 'L1 — Identity & Access Control', null, [
  'Enterprise AD / LDAP login, hardened against LDAP injection (username allowlist + RFC 4515 filter escaping)',
  'OIDC Single Sign-On with state-parameter CSRF protection (one-shot, auto-expiring key)',
  'Opaque UUID bearer token + server-side session (Redis) — the token carries no identity data; 8-hour sliding expiry',
  'Local passwords stored with bcrypt (cost 12)',
  'Automatic role & org binding from Oracle ERP on first login: department, cost center, division, business group, plant',
  'External access enforces multi-factor authentication (Webex DM + Email one-time code)',
  'Admin can force-logout any user instantly — all of that user’s sessions are revoked (immediate de-provisioning)',
]);

/* ---------- Slide 4 — L2 Row-scope isolation ---------- */
content(4, 'L2 — Row-Scope Data Isolation', 'Goal: a business unit cannot query another unit’s order / procurement / BOM data.', [
  'Data policies stored across user / role / category layers, resolved by short-circuit priority order',
  'Connection-layer read-only enforcement — every ERP query forced to SELECT / WITH; all DML/DDL blocked (deterministic, cannot be bypassed)',
  'Out-of-scope query rejection — questions referencing org codes outside the user’s scope are blocked before any SQL is generated',
  'Oracle Multi-Org scope filtering — the user’s permitted org / operating-unit / set-of-books is injected as an IN-filter; no scope → zero results',
  'Resolved policy conditions are injected into the AI’s SQL-generation prompt',
  '“Full-block” policy — hard deny for non-admin users',
], 'Layers 1–3 above are enforced in code; layer 4 (policy row-filtering) is delivered via query-generation. Recommended to pair with least-privilege ERP accounts at source for depth.');

/* ---------- Slide 5 — KB confidentiality ---------- */
content(5, 'L2 — Knowledge-Base Confidentiality', null, [
  'Per-KB access table grants by user / role / department / cost center / division / plant / business group',
  'Two permission tiers: use (search & query) vs edit (modify & upload)',
  'Confidential KB — even system administrators see list metadata only; content, files and retrieval chunks stay hidden unless they are the owner or explicitly granted',
  'Confidential and public states are mutually exclusive',
  'Access is verified before retrieval — an unauthorized KB never enters the AI’s callable tool set, so it cannot be coerced out via chat / prompt injection',
  'External API keys: per-key KB allowlist + allow-confidential flag; write keys must act as a real user and inherit that user’s permissions',
]);

/* ---------- Slide 6 — Tiered sharing ---------- */
content(6, 'L2 — Tiered Sharing & Execution-Identity Guarantee', null, [
  'Project / dashboard / scheduled-task sharing with two tiers — use vs develop — across 7 grantee types',
  'Public projects require administrator approval before they take effect',
  'Scheduled tasks always execute under the owner’s identity — a develop grantee who edits the task cannot escalate privileges',
  'Tasks containing dangerous nodes (DB-write / KB-write / alert) cannot be shared at the develop tier',
  'Every share records the granter and timestamp for audit',
]);

/* ---------- Slide 7 — L3 egress + keys ---------- */
content(7, 'L3 — LLM Egress Boundary & Key Protection', null, [
  'LLM providers: Google Gemini (via Vertex AI) and Azure OpenAI; production text generation runs on Vertex AI (enterprise GCP)',
  'All stored LLM API keys are encrypted with AES-256-GCM (with integrity tag); the master key is injected via environment / secret store',
  'Azure models use per-model encrypted keys; Gemini production uses Vertex service-account credentials',
  'Gemini “thinking” segments are auto-filtered — internal reasoning is never returned to users',
  'Downstream identity (MCP tools): a per-call RS256 JWT (5-min expiry, jti anti-replay) lets downstream systems verify the real user instead of trusting the gateway',
], 'Enterprise data-protection terms (no-training / zero-retention / data residency) are contractual and provided as a contract annex; data residency follows the GCP / Azure project configuration.');

/* ---------- Slide 8 — L4 audit ---------- */
content(8, 'L4 — Audit, Detection & Retention', null, [
  'Sensitive-keyword detection on every chat message → logged + asynchronous admin email alert (detect → log → notify)',
  'Authentication audit log — login / MFA / IP-trust events with full context',
  'External API-key call audit — KB owners can review who accessed via which key',
  'MCP tool-call audit (user email + JWT jti) and ERP tool-execution audit',
  'Tiered retention with daily auto-purge: general audit 90d · sensitive audit 365d · chats 90d · session files 7d · token usage 365d',
  'Per-user and per-model usage attribution',
]);

/* ---------- Slide 9 — ERP / tool protection ---------- */
content(9, 'ERP / Tool Access & SQL-Injection Protection', null, [
  'Read-only enforcement at the database connection layer — SELECT / WITH only',
  'All tool parameter values are passed as Oracle bind variables — never string-concatenated — blocking parameter-based SQL injection',
  'Numeric / date type validation; list-of-values resolution disambiguates codes and names',
  'Manual tool execution enforces an access check (skill-access table: user / role / dept / plant / division / group)',
  'Write operations support human-confirmation tokens (5-min, single-use, anti-replay) and a dry-run mode (SAVEPOINT / ROLLBACK)',
]);

/* ---------- Slide 10 — Summary ---------- */
(() => {
  const s = content(10, 'Summary', null, [
    'Four enforced layers: identity → data scope → egress → audit',
    'Confidential-data isolation is enforced at multiple machine-level points: connection-layer read-only, out-of-scope rejection, KB content lockout, encrypted keys',
    'Complete audit trail with compliance-grade retention (sensitive records kept 365 days)',
    'Downstream systems receive a verifiable user identity — not blind gateway trust',
  ]);
  s.addShape(S.roundRect, { x: 0.65, y: 5.55, w: 12.05, h: 0.95, fill: { color: LIGHT }, line: { color: AMBER, width: 1.5 }, rectRadius: 0.06 });
  s.addText('Source-code evidence is available per security-questionnaire item on request.',
    { x: 0.9, y: 5.55, w: 11.6, h: 0.95, color: NAVY, bold: true, italic: true, fontSize: 14.5, valign: 'middle', fontFace: F });
})();

const OUT = path.join(__dirname, '../docs/CORTEX-Data-Confidentiality-EN.pptx');
pptx.writeFile({ fileName: OUT }).then((f) => console.log('WROTE', f));
