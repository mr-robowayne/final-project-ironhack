'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const sectionsRepo = require('../sectionsRepo');

// Simple in-memory indices with optional JSON cache on disk
const CACHE_DIR = path.join(process.cwd(), 'dhpatientsync_20251007_144615', 'data', 'cache');
const DEFAULT_PATH = process.env.MEDS_JSONL_PATH || '/app/data/medications_full_knowledge.jsonl.gz';

// Canonical synonyms and CH brand mapping
const CANON_SYNONYMS = new Map([
  ['paracetamol', 'paracetamol'],
  ['acetaminophen', 'paracetamol'],
  ['acetaminophenum', 'paracetamol'],
  ['acetyl-p-aminophenol', 'paracetamol'],
  ['panadol', 'paracetamol'],
  ['panadol extra', 'paracetamol caffeine'],
  ['ibuprofen', 'ibuprofen'],
  ['ibuprofenum', 'ibuprofen'],
  ['ibuprofen lysin', 'ibuprofen'],
  ['ibuprofen lysinat', 'ibuprofen'],
  ['ibuprofen lysine', 'ibuprofen'],
  ['ibuprofen-lysin', 'ibuprofen'],
  ['ibuprofen-lysine', 'ibuprofen'],
  ['ibuprofen-lysinat', 'ibuprofen'],
  ['ibuprofen lysinsalz', 'ibuprofen'],
  ['diclofenac', 'diclofenac'],
  ['voltaren', 'diclofenac'],
  ['mefenaminsaeure', 'mefenaminsaeure'],
  ['mefenaminsäure', 'mefenaminsaeure'],
  ['amoxicillin', 'amoxicillin'],
  ['amoxicillinum', 'amoxicillin'],
  ['metformin', 'metformin'],
  ['metforminum', 'metformin'],
  ['warfarin', 'warfarin'],
  ['coumadin', 'warfarin'],
  ['marcoumar', 'phenprocoumon'],
  ['phenprocoumon', 'phenprocoumon'],
  ['clarithromycin', 'clarithromycin'],
  ['clarithromycinum', 'clarithromycin'],
  ['klacid', 'clarithromycin'],
  ['pantoprazol', 'pantoprazol'],
  ['omeprazol', 'omeprazol'],
  ['vitamin d3', 'cholecalciferol'],
  ['vitamin d', 'cholecalciferol'],
  ['colecalciferol', 'cholecalciferol'],
  ['cholecalciferol', 'cholecalciferol'],
  ['calciferol', 'cholecalciferol'],
  ['chlorhexidin', 'chlorhexidin'],
  ['chlorhexidine', 'chlorhexidin'],
  ['voltaren emulgel', 'diclofenac'],
  ['loratadin', 'loratadin'],
  ['loratadine', 'loratadin'],
  // Antidepressants / hypnotics (for comparisons)
  ['escitalopram', 'escitalopram'],
  ['cipralex', 'escitalopram'],
  ['zolpidem', 'zolpidem'],
  ['ambien', 'zolpidem'],
  ['stilnox', 'zolpidem'],
  ['zopiclon', 'zopiclon'],
  ['zopiclone', 'zopiclon'],
  ['imovane', 'zopiclon'],
  // CH brands to actives
  ['dafalgan', 'paracetamol'],
  ['algifor', 'ibuprofen'],
  ['nurofen', 'ibuprofen'],
  ['brufen', 'ibuprofen'],
  ['irfen', 'ibuprofen'],
  ['spedifen', 'ibuprofen'],
  ['optifen', 'ibuprofen'],
  ['voltfast', 'diclofenac'],
  ['ponstan', 'mefenaminsaeure'],
  ['naproxen', 'naproxen'],
  ['aleve', 'naproxen'],
  // ASS / Aspirin mapping
  ['ass', 'acetylsalicylsaeure'],
  ['aspirin', 'acetylsalicylsaeure'],
  ['acetylsalicylsäure', 'acetylsalicylsaeure'],
  ['acetylsalicylsaeure', 'acetylsalicylsaeure'],
]);

// Additional brand→INN and INN equivalences (lightweight)
const BRAND2INN = {
  'voltaren':'diclofenac','panadol':'paracetamol','dafalgan':'paracetamol',
  'algifor':'ibuprofen','brufen':'ibuprofen','irfen':'ibuprofen','nurofen':'ibuprofen'
};
const INN_EQUIV = {
  'vitamin d3':'cholecalciferol','colecalciferol':'cholecalciferol',
  'ibuprofen-lysin':'ibuprofen','ass':'acetylsalicylsaeure','aspirin':'acetylsalicylsaeure'
};
const EXCIPIENT_TOKENS = ['laktose','lactose','ethanol','alkohol','isopropanol','propylenglykol','pg','gluten','soja','erdnuss'];
// Salts canonicalization (keep ibuprofen-lysinat distinct)
const SALT_CANON = {
  'ibuprofen-lysin': 'ibuprofen-lysinat',
  'ibuprofen lysin': 'ibuprofen-lysinat',
  'ibuprofen-lysinate': 'ibuprofen-lysinat',
  'ibuprofen lysinate': 'ibuprofen-lysinat',
  'ibuprofen-lysinat': 'ibuprofen-lysinat'
};

// --- helpers: normalize + extraction ----------------------------------------
function normalizeText(s) {
  return (s || '').normalize('NFKD').replace(/\u00A0/g, ' ').trim();
}

function normalizeNameSimple(s) {
  s = normalizeText(s).toLowerCase();
  s = s.normalize('NFKD').replace(/[^\w\s+]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

// Extract actives block from fulltext (between "Wirkstoffe" and next block heading)
function extractActivesFromFulltext(fulltext) {
  const t = normalizeText(fulltext);
  // Primary: explicit "Wirkstoffe" block
  let m = t.match(/Wirkstoffe?\s+([\s\S]*?)(?:Hilfsstoffe|Darreichungsform|Zusammensetzung|Indikationen|Dosierung|Unerw\w*|Warnhinweise|Nebenwirk|\n{2,})/i);
  let blk = m ? m[1] : '';
  if (!blk) {
    // Fallback: parse from "Zusammensetzung" block (may include actives + excipients)
    const m2 = t.match(/Zusammensetz(?:ung|ung:)\s+([\s\S]*?)(?:Darreichungsform|Indikationen|Dosierung|Unerw\w*|Warnhinweise|Nebenwirk|\n{2,})/i);
    if (m2) blk = m2[1];
  }
  if (!blk) return [];
  const raw = blk
    .split(/[,;+\n]/)
    .map(s => s.replace(/\(als.*?\)/i, '').replace(/\(.*?\)/g, ''))
    .map(s => s.replace(/\bals\b.*$/i, ''))
    .map(s => s.replace(/\bmg\b.*$/i, ''))
    .map(s => s.replace(/\bµg\b.*$/i, ''))
    .map(s => normalizeText(s))
    .map(s => s.replace(/^•\s*/, ''))
    .map(s => s.trim())
    .filter(Boolean)
    // Heuristic: discard obvious excipient lines
    .filter(s => !/mannitol|cellulose|titan|e\s*1\d{2}|lactose|laktose|hypromellose|stearat|povidon|magnesium|calcium|propylenglykol|isopropanol|gelatine|farbstoff|farbe/i.test(s));
  const uniq = Array.from(new Set(raw))
    .map(s => s.replace(/\s{2,}/g, ' '))
    .filter(s => s.length >= 3 && s.length <= 60);
  return uniq;
}

function extractExcipientsFromFulltext(fulltext) {
  const t = normalizeText(fulltext);
  const m = t.match(/Hilfsstoffe?\s+([\s\S]*?)(?:Darreichungsform|Zusammensetzung|Indikationen|Dosierung|Unerw\w*|Warnhinweise|Nebenwirk|\n{2,})/i);
  return m ? m[1].trim() : '';
}

function extractFormsFromFulltext(fulltext) {
  const t = normalizeText(fulltext);
  const m = t.match(/Darreichungsform(?:en)?[\s\S]*?(?:Einheit|Indikationen|Anwendung|Dosierung|Unerw\w*|Warnhinweise|\n{2,})/i);
  if (!m) return null;
  const lines = m[0].split('\n').map(x => x.trim()).filter(Boolean);
  const forms = lines.filter(l => /(tabletten|kapseln|retard|sirup|suspens|tropfen|emulgel|gel|creme|iv|infusionsl(ö|oe)sung|lactab)/i.test(l));
  return forms.length ? forms.join(' | ') : lines.slice(0, 3).join(' ');
}

function normalize_drug_name(text) {
  const s = String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[®©™]/g, ' ')
    .replace(/[^a-z0-9+\-\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // German transliterations (ä→ae etc.)
  const translit = s
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss');
  // Strip common salt/hydrate moieties to base INN (e.g., metformin hydrochlorid -> metformin)
  const stripped = translit
    .replace(/\b(hydrochlorid|hydrochloride|hcl|chlorid|chloride)\b/g, ' ')
    .replace(/\b(natrium|sodium|kalium|potassium|magnesium|calcium)\b/g, ' ')
    .replace(/\b(hemihydrat|monohydrat|dihydrat|trihydrat|anhydrat|hydrate)\b/g, ' ')
    .replace(/\b(mesilat|maleat|phosphat|succinat|tartrat|citrat|lactat|pamoat|nitrat|nitrate|sulfat|sulphat|sulfate|sulphate|bromid|bromide)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const mapped = BRAND2INN[s] || BRAND2INN[translit] || BRAND2INN[stripped]
               || INN_EQUIV[s] || INN_EQUIV[translit] || INN_EQUIV[stripped];
  let canon = mapped || CANON_SYNONYMS.get(s) || CANON_SYNONYMS.get(translit) || CANON_SYNONYMS.get(stripped) || stripped;
  for (const k of Object.keys(SALT_CANON)) {
    if (canon.includes(k)) { canon = SALT_CANON[k]; break; }
  }
  return canon;
}

// Read JSONL(.gz) records
function read_records(jsonlOrGzPath = DEFAULT_PATH) {
  let p = jsonlOrGzPath;
  try {
    if (!fs.existsSync(p)) {
      const dev = path.join(process.cwd(), 'data', 'medications_full_knowledge.jsonl.gz');
      const devAlt = path.join(process.cwd(), 'dhpatientsync_20251007_144615', 'data', 'medications_full_knowledge.jsonl.gz');
      if (fs.existsSync(dev)) p = dev;
      else if (fs.existsSync(devAlt)) p = devAlt;
    }
  } catch {}
  const buf = fs.readFileSync(p);
  const txt = p.endsWith('.gz') ? zlib.gunzipSync(buf).toString('utf8') : buf.toString('utf8');
  const recs = [];
  let parsed = 0;
  // Try NDJSON first
  const lines = txt.split(/\r?\n/);
  for (const ln of lines) {
    const s = (ln || '').trim();
    if (!s) continue;
    try { const r = JSON.parse(s); if (r) { recs.push(r); parsed++; } } catch {}
  }
  if (parsed > 0) return recs;
  // Fallback: JSON array or wrapped records
  try {
    const maybe = JSON.parse(txt);
    const arr = Array.isArray(maybe) ? maybe : (Array.isArray(maybe?.records) ? maybe.records : null);
    if (arr && arr.length) return arr;
  } catch {}
  return recs;
}

function atc_path_list(atc) {
  const a = String(atc || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!a) return [];
  const res = [];
  // ATC hierarchy levels: 1,3,4,5,7
  const cuts = [1, 3, 4, 5, 7];
  for (const n of cuts) {
    if (a.length >= n) res.push(a.slice(0, n));
  }
  if (!res.includes(a)) res.push(a);
  return Array.from(new Set(res));
}

function build_indices(records) {
  const by_active_substance = new Map();
  const by_atc = new Map();
  const by_brand = new Map();

  const products = [];
  for (const r of records) {
    const id = r.id != null ? Number(r.id) : undefined;
    if (id == null) continue;
    const brand = String(r.name || '').trim();
    const brand_norm = normalize_drug_name(brand);
    const atc = String(r.atc_code || '').toUpperCase();
    const atc_codes = atc ? atc_path_list(atc) : [];
    const subs_raw = Array.isArray(r.active_substances) ? r.active_substances : (r.active_substances ? String(r.active_substances).split(/[;,]/) : []);
    const subs_norm = subs_raw.map(normalize_drug_name).filter(Boolean);
    const forms = Array.isArray(r.forms) ? r.forms : (r.forms ? [r.forms] : []);
    const strengths = Array.isArray(r.strengths) ? r.strengths : (r.strength ? [r.strength] : []);

    const product = {
      id,
      brand,
      brand_norm,
      Wirkstoffe: subs_norm,
      atc_codes,
      atc_full: atc || null,
      darreichungsformen: forms,
      staerken: strengths,
      firma: r.manufacturer || r.holder || null,
      indikation: r.indications || null,
      kontraindikationen: r.contraindications || null,
      warnhinweise: r.warnings || null,
      pregnant_category: r.pregnancy_category || null,
      renal_adjustment: r.renal || r.renal_adjustment || null,
      source_doc_ref: r.leaflet_ref || null,
      // Keep original reference to render passages
      _raw: r,
    };
    // Enrich missing fields from section repo (packungsbeilage) if available
    if (r.swissmedic_no5 != null) {
      const sec = sectionsRepo.get(r.swissmedic_no5);
      if (sec && typeof sec === 'object') {
        const mergeIfEmpty = (k) => { if (!r[k]) r[k] = sec[k]; };
        ['indications','dosage','contraindications','warnings','interactions','pregnancy','renal','storage','excipients','allergens','pharmacokinetics','pharmacodynamics','mechanism','forms'].forEach(mergeIfEmpty);
      }
      // Provide local leaflet ref if available on disk
      try {
        const p1 = path.join(process.cwd(), 'data', 'leaflets', `${r.swissmedic_no5}.html`);
        const p2 = path.join(process.cwd(), 'dhpatientsync_20251007_144615', 'data', 'leaflets', `${r.swissmedic_no5}.html`);
        if (r.leaflet_ref == null && (require('fs').existsSync(p1) || require('fs').existsSync(p2))) {
          r.leaflet_ref = `/leaflets/${r.swissmedic_no5}.html`;
        }
      } catch {}
    }
    // Enrich: excipients index + entities_norm + salt detection
    // Fallback extractions from fulltext when fields are missing
    if ((!Array.isArray(r.active_substances) || r.active_substances.length === 0) && r.fulltext) {
      const act = extractActivesFromFulltext(r.fulltext);
      if (Array.isArray(act) && act.length) {
        r.active_substances = act;
        product.Wirkstoffe = act.map(normalize_drug_name).filter(Boolean);
      }
    }
    if (!r.excipients && r.fulltext) {
      r.excipients = extractExcipientsFromFulltext(r.fulltext);
    }
    if ((!Array.isArray(product.darreichungsformen) || product.darreichungsformen.length === 0) && r.fulltext) {
      const formsTxt = extractFormsFromFulltext(r.fulltext);
      if (formsTxt) {
        const arr = formsTxt.split(/\s*\|\s*|,|\n/).map(s=>s.trim()).filter(Boolean);
        product.darreichungsformen = arr;
      }
    }
    const excTxt = String(r.excipients || '').toLowerCase().normalize('NFKD').replace(/[^\w\s]/g,' ');
    product.excipients_norm = EXCIPIENT_TOKENS.filter(t => excTxt.includes(t));
    product.exc_flags = excipientFlags(r.excipients);
    // Salt detection (ibuprofen-lysinat) via actives or fulltext composition cues
    let salt_norm = '';
    const ft = String(r.fulltext || '').toLowerCase();
    const actJoin = (Array.isArray(r.active_substances) ? r.active_substances.join(' ') : '').toLowerCase();
    if ((/\bibuprofen\b/.test(ft) || /\bibuprofen\b/.test(actJoin)) && /(lysin(at|ate)?\b|lysina?t)/.test(ft+actJoin)) {
      salt_norm = 'ibuprofen-lysinat';
    }
    product.salt_norm = salt_norm || '';
    // Entities include brand + actives + salt if present
    product.entities_norm = Array.from(new Set([brand_norm, ...(product.Wirkstoffe||[]), product.salt_norm].filter(Boolean)));
    // Also expose active_substances_norm for convenience
    product.active_substances_norm = product.Wirkstoffe;
    products.push(product);

    // by_brand
    if (!by_brand.has(brand_norm)) by_brand.set(brand_norm, []);
    by_brand.get(brand_norm).push(id);
    // by_active_substance
    for (const s of subs_norm) {
      if (!by_active_substance.has(s)) by_active_substance.set(s, []);
      by_active_substance.get(s).push(id);
    }
    // by_atc
    for (const a of atc_codes) {
      if (!by_atc.has(a)) by_atc.set(a, []);
      by_atc.get(a).push(id);
    }
  }

  // Deduplicate id arrays
  const dedup = (arr) => Array.from(new Set(arr));
  for (const m of [by_active_substance, by_atc, by_brand])
    for (const [k, v] of m.entries()) m.set(k, dedup(v));

  return { products, by_active_substance, by_atc, by_brand };
}

let CACHED = null;
function ensure_cache(jsonlPath = DEFAULT_PATH) {
  if (CACHED) return CACHED;
  const recs = read_records(jsonlPath);
  const idx = build_indices(recs);
  CACHED = idx;
  return idx;
}

function map_to_atc(wirkstoff_or_brand) {
  const { products } = ensure_cache();
  const q = normalize_drug_name(wirkstoff_or_brand);
  const seen = new Set();
  for (const p of products) {
    if (p.brand_norm === q || p.Wirkstoffe.includes(q)) {
      for (const a of p.atc_codes) seen.add(a);
    }
  }
  // Static enrichments for safety
  const STATIC = {
    ibuprofen: ['M01AE', 'M01AE01'],
    diclofenac: ['M01AB', 'M01AB05'],
    paracetamol: ['N02BE', 'N02BE01'],
    amoxicillin: ['J01CA', 'J01CA04'],
    metformin: ['A10BA', 'A10BA02'],
    warfarin: ['B01AA', 'B01AA03'],
    phenprocoumon: ['B01AA', 'B01AA04'],
    'vitamin-k-antagonisten': ['B01AA'],
    vka: ['B01AA'],
    naproxen: ['M01AE', 'M01AE02'],
    clarithromycin: ['J01FA', 'J01FA09'],
    pantoprazol: ['A02BC', 'A02BC02'],
    omeprazol: ['A02BC', 'A02BC01'],
    cholecalciferol: ['A11CC', 'A11CC05'],
    chlorhexidin: ['A01AB'],
    loratadin: ['R06AX', 'R06AX13'],
    escitalopram: ['N06AB', 'N06AB10'],
    zolpidem: ['N05CF', 'N05CF02'],
    zopiclon: ['N05CF', 'N05CF01'],
  };
  if (STATIC[q]) STATIC[q].forEach((a) => seen.add(a));
  return Array.from(seen);
}

module.exports = {
  normalize_drug_name,
  ensure_cache,
  map_to_atc,
  atc_path_list,
  // Optional: simple strong-entity extractor for router
  extract_strong_entity: function(q){
    const s = String(q||'').toLowerCase();
    const nq = normalize_drug_name(q);
    const brandOrInnHits = new Set([...Object.keys(BRAND2INN), ...Object.keys(INN_EQUIV)]);
    const exact = [...brandOrInnHits].some(h => s.includes(h));
    const atcM = s.match(/\b([A-Z][0-9A-Z]{1,6})\b/);
    const hasATC = Boolean(atcM);
    const conf = exact ? 0.95 : (hasATC ? 0.7 : (/[a-z]{5,}/.test(nq) ? 0.5 : 0.3));
    return { confidence: conf };
  }
};
function excipientFlags(txt) {
  const t = String(txt || '').toLowerCase();
  const hasPos = /(enthält|beinhaltet).{0,40}\b(laktose|lactose)\b/.test(t);
  const hasNeg = /\b(laktosefrei|ohne\s+laktose|frei von\s+laktose)\b/.test(t);
  return { lactose_present: hasPos && !hasNeg, lactose_free: hasNeg && !hasPos };
}
