'use strict';

const jsonStore = require('./medJsonStore');
const sectionsRepo = require('./sectionsRepo');

const SECTION_SPECS = [
  { key: 'indications', title: 'Indikationen' },
  { key: 'dosage', title: 'Dosierung/Anwendung' },
  { key: 'contraindications', title: 'Kontraindikationen' },
  { key: 'warnings', title: 'Warnhinweise/Vorsichtsmassnahmen' },
  { key: 'interactions', title: 'Interaktionen/Wechselwirkungen' },
  { key: 'side_effects', title: 'Nebenwirkungen' },
  { key: 'pregnancy', title: 'Schwangerschaft/Stillzeit' },
  { key: 'renal', title: 'Nierenfunktion' },
  { key: 'hepatic', title: 'Leberfunktion' },
  { key: 'allergens', title: 'Hilfsstoffe/Allergene' },
];

function normalizeArray(value) {
  if (Array.isArray(value)) return value.map((v) => String(v || '').trim()).filter(Boolean);
  if (!value) return [];
  if (typeof value === 'string') {
    // Heuristic: many fields are "a, b, c" or newline-separated.
    return String(value)
      .split(/\n|,|;|·/g)
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [String(value).trim()].filter(Boolean);
}

function cleanText(value) {
  return String(value || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function chunkParagraphs(text, { maxChars = 650, maxChunks = 4 } = {}) {
  const t = cleanText(text);
  if (!t) return [];
  const paras = t
    .split(/\n{2,}/g)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks = [];
  for (const para of paras) {
    if (chunks.length >= maxChunks) break;
    if (para.length <= maxChars) {
      chunks.push(para);
      continue;
    }
    // Hard cut for very long paragraphs
    chunks.push(para.slice(0, Math.max(0, maxChars - 1)) + '…');
  }
  return chunks;
}

function buildLeafletChunksForRecord(record, { maxEvidencePerItem = 6 } = {}) {
  const chunks = [];
  const no5 = record?.swissmedic_no5 ? Number(record.swissmedic_no5) : null;
  const secFallback = no5 ? sectionsRepo.get(no5) : null;

  const sectionTextOf = (key) => {
    const direct = record?.[key];
    if (direct != null && String(direct).trim()) return direct;
    const fallback = secFallback && typeof secFallback === 'object' ? secFallback[key] : null;
    return fallback || '';
  };

  const makeSourceRef = (key, idx) => {
    if (no5) return `sm:${no5}:${key}:${idx + 1}`;
    const id = record?.id != null ? Number(record.id) : 'unknown';
    return `med:${id}:${key}:${idx + 1}`;
  };

  for (const spec of SECTION_SPECS) {
    if (chunks.length >= maxEvidencePerItem) break;
    const raw = sectionTextOf(spec.key);
    if (!raw || !String(raw).trim()) continue;
    const parts = chunkParagraphs(raw, { maxChars: 650, maxChunks: Math.max(1, Math.min(4, maxEvidencePerItem)) });
    for (let i = 0; i < parts.length && chunks.length < maxEvidencePerItem; i++) {
      chunks.push({
        section: spec.key,
        title: spec.title,
        text: parts[i],
        sourceRef: makeSourceRef(spec.key, i),
      });
    }
  }
  return chunks;
}

async function retrieveMedsContext({
  question,
  selectedId,
  maxItems = 8,
  maxEvidencePerItem = 6,
  store = jsonStore,
} = {}) {
  const q = String(question || '').trim();
  const limit = Math.max(1, Math.min(12, Number(maxItems || 8)));
  const maxEv = Math.max(1, Math.min(12, Number(maxEvidencePerItem || 6)));

  const results = [];
  const seen = new Set();

  const pushRec = (rec) => {
    if (!rec || rec.id == null) return;
    const id = Number(rec.id);
    if (!Number.isFinite(id) || seen.has(id)) return;
    seen.add(id);
    results.push(rec);
  };

  if (selectedId != null && selectedId !== '') {
    const sel = store.getById(Number(selectedId));
    if (sel) pushRec(sel);
  }

  if (q) {
    const hits = store.search(q, { limit: limit * 2 }) || [];
    for (const rec of hits) {
      if (results.length >= limit) break;
      pushRec(rec);
    }
  }

  const items = results.slice(0, limit).map((rec) => ({
    prepId: Number(rec.id),
    brandName: rec.name || null,
    ingredients: normalizeArray(rec.active_substances),
    forms: normalizeArray(rec.forms),
    atc: rec.atc_code || null,
    rxStatus: rec.approved_status || null,
    excipients: null,
    leafletChunks: buildLeafletChunksForRecord(rec, { maxEvidencePerItem: maxEv }),
  }));

  return {
    items,
    meta: {
      q,
      selectedId: selectedId != null ? Number(selectedId) : null,
      maxItems: limit,
      maxEvidencePerItem: maxEv,
      store: typeof store.info === 'function' ? store.info() : null,
      sections: typeof sectionsRepo.info === 'function' ? sectionsRepo.info() : null,
    },
  };
}

module.exports = { retrieveMedsContext };
