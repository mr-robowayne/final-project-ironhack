'use strict';

function normText(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function clip(text, n = 260) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

function sanitizeGatewayOutput(modelJson, { allowedPrepIds, allowedSourceRefsByPrepId, allowedSourceTextByPrepId } = {}) {
  const allowedIds = new Set((allowedPrepIds || []).map((x) => Number(x)).filter(Number.isFinite));
  const allowedRefs = allowedSourceRefsByPrepId || {};
  const allowedTexts = allowedSourceTextByPrepId || {};

  const out = {
    summary: typeof modelJson?.summary === 'string' ? modelJson.summary : '',
    matches: [],
    missingInfo: Array.isArray(modelJson?.missingInfo) ? modelJson.missingInfo.map(String) : [],
    dataGaps: Array.isArray(modelJson?.dataGaps) ? modelJson.dataGaps.map(String) : [],
    disclaimer: typeof modelJson?.disclaimer === 'string' ? modelJson.disclaimer : '',
    meta: { validationErrors: [] },
  };

  const matches = Array.isArray(modelJson?.matches) ? modelJson.matches : [];
  for (const m of matches) {
    const prepId = Number(m?.prepId);
    if (!Number.isFinite(prepId) || !allowedIds.has(prepId)) {
      out.meta.validationErrors.push({ code: 'UNKNOWN_PREP_ID', prepId: m?.prepId });
      continue;
    }

    const sourceSet = new Set((allowedRefs[prepId] || []).map(String));
    const sourceText = allowedTexts[prepId] && typeof allowedTexts[prepId] === 'object' ? allowedTexts[prepId] : {};
    const statements = Array.isArray(m?.statements) ? m.statements : [];
    const cleanedStatements = [];
    for (const st of statements) {
      const evidence = Array.isArray(st?.evidence) ? st.evidence : [];
      const cleanedEvidence = evidence
        .map((e) => ({
          sourceRef: String(e?.sourceRef || ''),
          quote: String(e?.quote || ''),
        }))
        .filter((e) => {
          if (!e.sourceRef) return false;
          if (!sourceSet.has(e.sourceRef)) return false;
          const ctx = sourceText[e.sourceRef];
          if (!ctx) return false;
          // If quote provided, it must be a literal excerpt from the provided local text chunk.
          if (e.quote && e.quote.trim()) return normText(ctx).includes(normText(e.quote));
          return true;
        })
        .map((e) => {
          const ctx = sourceText[e.sourceRef];
          const q = e.quote && e.quote.trim() ? e.quote.trim() : clip(ctx);
          return { sourceRef: e.sourceRef, quote: q };
        });

      if (cleanedEvidence.length === 0) {
        out.meta.validationErrors.push({ code: 'MISSING_OR_INVALID_EVIDENCE', prepId, kind: st?.kind });
        continue;
      }

      cleanedStatements.push({
        kind: String(st?.kind || 'other'),
        text: String(st?.text || ''),
        evidence: cleanedEvidence,
      });
    }

    if (cleanedStatements.length === 0) {
      out.meta.validationErrors.push({ code: 'NO_SUPPORTED_STATEMENTS', prepId });
      continue;
    }

    out.matches.push({
      prepId,
      relevance: String(m?.relevance || ''),
      statements: cleanedStatements,
    });
  }

  return out;
}

module.exports = { sanitizeGatewayOutput };
