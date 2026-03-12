const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

// Normalize helpers
const normalizeKey = (key) => String(key || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
const strip = (v) => (typeof v === 'string' ? v.trim() : v);

// Extract numeric-ish codes from any cell content (best-effort for unknown column layouts).
const extractCodes = (val) => {
  if (val == null) return [];
  const text = String(val);
  const matches = text.match(/\b[0-9]{3,6}(?:\.[0-9]+)?\b/g) || [];
  return matches.map((c) => c.replace(/^0+/, '') || '0');
};

function readSheetRows(filePath, sheetName) {
  const wb = XLSX.readFile(filePath, { cellDates: true });
  const targetSheet = sheetName || wb.SheetNames[0];
  const sheet = wb.Sheets[targetSheet];
  if (!sheet) throw new Error(`Sheet ${targetSheet} not found in ${path.basename(filePath)}`);
  return XLSX.utils.sheet_to_json(sheet, { defval: null });
}

function loadLegiDataMapping(baseDir) {
  const warnings = [];
  const file = path.join(baseDir, 'LegiData_TARMED-Positionen_fuer_Besitzstand_Gesamtsystem_Publikation_Webseite_DE.xlsx');
  if (!fs.existsSync(file)) {
    warnings.push(`LegiData XLSX missing at ${file}`);
    return { mappings: new Map(), warnings };
  }
  const rows = readSheetRows(file);
  const mappings = new Map(); // tarmedCode -> Set of target codes

  rows.forEach((row, idx) => {
    const tarmedCandidates = [];
    const targetCandidates = [];
    Object.entries(row || {}).forEach(([k, v]) => {
      const nKey = normalizeKey(k);
      if (nKey.includes('tarmed') || nKey.includes('alt')) {
        tarmedCandidates.push(...extractCodes(v));
      }
      if (nKey.includes('tardoc') || nKey.includes('gesamt') || nKey.includes('pausch') || nKey.includes('neu') || nKey.includes('nachfolge')) {
        targetCandidates.push(...extractCodes(v));
      }
    });
    const tarmedCodes = [...new Set(tarmedCandidates)].filter(Boolean);
    const targetCodes = [...new Set(targetCandidates)].filter(Boolean);
    if (!tarmedCodes.length && !targetCodes.length) return;
    if (!tarmedCodes.length) {
      warnings.push(`LegiData row ${idx + 2}: no TARMED code detected`);
      return;
    }
    tarmedCodes.forEach((tc) => {
      if (!mappings.has(tc)) mappings.set(tc, new Set());
      targetCodes.forEach((tgt) => mappings.get(tc).add(tgt));
    });
  });

  return { mappings, warnings };
}

function buildTarmedHelp({ tarmedData = [], tardocCatalog = { service: [], tardoc_positions: [], pauschalen: [] }, baseDir }) {
  const tarmedIndex = tarmedData.map((item) => ({
    code: item.code,
    title: item.title || '',
    lcTitle: (item.title || '').toLowerCase(),
    lcCode: (item.code || '').toLowerCase()
  }));

  // Prepare new tariff lookup
  const tardocByCode = new Map();
  (tardocCatalog.tardoc_positions || []).forEach((p) => tardocByCode.set(String(p.code), { ...p, kind: 'tardoc' }));
  (tardocCatalog.pauschalen || []).forEach((p) => tardocByCode.set(String(p.code), { ...p, kind: 'pauschale' }));

  // LegiData mapping
  const legi = loadLegiDataMapping(baseDir);

  function findTarmedMatches(query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return [];
    const isCodeLike = /^[0-9.]+$/.test(q);
    const matches = [];
    tarmedIndex.forEach((it) => {
      if (isCodeLike) {
        if (it.lcCode.includes(q)) matches.push(it);
      } else if (it.lcTitle.includes(q) || it.lcCode.includes(q)) {
        matches.push(it);
      }
    });
    return matches.slice(0, 20);
  }

  function fallbackSearchNewCatalog(query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return [];
    const results = [];
    tardocCatalog.service.forEach((s) => {
      const text = (s.short_text || s.med_interpretation || '').toLowerCase();
      if (s.code?.toLowerCase().includes(q) || text.includes(q)) {
        const detail = tardocByCode.get(String(s.code)) || {};
        results.push({
          code: s.code,
          text: detail.text || s.short_text || '',
          kind: detail.kind || (s.type && s.type.toUpperCase().startsWith('P') ? 'pauschale' : 'tardoc'),
          rationale: 'Textsuche im neuen Katalog'
        });
      }
    });
    return results.slice(0, 20);
  }

  function mapTarmedToNewCodes(tarmedMatches) {
    const suggestions = [];
    tarmedMatches.forEach((tm) => {
      const mappedTargets = Array.from(legi.mappings.get(tm.code) || []);
      mappedTargets.forEach((code) => {
        const target = tardocByCode.get(String(code));
        suggestions.push({
          source_tarmed: { code: tm.code, title: tm.title },
          code: String(code),
          text: target?.text || target?.short_text || '',
          kind: target?.kind || 'tardoc',
          rationale: 'LegiData Besitzstand-Mapping'
        });
      });
    });
    return suggestions;
  }

  function search(query) {
    const matches = findTarmedMatches(query);
    const mapped = mapTarmedToNewCodes(matches);
    const fallback = fallbackSearchNewCatalog(query);
    // Merge mapped + fallback (dedupe by code + rationale priority)
    const seen = new Set();
    const merged = [];
    [...mapped, ...fallback].forEach((s) => {
      const key = `${s.code}::${s.kind}`;
      if (seen.has(key)) return;
      seen.add(key);
      merged.push(s);
    });
    return {
      query,
      tarmed_hits: matches.slice(0, 10).map(({ code, title }) => ({ code, title })),
      suggestions: merged.slice(0, 30),
      warnings: legi.warnings
    };
  }

  return { search, legiWarnings: legi.warnings };
}

module.exports = {
  loadLegiDataMapping,
  buildTarmedHelp
};

