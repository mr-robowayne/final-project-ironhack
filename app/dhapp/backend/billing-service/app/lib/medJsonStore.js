'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DEFAULT_MEDS_PATH = process.env.MEDS_JSONL_PATH || '/app/data/medications_full_knowledge.jsonl.gz';
let _pathUsed = DEFAULT_MEDS_PATH;

let _loaded = false;
let _records = [];
let _byId = new Map();

const DEFAULT_FILENAMES = [
  'medications_full_knowledge.jsonl.gz',
  'medications_full_knowledge.jsonl',
  'medications_full_knowledge.json',
  'medications_demo.json',
];

function safeLoadLineJSON(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function buildCandidatePaths() {
  const candidates = [];
  const push = (value) => {
    const v = String(value || '').trim();
    if (!v) return;
    if (!candidates.includes(v)) candidates.push(v);
  };

  push(process.env.MEDS_JSONL_PATH);
  push(process.env.MEDS_JSON_PATH);
  push(DEFAULT_MEDS_PATH);

  const roots = [
    '/app/data',
    path.join(process.cwd(), 'data'),
  ];
  for (const root of roots) {
    for (const filename of DEFAULT_FILENAMES) {
      push(path.join(root, filename));
    }
  }

  return candidates;
}

function readMaybeCompressed(filePath) {
  const buf = fs.readFileSync(filePath);
  const looksGzip = filePath.endsWith('.gz') || (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b);
  if (!looksGzip) return buf.toString('utf8');
  return zlib.gunzipSync(buf).toString('utf8');
}

function normalizeRecord(rec) {
  if (!rec || typeof rec !== 'object') return null;
  if (rec.holder && !rec.manufacturer) rec.manufacturer = rec.holder;
  if (rec.id == null || Number.isNaN(Number(rec.id))) return null;
  rec.id = Number(rec.id);
  const lc = (s) => String(s || '').toLowerCase();
  rec._name = lc(rec.name);
  rec._atc = lc(rec.atc_code);
  rec._subs = lc(rec.active_substances);
  rec._inds = lc(rec.indications);
  rec._dose = lc(rec.dosage);
  rec._warn = lc(rec.warnings);
  rec._contra = lc(rec.contraindications);
  rec._preg = lc(rec.pregnancy);
  rec._se = lc(rec.side_effects);
  rec._int = lc(rec.interactions);
  rec._allerg = lc(rec.allergens);
  rec._full = lc(rec.fulltext);
  return rec;
}

function parseRecords(rawText) {
  const records = [];
  const idMap = new Map();

  const pushRec = (candidate) => {
    const rec = normalizeRecord(candidate);
    if (!rec) return;
    records.push(rec);
    idMap.set(rec.id, rec);
  };

  let parsed = 0;
  const lines = String(rawText || '').split(/\r?\n/);
  for (const ln of lines) {
    if (!ln || !ln.trim()) continue;
    const rec = safeLoadLineJSON(ln.trim());
    if (rec) {
      parsed++;
      pushRec(rec);
    }
  }

  if (parsed === 0) {
    try {
      const maybe = JSON.parse(rawText);
      const arr = Array.isArray(maybe) ? maybe : (Array.isArray(maybe?.records) ? maybe.records : null);
      if (arr && arr.length) {
        for (const rec of arr) pushRec(rec);
        parsed = arr.length;
      }
    } catch {
      // noop
    }
  }

  records.sort((a, b) => a._name.localeCompare(b._name));
  return { parsed, records, idMap };
}

function loadStoreOnce() {
  if (_loaded) return;
  _loaded = true;
  const candidates = buildCandidatePaths();
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    try {
      const txt = readMaybeCompressed(p);
      const { parsed, records, idMap } = parseRecords(txt);
      if (parsed <= 0) {
        console.warn(`[medJsonStore] Found ${p}, but no records could be parsed.`);
        continue;
      }
      _records = records;
      _byId = idMap;
      _pathUsed = p;
      console.log(`[medJsonStore] Loaded ${_records.length} records from ${p}`);
      return;
    } catch (e) {
      console.warn(`[medJsonStore] Failed to load ${p}:`, e?.message || e);
    }
  }
  _records = [];
  _byId = new Map();
  _pathUsed = DEFAULT_MEDS_PATH;
  console.warn(`[medJsonStore] No medications dataset found. Checked: ${candidates.join(', ')}`);
}

function reload() {
  _loaded = false;
  _records = [];
  _byId = new Map();
  loadStoreOnce();
}

function info() {
  loadStoreOnce();
  return { path: _pathUsed, count: _records.length };
}

function search(q, { limit = 20 } = {}) {
  loadStoreOnce();
  const L = Math.max(1, Math.min(100, Number(limit || 20)));
  const qq = String(q || '').trim().toLowerCase();
  if (!qq) return [];
  let terms = qq.split(/[^a-z0-9äöüß]+/i).filter((t) => t && t.length >= 2);
  if (!terms.length) return [];
  // Expand a few common symptom/orthography variants
  const expand = (t) => {
    const s = t;
    const out = new Set([s]);
    if (/laktos|lactos/.test(s)) ['laktose','lactose','lactos'].forEach(x=>out.add(x));
    if (/bauch/.test(s) || /magen/.test(s)) ['bauch','magen','abdomin','darm'].forEach(x=>out.add(x));
    if (/kopf/.test(s) || /migr/.test(s)) ['kopf','kopfschmerz','migräne','migraene','headache'].forEach(x=>out.add(x));
    if (/durchfall|diarr/.test(s)) ['durchfall','diarrhoe','diarrhé','diarrhea'].forEach(x=>out.add(x));
    if (/übelkeit|uebelkeit|nausea/.test(s)) ['übelkeit','uebelkeit','nausea','nausee'].forEach(x=>out.add(x));
    if (/magendarm|gi/.test(s)) ['magen','darm','gastro','gi','abdomin'].forEach(x=>out.add(x));
    return Array.from(out);
  };
  const expanded = new Set();
  for (const t of terms) expand(t).forEach(x=>expanded.add(x));
  const tlist = Array.from(expanded);
  // Score records across multiple fields
  const scoreOf = (r) => {
    let score = 0;
    for (const t of tlist) {
      if (r._name.includes(t)) score += 3;
      if (r._atc.includes(t)) score += 1;
      if (r._subs.includes(t)) score += 2;
      if (r._inds.includes(t)) score += 4;
      if (r._dose.includes(t)) score += 3;
      if (r._warn.includes(t)) score += 2;
      if (r._contra.includes(t)) score += 2;
      if (r._preg.includes(t)) score += 1;
      if (r._se.includes(t)) score += 1;
      if (r._int.includes(t)) score += 1;
      if (r._allerg.includes(t)) score += 1;
      if (r._full.includes(t)) score += 1;
    }
    return score;
  };
  const scored = [];
  for (const r of _records) {
    const s = scoreOf(r);
    if (s > 0) scored.push([s, r]);
  }
  scored.sort((a,b)=>b[0]-a[0]);
  return scored.slice(0, L).map(x=>x[1]);
}

function getById(id) {
  loadStoreOnce();
  const k = Number(id);
  return _byId.get(k) || null;
}

module.exports = { search, getById, reload, info };
