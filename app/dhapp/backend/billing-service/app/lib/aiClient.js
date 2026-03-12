'use strict';

// Lightweight LocalAI client using native fetch (Node 18+)

const BASE = process.env.AI_BASE_URL || 'http://llm-local:8080/v1';
const MODEL = process.env.AI_MODEL || 'llama-3.1-8b-instruct';
const TEMP = Number(process.env.AI_TEMPERATURE || 0.2);
const TOP_P = Number(process.env.AI_TOP_P || 0.9);
const MAX_TOKENS = Number(process.env.AI_MAX_TOKENS || 512);
const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 65000);

async function chatCompletion({ system, messages, temperature, top_p, top_k, max_tokens, model, timeout_ms, stop } = {}) {
  if (!BASE) throw new Error('AI_BASE_URL not set');
  const payload = {
    model: model || MODEL,
    temperature: temperature != null ? temperature : TEMP,
    top_p: top_p != null ? top_p : TOP_P,
    max_tokens: max_tokens != null ? max_tokens : MAX_TOKENS,
    messages: [
      { role: 'system', content: system || '' },
      ...messages.map((m) => ({ role: m.role, content: m.content }))
    ],
  };
  if (top_k != null) payload.top_k = top_k;
  if (Array.isArray(stop) && stop.length) payload.stop = stop;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort('timeout'), timeout_ms != null ? timeout_ms : TIMEOUT_MS);
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: controller.signal,
  });
  clearTimeout(t);
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`AI error ${res.status}: ${t}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content ?? '';
  return { content, raw: data };
}

async function listModels() {
  if (!BASE) throw new Error('AI_BASE_URL not set');
  const res = await fetch(`${BASE}/models`, { method: 'GET' });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`AI models error ${res.status}: ${t}`);
  }
  const data = await res.json().catch(async () => ({ raw: await res.text() }));
  return data;
}

module.exports = { chatCompletion, listModels };
