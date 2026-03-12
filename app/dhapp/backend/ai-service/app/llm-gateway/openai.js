'use strict';

async function callOpenAIResponses({
  apiKey,
  model,
  system,
  user,
  schema,
  timeoutMs = 45000,
  maxOutputTokens = 2800,
  reasoningEffort = 'low',
} = {}) {
  if (!apiKey) throw new Error('OPENAI_API_KEY missing');
  if (!model) throw new Error('OPENAI_MODEL missing');

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort('timeout'), timeoutMs);
  try {
    const reasoning = (typeof reasoningEffort === 'string' && reasoningEffort.trim())
      ? { effort: reasoningEffort.trim() }
      : undefined;

    const payload = {
      model,
      store: false,
      // No tools, no browsing
      tools: [],
      max_output_tokens: Math.max(256, Math.min(4096, Number(maxOutputTokens || 1800))),
      ...(reasoning ? { reasoning } : {}),
      input: [
        { role: 'system', content: [{ type: 'input_text', text: system }] },
        { role: 'user', content: [{ type: 'input_text', text: user }] },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'meds_answer',
          strict: true,
          schema,
        },
      },
    };

    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const rawText = await res.text().catch(() => '');
    if (!res.ok) {
      const err = new Error(`OpenAI error ${res.status}`);
      err.status = res.status;
      err.detail = rawText.slice(0, 2000);
      throw err;
    }

    // The Responses API can return JSON output in different shapes; be defensive.
    const data = rawText ? JSON.parse(rawText) : {};

    // Extract textual output parts in order (can be split into multiple chunks).
    // Note: some models may return 'refusal' or 'summary_text' content types.
    const parts = [];
    if (Array.isArray(data?.output)) {
      for (const o of data.output) {
        const contentArr = Array.isArray(o?.content) ? o.content : (o?.content ? [o.content] : []);
        for (const c of contentArr) {
          if (!c || typeof c !== 'object') continue;
          const typ = c.type;
          if (typ !== 'output_text' && typ !== 'summary_text' && typ !== 'refusal') continue;
          const txt =
            (typeof c.text === 'string' && c.text) ||
            (typeof c.value === 'string' && c.value) ||
            (typeof c.refusal === 'string' && c.refusal) ||
            (typeof c.summary === 'string' && c.summary) ||
            '';
          if (txt) parts.push(txt);
        }
      }
    }
    const outputText = parts.length ? parts.join('') : (typeof data?.output_text === 'string' ? data.output_text : '');

    return { data, outputText };
  } catch (err) {
    if (err?.name === 'AbortError') {
      const e = new Error('OpenAI timeout');
      e.status = 504;
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(t);
  }
}

module.exports = { callOpenAIResponses };
