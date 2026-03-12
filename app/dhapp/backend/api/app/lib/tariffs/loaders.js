const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

// Helper: normalize column headers to a stable shape.
const normalizeKey = (key) => String(key || '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '');
const strip = (v) => (typeof v === 'string' ? v.trim() : v);
const asNumber = (v) => {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const asBool = (v) => {
  if (typeof v === 'boolean') return v;
  if (v == null) return false;
  const s = String(v).trim().toLowerCase();
  return ['ja', 'yes', 'true', '1', 'y', 'x'].includes(s);
};
const getField = (row, candidates) => {
  const wanted = candidates.map(normalizeKey);
  for (const [raw, val] of Object.entries(row || {})) {
    if (wanted.includes(normalizeKey(raw))) return val;
  }
  return null;
};

const inferVersionFromName = (filePath, fallback) => {
  const name = path.basename(filePath || '');
  const m = name.match(/(\d+(?:\.\d+)?[a-z]?)/i);
  return m ? m[1] : fallback;
};

const DEFAULT_FILES = {
  lkaat: 'LKAAT_1.0c_Leistungskatalog_ambulante_Arzttarife.xlsx',
  tardoc: 'Anhang_A2_Katalog_des_TARDOC_1.4c.xlsx',
  pauschalen: 'Anhang_A1_Katalog_der_Ambulanten_Pauschalen_v1.1c.xlsx'
};

function readSheetRows(filePath, sheetName, opts = {}) {
  const wb = XLSX.readFile(filePath, { cellDates: true });
  const targetSheet = sheetName && wb.SheetNames.includes(sheetName) ? sheetName : wb.SheetNames[0];
  const sheet = wb.Sheets[targetSheet];
  if (!sheet) throw new Error(`Sheet ${targetSheet} not found in ${path.basename(filePath)}`);
  return XLSX.utils.sheet_to_json(sheet, { defval: null, ...(opts || {}) });
}

function loadLkaatServices(baseDir, warnings) {
  const file = path.join(baseDir, DEFAULT_FILES.lkaat);
  if (!fs.existsSync(file)) {
    warnings.push(`LKAAT file missing: ${file}`);
    return [];
  }
  const rows = readSheetRows(file, 'LKAAT 1.0c', { range: 3 });
  const services = [];
  rows.forEach((row, idx) => {
    const code = strip(getField(row, ['lkn', 'code', 'leistungscode', 'l_code', 'l_nr', 'lnr']));
    if (!code) {
      warnings.push(`LKAAT row ${idx + 2}: missing code`);
      return;
    }
    const type = strip(getField(row, ['typ', 'type', 'leistungstyp', 'art'])) || null;
    const master_code = strip(getField(row, ['mastercode', 'master_code'])) || null;
    const linked_code = strip(getField(row, ['linkedcode', 'linked_code', 'verweiscode'])) || null;
    const lateralitaet = strip(getField(row, ['lateralitaet', 'lateralität', 'lateral'])) || null;
    const short_text = strip(getField(row, ['kurztext', 'shorttext', 'text', 'leistungstext', 'titel', 'bezeichnung', 'beschreibung'])) || '';
    const med_interpretation = strip(getField(row, ['interpretation', 'bemerkung', 'kommentar'])) || '';

    const timeField = getField(row, ['zeit', 'zeitbezug', 'dauer', 'dauer_min', 'minuten', 'leistungsdauer']);
    const is_time_based = asBool(timeField) || (asNumber(timeField) || 0) > 0;
    const is_handlung = asBool(getField(row, ['handlung', 'intervention', 'ist_handlung']));
    const is_groupable = !asBool(getField(row, ['nicht_gruppierbar', 'no_group', 'nichtgruppierbar']));

    services.push({
      code: String(code),
      type,
      master_code,
      linked_code,
      lateralitaet,
      is_time_based,
      is_handlung,
      is_groupable,
      short_text,
      med_interpretation
    });
  });
  return services;
}

function loadTardocPositions(baseDir, warnings) {
  const file = path.join(baseDir, DEFAULT_FILES.tardoc);
  if (!fs.existsSync(file)) {
    warnings.push(`TARDOC A2 file missing: ${file}`);
    return [];
  }
  const rows = readSheetRows(file, 'Tarifpositionen', { range: 4 });
  const items = [];
  rows.forEach((row, idx) => {
    const code = strip(getField(row, ['code', 'l_code', 'l-nr', 'lnr', 'l_nr', 'l_nummer', 'tarifposition']));
    if (!code) {
      warnings.push(`TARDOC row ${idx + 2}: missing code`);
      return;
    }
    const text = strip(getField(row, ['text', 'titel', 'leistungstext', 'kurztext', 'bezeichnung', 'beschreibung'])) || '';
    const interpretation = strip(getField(row, ['interpretation', 'kommentar', 'hinweise'])) || '';
    const al_norm = asNumber(getField(row, ['al_norm', 'al', 'al_punkte', 'alpunkt', 'alp', 'al_normiert'])) || 0;
    const ipl_norm = asNumber(getField(row, ['ipl_norm', 'ipl', 'itl', 'tl', 'tl_punkte', 'tlpunkt', 'ipl_normiert'])) || 0;
    const kapitel = strip(getField(row, ['kapitel', 'chapter'])) || null;
    const sparte = strip(getField(row, ['sparte', 'sparten_code', 'sparten'])) || null;
    const qual_dignitaet = strip(getField(row, ['dignitaet', 'dignität', 'qual_dign', 'dignitat'])) || null;
    const zeit_lies = strip(getField(row, ['zeit_lies', 'lies', 'leistungseinheit_zeit'])) || null;
    const zeit_raum = strip(getField(row, ['zeit_raum', 'zeitraum'])) || null;
    const wechselzeit = strip(getField(row, ['wechselzeit'])) || null;
    const iak = strip(getField(row, ['iak', 'iak_code'])) || null;
    const rules_text = strip(getField(row, ['regeln', 'regelsatz', 'rule_text', 'regeltext'])) || '';

    items.push({
      code: String(code),
      text,
      interpretation,
      al_norm,
      ipl_norm,
      kapitel,
      sparte,
      qual_dignitaet,
      zeit_lies,
      zeit_raum,
      wechselzeit,
      iak,
      rules_text
    });
  });
  return items;
}

function loadPauschalen(baseDir, warnings) {
  const file = path.join(baseDir, DEFAULT_FILES.pauschalen);
  if (!fs.existsSync(file)) {
    warnings.push(`Pauschalen A1 file missing: ${file}`);
    return [];
  }
  const rows = readSheetRows(file, 'Tarifkatalog', { range: 4 });
  const items = [];
  rows.forEach((row, idx) => {
    const code = strip(getField(row, ['code', 'tarifposition', 'pauschale', 'leistungscode', 'leistung']));
    if (!code) {
      warnings.push(`Pauschale row ${idx + 2}: missing code`);
      return;
    }
    const text = strip(getField(row, ['text', 'titel', 'bezeichnung', 'kurztext'])) || '';
    const note = strip(getField(row, ['note', 'bemerkung', 'kommentar', 'hinweis'])) || '';
    const taxpointsRaw = asNumber(getField(row, ['taxpoints', 'taxpunkte', 'tp', 'punkte']));
    const taxpoints = Number(taxpointsRaw || 0);
    const dignitaeten = strip(getField(row, ['dignitaeten', 'dignität', 'dignitat', 'dign']) ) || '';

    // Viele Zeilen im A1-Katalog sind Kapitel-/Sektionszeilen ohne Punkte.
    // Um Rauschen in der Suche zu vermeiden, filtern wir Pauschalen ohne Text UND ohne Taxpunkte heraus.
    if ((taxpoints === 0 || Number.isNaN(taxpoints)) && !text.trim()) {
      warnings.push(`Pauschale row ${idx + 2}: skipped empty heading/code=${code}`);
      return;
    }

    items.push({ code: String(code), text, note, taxpoints, dignitaeten });
  });
  return items;
}

function loadTariffCatalog({ baseDir }) {
  const warnings = [];
  const services = loadLkaatServices(baseDir, warnings);
  const tardoc_positions = loadTardocPositions(baseDir, warnings);
  const pauschalen = loadPauschalen(baseDir, warnings);

  const versionLkaat = inferVersionFromName(path.join(baseDir, DEFAULT_FILES.lkaat), '1.0c');
  const versionTardoc = inferVersionFromName(path.join(baseDir, DEFAULT_FILES.tardoc), '1.4c');
  const versionPauschalen = inferVersionFromName(path.join(baseDir, DEFAULT_FILES.pauschalen), '1.1c');

  // Ensure every TARDOC/Pauschale code exists in the master service list.
  const byCode = new Map(services.map((s) => [s.code, s]));
  tardoc_positions.forEach((p) => {
    if (!byCode.has(p.code)) {
      byCode.set(p.code, {
        code: p.code,
        type: 'E',
        master_code: null,
        linked_code: null,
        lateralitaet: null,
        is_time_based: false,
        is_handlung: true,
        is_groupable: true,
        short_text: p.text || '',
        med_interpretation: p.interpretation || ''
      });
    }
  });
  pauschalen.forEach((p) => {
    if (!byCode.has(p.code)) {
      byCode.set(p.code, {
        code: p.code,
        type: 'P',
        master_code: null,
        linked_code: null,
        lateralitaet: null,
        is_time_based: false,
        is_handlung: true,
        is_groupable: false,
        short_text: p.text || '',
        med_interpretation: p.note || ''
      });
    }
  });

  const mergedServices = Array.from(byCode.values());

  return {
    versions: {
      lkaat: versionLkaat,
      tardoc: versionTardoc,
      pauschalen: versionPauschalen
    },
    service: mergedServices,
    tardoc_positions,
    pauschalen,
    warnings
  };
}

module.exports = {
  loadTariffCatalog
};
