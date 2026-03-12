'use strict';

const express = require('express');
const crypto = require('crypto');

const { redactPII } = require('./redaction');
const { medsAnswerSchema } = require('./schema');
const { systemPromptDE, buildUserPrompt } = require('./prompt');
const { callOpenAIResponses } = require('./openai');
const { sanitizeGatewayOutput } = require('./validation');

const PORT = Number(process.env.PORT || 8088);
const host = (process.env.BIND_PUBLIC === 'true') ? '0.0.0.0' : '127.0.0.1';

const API_KEY = process.env.OPENAI_API_KEY || '';
const MODEL = process.env.OPENAI_MODEL || 'gpt-5-mini';
const TOKEN = String(process.env.AI_GATEWAY_TOKEN || '');
const TIMEOUT_MS = Math.max(5000, Number(process.env.OPENAI_TIMEOUT_MS || 45000));
const MAX_OUTPUT_TOKENS = Math.max(256, Number(process.env.OPENAI_MAX_OUTPUT_TOKENS || 2800));
const REASONING_EFFORT = String(process.env.OPENAI_REASONING_EFFORT || 'low');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '250kb' }));

function safeEq(a, b) {
  const aa = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  if (aa.length !== bb.length) return false;
  try { return crypto.timingSafeEqual(aa, bb); } catch { return false; }
}

app.get('/health', (_req, res) => res.json({ ok: true, openaiConfigured: !!API_KEY, model: MODEL }));

app.post('/v1/meds/ask', async (req, res) => {
  const started = Date.now();
  const requestId = String(req.headers['x-request-id'] || crypto.randomUUID());
  const tenantId = String(req.headers['x-tenant-id'] || '').trim();

  try {
    const providedToken = req.headers['x-ai-gateway-token'];
    if (!TOKEN) return res.status(503).json({ error: 'AI_GATEWAY_TOKEN_NOT_CONFIGURED' });
    if (!safeEq(providedToken, TOKEN)) return res.status(403).json({ error: 'FORBIDDEN' });
    if (!tenantId) return res.status(400).json({ error: 'TENANT_REQUIRED' });
    if (!API_KEY) return res.status(503).json({ error: 'OPENAI_API_KEY_NOT_SET' });

    const { question, items, history } = req.body || {};
    const q = String(question || '').trim();
    if (!q) return res.status(400).json({ error: 'QUESTION_REQUIRED' });

    const candidates = Array.isArray(items) ? items : [];
    if (candidates.length === 0) {
      return res.status(200).json({
        summary: '',
        matches: [],
        missingInfo: ['Bitte Präparat/Wirkstoff oder konkrete Fragestellung angeben.'],
        dataGaps: ['Keine lokalen Kandidaten gefunden.'],
        disclaimer: 'Hinweis: Diese Ausgabe ist eine neutrale Information aus lokalen Fachtexten und ersetzt keine ärztliche Beurteilung.',
        meta: { requestId, tenantId, validationErrors: [{ code: 'NO_CANDIDATES' }] },
      });
    }

    const redactedQuestion = redactPII(q, { maxLen: 2000 });
    const safeHistory = Array.isArray(history) ? history.slice(-8) : [];
    const redactedHistory = safeHistory
      .map((t) => {
        if (!t || typeof t !== 'object') return null;
        const role = t.role === 'assistant' ? 'assistant' : 'user';
        const text = redactPII(String(t.text || ''), { maxLen: 800 });
        if (!text.trim()) return null;
        const focusPrepId = Number.isFinite(Number(t.focusPrepId)) ? Number(t.focusPrepId) : undefined;
        return { role, text, focusPrepId };
      })
      .filter(Boolean);
    const system = systemPromptDE();
    const user = buildUserPrompt({ redactedQuestion, candidates, history: redactedHistory });

    const allowedPrepIds = candidates.map((c) => Number(c?.prepId)).filter(Number.isFinite);
    const allowedSourceRefsByPrepId = {};
    const allowedSourceTextByPrepId = {};
    for (const c of candidates) {
      const pid = Number(c?.prepId);
      if (!Number.isFinite(pid)) continue;
      const chunks = Array.isArray(c?.leafletChunks) ? c.leafletChunks : [];
      const refs = [];
      const textByRef = {};
      for (const ch of chunks) {
        const ref = String(ch?.sourceRef || '').trim();
        const txt = String(ch?.text || '').trim();
        if (!ref || !txt) continue;
        refs.push(ref);
        textByRef[ref] = txt;
      }
      allowedSourceRefsByPrepId[pid] = refs;
      allowedSourceTextByPrepId[pid] = textByRef;
    }

    const { data, outputText } = await callOpenAIResponses({
      apiKey: API_KEY,
      model: MODEL,
      system,
      user,
      schema: medsAnswerSchema,
      timeoutMs: TIMEOUT_MS,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      reasoningEffort: REASONING_EFFORT,
    });

    let modelJson;
    try {
      modelJson = JSON.parse(String(outputText || '').trim());
    } catch (e) {
      try {
        console.warn(JSON.stringify({
          at: new Date().toISOString(),
          requestId,
          tenantId,
          code: 'MODEL_OUTPUT_NOT_JSON',
          openaiStatus: String(data?.status || ''),
          openaiIncompleteReason: data?.incomplete_details?.reason || null,
          outputLen: String(outputText || '').length,
          outputItemTypes: Array.isArray(data?.output) ? data.output.map((o) => o?.type) : null,
          outputContentTypes: Array.isArray(data?.output)
            ? data.output.map((o) => Array.isArray(o?.content) ? o.content.map((c) => c?.type) : typeof o?.content)
            : null,
        }));
      } catch {}
      return res.status(502).json({ error: 'MODEL_OUTPUT_NOT_JSON', requestId });
    }

    const cleaned = sanitizeGatewayOutput(modelJson, { allowedPrepIds, allowedSourceRefsByPrepId, allowedSourceTextByPrepId });
    cleaned.meta.requestId = requestId;
    cleaned.meta.tenantId = tenantId;

    // Minimal, non-PHI logging
    const ms = Date.now() - started;
    try { console.log(JSON.stringify({ at: new Date().toISOString(), requestId, tenantId, route: '/v1/meds/ask', status: 200, ms })); } catch {}
    return res.json(cleaned);
  } catch (err) {
    const ms = Date.now() - started;
    const status = err?.status && Number.isFinite(err.status) ? err.status : 502;
    // Debug logging without PHI/PII: only OpenAI error metadata (never prompt/content).
    try {
      if (err?.detail && typeof err.detail === 'string') {
        let msg = err.detail;
        try {
          const parsed = JSON.parse(err.detail);
          const e = parsed?.error || {};
          msg = JSON.stringify({ message: e.message, type: e.type, code: e.code, param: e.param });
        } catch {}
        console.warn(JSON.stringify({ at: new Date().toISOString(), requestId, tenantId, openaiStatus: status, openaiError: String(msg).slice(0, 800) }));
      }
    } catch {}
    try { console.log(JSON.stringify({ at: new Date().toISOString(), requestId, tenantId, route: '/v1/meds/ask', status, ms })); } catch {}
    return res.status(status).json({ error: 'GATEWAY_ERROR', requestId });
  }
});

app.listen(PORT, host, () => {
  console.log(`[llm-gateway] listening on http://${host}:${PORT}`);
});

module.exports = { app };
