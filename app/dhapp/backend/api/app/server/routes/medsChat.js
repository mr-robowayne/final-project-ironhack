'use strict';

/**
 * Meds Chat (LAN-only, grounded)
 * Flow:
 * 1) Deterministic local retrieval (JSON store + leaflet chunks)
 * 2) Call internal llm-gateway (only component with outbound Internet)
 * 3) Return structured, evidence-linked answer to frontend
 */

const express = require('express');
const crypto = require('crypto');

const { retrieveMedsContext } = require('../../lib/medsRetrieve');

const router = express.Router();

const GATEWAY_URL = String(process.env.AI_SERVICE_URL || process.env.AI_GATEWAY_URL || 'http://llm-gateway:8088').replace(/\/+$/g, '');
const GATEWAY_TOKEN = String(process.env.AI_GATEWAY_TOKEN || '');
const GATEWAY_TIMEOUT_MS = Math.max(5000, Number(process.env.AI_GATEWAY_TIMEOUT_MS || 45000));

function extractQuestion(body) {
  const b = body && typeof body === 'object' ? body : {};
  if (typeof b.question === 'string' && b.question.trim()) return b.question.trim();

  // Backwards-compat: frontend used to send { messages:[{role,content},...]}
  const msgs = Array.isArray(b.messages) ? b.messages : [];
  const lastUser = msgs.filter((m) => m && m.role === 'user' && typeof m.content === 'string').slice(-1)[0];
  if (lastUser && lastUser.content.trim()) return lastUser.content.trim();
  return '';
}

function extractHistory(body, { maxTurns = 8, maxTextLen = 800 } = {}) {
  const b = body && typeof body === 'object' ? body : {};
  const raw = Array.isArray(b.history) ? b.history : [];
  const turns = [];
  for (const t of raw.slice(-maxTurns)) {
    if (!t || typeof t !== 'object') continue;
    const role = String(t.role || '').trim();
    if (role !== 'user' && role !== 'assistant') continue;
    const text = String(t.text || '').trim();
    if (!text) continue;
    turns.push({
      role,
      text: text.length > maxTextLen ? text.slice(0, maxTextLen - 1) + '…' : text,
      // Optional hint to re-focus retrieval via selectedId (still enforced by whitelist candidates).
      focusPrepId: Number.isFinite(Number(t.focusPrepId)) ? Number(t.focusPrepId) : undefined,
    });
  }
  return turns;
}

function kindTitle(kind) {
  const k = String(kind || '').toLowerCase();
  return ({
    indication: 'Indikationen',
    dosage: 'Dosierung/Anwendung (aus Fachtexten)',
    contraindication: 'Kontraindikationen',
    warning: 'Warnhinweise/Vorsichtsmassnahmen',
    interaction: 'Interaktionen/Wechselwirkungen',
    pregnancy: 'Schwangerschaft/Stillzeit',
    renal: 'Nierenfunktion',
    hepatic: 'Leberfunktion',
    side_effect: 'Nebenwirkungen',
    other: 'Weitere Hinweise',
  })[k] || 'Weitere Hinweise';
}

function buildAnswerMarkdown({ summary, matches, missingInfo, dataGaps, disclaimer }) {
  const lines = [];
  if (summary) {
    lines.push('## Zusammenfassung');
    lines.push(summary.trim());
    lines.push('');
  }

  if (Array.isArray(matches) && matches.length) {
    lines.push('## Treffer');
    for (const m of matches) {
      lines.push(`### ${m.brandName || 'Präparat'} (prepId ${m.prepId})`);
      const meta = [
        (m.ingredients && m.ingredients.length) ? `Wirkstoff(e): ${m.ingredients.join(', ')}` : null,
        (m.forms && m.forms.length) ? `Form(en): ${m.forms.join(', ')}` : null,
        m.atc ? `ATC: ${m.atc}` : null,
        m.rxStatus ? `Status: ${m.rxStatus}` : null,
      ].filter(Boolean).join(' · ');
      if (meta) lines.push(meta);
      lines.push('');

      const byKind = new Map();
      for (const st of (m.statements || [])) {
        const title = kindTitle(st.kind);
        if (!byKind.has(title)) byKind.set(title, []);
        byKind.get(title).push(st);
      }
      for (const [title, list] of byKind.entries()) {
        lines.push(`**${title}**`);
        for (const st of list) {
          const ev = Array.isArray(st.evidence) ? st.evidence : [];
          const refs = ev.map((e) => e.sourceRef).filter(Boolean);
          lines.push(`- ${String(st.text || '').trim()}${refs.length ? ` (Evidenz: ${refs.join(', ')})` : ''}`);
        }
        lines.push('');
      }
    }
  } else {
    lines.push('## Keine Treffer');
    lines.push('In den lokalen Präparate-/Fachtext-Daten wurden keine passenden Kandidaten gefunden.');
    lines.push('');
  }

  if (Array.isArray(dataGaps) && dataGaps.length) {
    lines.push('## Datenlücken');
    for (const g of dataGaps) lines.push(`- ${String(g)}`);
    lines.push('');
  }

  if (Array.isArray(missingInfo) && missingInfo.length) {
    lines.push('## Rückfragen (für eine präzisere Einordnung)');
    for (const q of missingInfo) lines.push(`- ${String(q)}`);
    lines.push('');
  }

  lines.push('---');
  lines.push(disclaimer || 'Hinweis: Diese Ausgabe ist eine neutrale Information aus lokalen Fachtexten und ersetzt keine ärztliche Beurteilung.');
  return lines.join('\n').trim();
}

function buildSafeSummary({ matches }) {
  const m = Array.isArray(matches) ? matches : [];
  if (!m.length) return 'Keine passenden Präparate in den lokalen Daten gefunden.';
  const names = m.map((x) => x.brandName).filter(Boolean);
  if (!names.length) return `Gefundene Präparate: ${m.length}.`;
  return `Gefundene Präparate: ${names.slice(0, 6).join(', ')}${names.length > 6 ? ' …' : ''}.`;
}

function clip(text, n = 220) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

function buildLegacyCards(matches) {
  const out = [];
  for (const m of (Array.isArray(matches) ? matches : [])) {
    const fields = [];
    const add = (label, value) => { if (value) fields.push({ label, value: clip(value) }); };
    add('Wirkstoff(e)', Array.isArray(m.ingredients) && m.ingredients.length ? m.ingredients.join(', ') : null);
    add('Form(en)', Array.isArray(m.forms) && m.forms.length ? m.forms.join(', ') : null);
    add('ATC', m.atc ? String(m.atc) : null);
    add('Status', m.rxStatus ? String(m.rxStatus) : null);
    const firstStatements = Array.isArray(m.statements) ? m.statements.slice(0, 4) : [];
    for (const st of firstStatements) add(kindTitle(st.kind), st.text);
    out.push({
      id: m.prepId,
      title: m.brandName || `Präparat ${m.prepId}`,
      atc: m.atc || null,
      manufacturer: null,
      leaflet: null,
      forms: Array.isArray(m.forms) && m.forms.length ? m.forms.join(', ') : null,
      fields,
    });
  }
  return out;
}

const CHUNK_KIND_MAP = {
  indications: 'indication',
  dosage: 'dosage',
  contraindications: 'contraindication',
  warnings: 'warning',
  interactions: 'interaction',
  side_effects: 'side_effect',
  pregnancy: 'pregnancy',
  renal: 'renal',
  hepatic: 'hepatic',
  allergens: 'other',
};

function buildFallbackMatches(items, { maxItems = 3, maxStatements = 4 } = {}) {
  const safeItems = Array.isArray(items) ? items.slice(0, maxItems) : [];
  return safeItems.map((it) => {
    const chunks = Array.isArray(it.leafletChunks) ? it.leafletChunks : [];
    let statements = chunks.slice(0, maxStatements).map((ch) => ({
      kind: CHUNK_KIND_MAP[String(ch.section || '').toLowerCase()] || 'other',
      text: clip(ch.text, 320),
      evidence: ch?.sourceRef ? [{ sourceRef: ch.sourceRef }] : [],
    }));
    if (!statements.length) {
      statements = [{
        kind: 'other',
        text: [
          it.ingredients?.length ? `Wirkstoff(e): ${it.ingredients.join(', ')}` : null,
          it.forms?.length ? `Form(en): ${it.forms.join(', ')}` : null,
          it.atc ? `ATC: ${it.atc}` : null,
        ].filter(Boolean).join(' · ') || 'Zu diesem Präparat liegen nur Metadaten vor.',
        evidence: [],
      }];
    }
    return {
      prepId: Number(it.prepId),
      brandName: it.brandName || null,
      ingredients: Array.isArray(it.ingredients) ? it.ingredients : [],
      forms: Array.isArray(it.forms) ? it.forms : [],
      atc: it.atc || null,
      rxStatus: it.rxStatus || null,
      statements,
      relevance: 'fallback',
    };
  });
}

function buildFallbackResponse({ question, items, retrievedMeta, requestId, reason }) {
  const matches = buildFallbackMatches(items);
  const summary = buildSafeSummary({ matches });
  const dataGaps = [
    'AI-Gateway aktuell nicht verfügbar, Antwort wurde lokal ohne LLM erstellt.',
  ];
  if (reason) dataGaps.push(`Gateway-Fehler: ${String(reason).slice(0, 240)}`);
  if (!matches.length) dataGaps.push('Keine lokalen Kandidaten gefunden (Produktname/Wirkstoff präzisieren).');

  const disclaimer = 'Hinweis: Fallback-Antwort aus lokalen Fachtexten ohne LLM-Auswertung.';
  const answerMarkdown = buildAnswerMarkdown({
    summary,
    matches,
    missingInfo: [],
    dataGaps,
    disclaimer,
  });

  return {
    summary,
    answer: answerMarkdown,
    cards: buildLegacyCards(matches),
    citations: [],
    answerMarkdown,
    matches,
    disclaimer,
    missingInfo: [],
    dataGaps,
    meta: {
      requestId,
      mode: 'fallback-local',
      question: String(question || ''),
      retrieved: retrievedMeta || null,
      gateway: { ok: false, reason: String(reason || 'unavailable') },
    },
  };
}

async function callGateway({ tenantId, question, items, requestId, history }) {
  if (!GATEWAY_TOKEN) {
    const err = new Error('AI_GATEWAY_TOKEN missing');
    err.status = 503;
    err.code = 'AI_GATEWAY_TOKEN_NOT_CONFIGURED';
    throw err;
  }
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), GATEWAY_TIMEOUT_MS);
  try {
    const res = await fetch(`${GATEWAY_URL}/v1/meds/ask`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-AI-Gateway-Token': GATEWAY_TOKEN,
        'X-Tenant-Id': String(tenantId),
        'X-Request-Id': String(requestId),
      },
      body: JSON.stringify({ question, items, history: Array.isArray(history) ? history : [] }),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error('Gateway error');
      err.status = res.status;
      err.payload = data;
      throw err;
    }
    return data || {};
  } finally {
    clearTimeout(t);
  }
}

async function medsChatHandler(req, res) {
  const started = Date.now();
  const requestId = String(req.headers['x-request-id'] || crypto.randomUUID());
  const tenantId = req?.tenant?.id;
  let question = '';
  let retrieved = null;
  let items = [];

  try {
    if (!tenantId) return res.status(400).json({ message: 'Mandant fehlt' });
    question = extractQuestion(req.body);
    if (!question) return res.status(400).json({ message: 'Leere Anfrage' });

    const selectedId = req.body?.selectedId ?? req.body?.selectedPrepId ?? null;
    const history = extractHistory(req.body);
    const maxItems = req.body?.maxItems ?? 4;
    const maxEvidencePerItem = req.body?.maxEvidencePerItem ?? 4;

    retrieved = await retrieveMedsContext({ question, selectedId, maxItems, maxEvidencePerItem });
    items = Array.isArray(retrieved?.items) ? retrieved.items : [];
    const byId = new Map(items.map((it) => [Number(it.prepId), it]));

    const gatewayResp = await callGateway({ tenantId, question, items, requestId, history });
    const matchesRaw = Array.isArray(gatewayResp?.matches) ? gatewayResp.matches : [];

    const matches = matchesRaw
      .map((m) => {
        const pid = Number(m?.prepId);
        const base = byId.get(pid);
        if (!base) return null;
        return {
          prepId: pid,
          brandName: base.brandName,
          ingredients: base.ingredients,
          forms: base.forms,
          atc: base.atc,
          rxStatus: base.rxStatus,
          statements: Array.isArray(m?.statements) ? m.statements : [],
          relevance: String(m?.relevance || ''),
        };
      })
      .filter(Boolean);

    const disclaimer =
      typeof gatewayResp?.disclaimer === 'string' && gatewayResp.disclaimer.trim()
        ? gatewayResp.disclaimer.trim()
        : 'Hinweis: Diese Ausgabe ist eine neutrale Information aus lokalen Fachtexten und ersetzt keine ärztliche Beurteilung.';

    const missingInfo = Array.isArray(gatewayResp?.missingInfo) ? gatewayResp.missingInfo : [];
    const dataGaps = [];
    if (!items.length) {
      dataGaps.push('Keine lokalen Kandidaten gefunden (Produktname/Wirkstoff präzisieren).');
    } else if (!matches.length) {
      dataGaps.push('Kandidaten gefunden, aber keine evidenzbasierten Aussagen konnten extrahiert werden.');
    }

    const summary = buildSafeSummary({ matches });
    const answerMarkdown = buildAnswerMarkdown({
      summary,
      matches,
      missingInfo,
      dataGaps,
      disclaimer,
    });
    const cards = buildLegacyCards(matches);

    const ms = Date.now() - started;
    try {
      console.log(JSON.stringify({ at: new Date().toISOString(), requestId, tenantId, route: '/api/meds-chat', status: 200, ms }));
    } catch {}

    return res.json({
      summary,
      // Legacy fields for existing frontend builds:
      answer: answerMarkdown,
      cards,
      citations: [],
      answerMarkdown,
      matches,
      disclaimer,
      missingInfo,
      dataGaps,
      meta: {
        requestId,
        retrieved: retrieved?.meta || null,
        gateway: gatewayResp?.meta || null,
      },
    });
  } catch (err) {
    const ms = Date.now() - started;
    const status = err?.name === 'AbortError' ? 504 : (err?.status || 502);
    try {
      const upstream = err?.payload && typeof err.payload === 'object'
        ? { gatewayError: err.payload.error || null, gatewayRequestId: err.payload.requestId || null }
        : null;
      console.warn(JSON.stringify({
        at: new Date().toISOString(),
        requestId,
        tenantId,
        route: '/api/meds-chat',
        status,
        ms,
        err: String(err?.message || err),
        upstream,
      }));
    } catch {}
    try {
      console.log(JSON.stringify({ at: new Date().toISOString(), requestId, tenantId, route: '/api/meds-chat', status, ms }));
    } catch {}
    if (status >= 500) {
      const fallback = buildFallbackResponse({
        question,
        items,
        retrievedMeta: retrieved?.meta || null,
        requestId,
        reason: err?.payload?.error || err?.message || err,
      });
      return res.json(fallback);
    }
    return res.status(status).json({ message: 'Meds-Chat nicht verfügbar', requestId });
  }
}

// Backwards-compat: mounted at /api/meds -> POST /api/meds/chat
router.post('/chat', medsChatHandler);

module.exports = { medsChatRouter: router, medsChatHandler };
