// src/faelle.js
import './faelle.css';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPrescriptionBottleAlt, faTrash } from '@fortawesome/free-solid-svg-icons';
import { getTenantId } from './api';
import api from './api';

/* ============================================================================
   CONFIG & TENANT-META
============================================================================ */
// Bevorzugt Umgebungsvariable; fallback: Same-Origin /api
const API_URL   = (process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.host}/api`).replace(/\/+$/, '');
const API_BASE  = API_URL.replace(/\/api\/?$/, '');
const AUTH_HEADERS = () => {
  const tenant = getTenantId();
  return tenant
    ? { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant }
    : { 'Content-Type': 'application/json' };
};

const normalizeLawKey = (raw) => {
  const v = String(raw || '').trim().toUpperCase();
  if (!v) return '';
  if (v === 'IV') return 'IVG';
  if (v === 'MV') return 'MVG';
  if (v.includes('SELBST') || v.includes('SELF') || v === 'SEL') return 'ORG';
  return v;
};

const parsePointValue = (val) => {
  const n = Number(val);
  if (!Number.isFinite(n)) return null;
  if (!(n > 0)) return null;
  return n;
};

const resolvePointValueFromBillingSettings = ({ billingSettings, law, canton }) => {
  const key = normalizeLawKey(law);
  const pv = billingSettings?.pointValues?.[key];
  if (!pv || typeof pv !== 'object') return null;
  const c = String(canton || '').trim().toUpperCase();
  if (c && pv.byCanton && typeof pv.byCanton === 'object' && pv.byCanton[c]) {
    return parsePointValue(pv.byCanton[c]);
  }
  return parsePointValue(pv.default);
};

const DEFAULT_TENANT_META = {
  clinic: {
    name: '',
    subtitle: '',
    address: { street: '', houseNo: '', zip: '', city: '', country: 'CH' },
    contact: { phone: '', email: '', website: '' },
    gln: '',
    zsr: '',
    iban: '',
    qrIban: ''
  },
  invoice: {
    paymentTerms: '',
    bankName: '',
    bankAddress: '',
    referencePrefix: ''
  },
  recipe: {
    headerTitle: 'Rezept',
    headerSubtitle: '',
    footer: '',
    signatureLabel: '',
    signatureHint: ''
  },
  branding: {
    logo: '/assets/logo.png',
    primary: '#0F6DF6',
    accent: '#00A2FF',
    accentSoft: '#E6F1FF',
    textDark: '#1B2A4B',
    textMuted: '#4F5D7A',
    background: '#F2F6FC'
  }
};

let activeTenantMeta = createTenantMeta();

export function setActiveTenantMeta(meta) {
  activeTenantMeta = createTenantMeta(meta);
}

const tenantMeta = () => activeTenantMeta;
const clinicMeta = () => tenantMeta().clinic;
const invoiceMeta = () => tenantMeta().invoice;
const brandingMeta = () => tenantMeta().branding;
const recipeMeta = () => tenantMeta().recipe;

function createTenantMeta(meta = {}) {
  const mergedClinic = {
    ...DEFAULT_TENANT_META.clinic,
    ...(meta?.clinic || {}),
    address: {
      ...DEFAULT_TENANT_META.clinic.address,
      ...(meta?.clinic?.address || {})
    },
    contact: {
      ...DEFAULT_TENANT_META.clinic.contact,
      ...(meta?.clinic?.contact || {})
    }
  };
  const mergedInvoice = {
    ...DEFAULT_TENANT_META.invoice,
    ...(meta?.invoice || {})
  };
  const mergedBranding = {
    ...DEFAULT_TENANT_META.branding,
    ...(meta?.branding || {})
  };
  const mergedRecipe = {
    ...DEFAULT_TENANT_META.recipe,
    ...(meta?.recipe || {})
  };

  mergedClinic.name = String(mergedClinic.name || DEFAULT_TENANT_META.clinic.name);
  mergedClinic.subtitle = mergedClinic.subtitle ? String(mergedClinic.subtitle) : '';
  mergedClinic.address.street = String(mergedClinic.address.street || '');
  mergedClinic.address.houseNo = String(mergedClinic.address.houseNo || '');
  mergedClinic.address.zip = String(mergedClinic.address.zip || '');
  mergedClinic.address.city = String(mergedClinic.address.city || '');
  mergedClinic.address.country = (mergedClinic.address.country || 'CH').toUpperCase();
  mergedClinic.contact.phone = String(mergedClinic.contact.phone || '');
  mergedClinic.contact.email = String(mergedClinic.contact.email || '');
  mergedClinic.contact.website = String(mergedClinic.contact.website || '');
  mergedClinic.gln = String(mergedClinic.gln || '');
  mergedClinic.zsr = String(mergedClinic.zsr || '');
  mergedClinic.iban = sanitizeIban(mergedClinic.iban);
  mergedClinic.qrIban = sanitizeIban(mergedClinic.qrIban || mergedClinic.iban);

  mergedInvoice.paymentTerms = String(mergedInvoice.paymentTerms || DEFAULT_TENANT_META.invoice.paymentTerms);
  mergedInvoice.bankName = String(mergedInvoice.bankName || '');
  mergedInvoice.bankAddress = String(mergedInvoice.bankAddress || '');
  mergedInvoice.referencePrefix = String(mergedInvoice.referencePrefix || '');

  mergedBranding.logo = mergedBranding.logo || DEFAULT_TENANT_META.branding.logo;
  mergedBranding.primary = sanitizeColor(mergedBranding.primary, DEFAULT_TENANT_META.branding.primary);
  mergedBranding.accent = sanitizeColor(mergedBranding.accent, DEFAULT_TENANT_META.branding.accent);
  mergedBranding.accentSoft = sanitizeColor(mergedBranding.accentSoft, DEFAULT_TENANT_META.branding.accentSoft);
  mergedBranding.textDark = sanitizeColor(mergedBranding.textDark, DEFAULT_TENANT_META.branding.textDark);
  mergedBranding.textMuted = sanitizeColor(mergedBranding.textMuted, DEFAULT_TENANT_META.branding.textMuted);
  mergedBranding.background = sanitizeColor(mergedBranding.background, DEFAULT_TENANT_META.branding.background);

  mergedRecipe.headerTitle = String(mergedRecipe.headerTitle || mergedClinic.name);
  mergedRecipe.headerSubtitle = String(mergedRecipe.headerSubtitle || mergedClinic.subtitle || '');
  mergedRecipe.footer = String(mergedRecipe.footer || DEFAULT_TENANT_META.recipe.footer);
  mergedRecipe.signatureLabel = String(mergedRecipe.signatureLabel || '');
  mergedRecipe.signatureHint = String(mergedRecipe.signatureHint || '');

  return {
    clinic: mergedClinic,
    invoice: mergedInvoice,
    branding: mergedBranding,
    recipe: mergedRecipe
  };
}

function sanitizeIban(iban) {
  return (iban || '').replace(/\s+/g, '').toUpperCase();
}

function sanitizeColor(color, fallback) {
  return /^#([0-9A-Fa-f]{3}){1,2}$/.test(color || '') ? color : fallback;
}

function hexToRgb(hex, fallback = [0, 0, 0]) {
  const normalized = sanitizeColor(hex, null);
  if (!normalized) return fallback;
  let value = normalized.substring(1);
  if (value.length === 3) value = value.split('').map((c) => c + c).join('');
  const num = parseInt(value, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

const providerFromMeta = () => {
  const clinic = clinicMeta();
  return {
    organization: clinic.name,
    department: clinic.subtitle || '',
    gln: clinic.gln || '',
    zsr: clinic.zsr || '',
    address: {
      street: clinic.address.street || '',
      houseNo: clinic.address.houseNo || '',
      zip: clinic.address.zip || '',
      city: clinic.address.city || '',
      country: clinic.address.country || 'CH'
    },
    contact: {
      phone: clinic.contact.phone || '',
      email: clinic.contact.email || ''
    },
    iban: clinic.qrIban || clinic.iban || ''
  };
};

const paymentMeta = () => {
  const invoice = invoiceMeta();
  const clinic = clinicMeta();
  return {
    terms: invoice.paymentTerms || 'Zahlbar innert 30 Tagen netto.',
    bankName: invoice.bankName || '',
    bankAddress: invoice.bankAddress || '',
    referencePrefix: invoice.referencePrefix || '',
    iban: clinic.qrIban || clinic.iban || ''
  };
};

const CODE_SYSTEM = 'TARDOC';
const TARIFF_VERSION = 'TARDOC 1.4c / Pauschalen A1 1.1c / LKAAT 1.0c';
const DEFAULT_REF_FOR = (fallart) => (['KVG', 'UVG', 'IV'].includes(fallart) ? 'QRR' : 'NON');
const SYNONYM_MAP = {
  'husten': 'sprechstunde',
  'kontrolle': 'sprechstunde',
  'sprechstunde': 'sprechstunde',
  'labor': 'labor',
  'notfall': 'notfall',
  '45min konsultation': 'sprechstunde',
  '30min konsultation': 'sprechstunde'
};

const CASE_CATEGORY_OPTIONS = [
  { value: 'Ambulant', label: 'Ambulant' },
  { value: 'Stationär', label: 'Stationär' },
  { value: 'Notfall', label: 'Notfall' },
  { value: 'Unfall', label: 'Unfall (UVG)', coverage: 'UVG' },
  { value: 'Krankheit', label: 'Krankheit (KVG)' },
  { value: 'IV', label: 'IV (Invalidenversicherung)', coverage: 'IV' },
  { value: 'MV', label: 'MV (Militärversicherung)', coverage: 'MV' },
  { value: 'Selbstzahler', label: 'Selbstzahler', coverage: 'Selbstzahler' }
];
const CASE_CATEGORY_DEFAULT = CASE_CATEGORY_OPTIONS[0].value;

const calcAgePrecise = (birthdate, refDate = new Date()) => {
  if (!birthdate) return NaN;
  const b = new Date(birthdate);
  const r = new Date(refDate);
  if (Number.isNaN(b.getTime()) || Number.isNaN(r.getTime())) return NaN;
  let age = r.getFullYear() - b.getFullYear();
  const monthDiff = r.getMonth() - b.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && r.getDate() < b.getDate())) age -= 1;
  return age;
};

const isMinorPatient = (patient, refDate = new Date()) => {
  if (!patient) return false;
  const birthdate = patient.geburtsdatum || patient.birthdate || patient.birthDate || patient.birthday;
  const age = calcAgePrecise(birthdate, refDate);
  return Number.isFinite(age) && age < 18;
};

const deriveCaseCoverage = (category) => {
  const entry = CASE_CATEGORY_OPTIONS.find((opt) => opt.value === category);
  if (entry?.coverage) return entry.coverage;
  if (category === 'Unfall') return 'UVG';
  if (category === 'Selbstzahler') return 'Selbstzahler';
  return 'KVG';
};

const hasGuardianInfo = (patient) => {
  if (!patient) return false;
  const guardian = patient.guardian || {};
  const firstName = patient.guardian_first_name || guardian.first_name || '';
  const lastName = patient.guardian_last_name || guardian.last_name || '';
  const relationship = patient.guardian_relationship || guardian.relationship || '';
  const phone = patient.guardian_phone || guardian.phone || '';
  const address = guardian.address || {};
  const street = patient.guardian_adresse || address.street || '';
  const zip = patient.guardian_plz || address.zip || '';
  const city = patient.guardian_ort || address.city || '';
  return Boolean(firstName && lastName && relationship && phone && street && zip && city);
};

/* ============================================================================
   LISTEN
============================================================================ */
const fallarten = [
  { value: '', label: 'Fallart wählen…' },
  { value: 'KVG', label: 'KVG (Krankenkasse)' },
  { value: 'UVG', label: 'UVG (Unfallversicherung)' },
  { value: 'IV',  label: 'IV (Invalidenversicherung)' },
  { value: 'Selbstzahler', label: 'Selbstzahler' }
];
const zuweiser = [
  { value: '', label: 'Zuweiser wählen…' },
  { value: 'Hausarzt', label: 'Hausarzt' },
  { value: 'Selbstzuweisung', label: 'Selbstzuweisung' },
  { value: 'Spital', label: 'Spital' },
  { value: 'Anderer Arzt', label: 'Anderer Arzt' },
  { value: 'Notfall', label: 'Notfall' }
];
const unfallarten = [
  { value: '', label: 'Unfallart wählen…' },
  { value: 'Arbeitsunfall', label: 'Arbeitsunfall' },
  { value: 'Nichtberufsunfall', label: 'Nichtberufsunfall' },
  { value: 'Berufskrankheit', label: 'Berufskrankheit' }
];

/* ============================================================================
   HELPERS
============================================================================ */
const chf = (v) => new Intl.NumberFormat('de-CH', { style: 'currency', currency: 'CHF' }).format(Number(v || 0));
function extractPLZ(address, fallbackPLZ) {
  if (typeof address === 'string') {
    const m = address.match(/\b(\d{4})\b/); if (m) return m[1];
  }
  if (typeof fallbackPLZ === 'string' && /^\d{4}$/.test(fallbackPLZ)) return fallbackPLZ;
  if (typeof fallbackPLZ === 'number') return String(fallbackPLZ).padStart(4, '0');
  return '';
}
function calcTarifBetrag(item, punktwert) {
  const qty = Number(item.amount || item.quantity || 1);
  if ((item.kind || '').toLowerCase() === 'pauschale') {
    const tp = Number(item.taxpoints || item.taxpunkte || item.taxpunkte_total || 0);
    return tp * Number(punktwert || 1) * qty;
  }
  const al = Number(item.al_points || item.taxpunkte_al) || 0;
  const tl = Number(item.tl_points || item.taxpunkte_tl) || 0;
  return (al + tl) * Number(punktwert || 1) * qty;
}
function uuidLike() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0; const v = c === 'x' ? r : (r & 0x3) | 0x8; return v.toString(16);
  });
}
// Debounce
function useDebounced(value, delay = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const id = setTimeout(() => setV(value), delay); return () => clearTimeout(id); }, [value, delay]);
  return v;
}

/* ============================================================================
   SPEZIALFÄLLE TARDOC/Pauschalen
   - Zuschläge (Prozent) mit Basis-Definition
   - Null-Punkte (AL/IPL) -> Nutzer muss Taxpunkte ergänzen
   - Pathologie-Mengen (JM.*) -> Menge = Proben/Parameter
============================================================================ */
const PERCENT_SURCHARGE_DEFS = {
  'AA.30.0050': { label: 'Notfall D (25% AL)', base: 'consultation', baseType: 'al', percentAL: 25 },
  'AA.30.0070': { label: 'Notfall E (50% AL)', base: 'consultation', baseType: 'al', percentAL: 50 },
  'AA.30.0090': { label: 'Tele-Notfall F (25% AL)', base: 'consultation', baseType: 'al', percentAL: 25 },
  'AA.30.0110': { label: 'Tele-Notfall G (50% AL)', base: 'consultation', baseType: 'al', percentAL: 50 },
  'KF.10.0130': { label: 'KF Zuschlag (40% AL / 20% IPL)', base: 'chapter', chapterPrefix: 'KF.', baseType: 'al_tl_split', percentAL: 40, percentTL: 20 },
  'MK.25.0120': { label: 'Wundrandmobilisation (30% AL/IPL)', base: 'chapter', chapterPrefix: 'MK.', baseType: 'al_tl', percentAL: 30, percentTL: 30 },
  'MP.10.0020': { label: 'Kinder <7J (51% IPL)', base: 'chapter', chapterPrefix: 'MP.', baseType: 'tl', percentTL: 51 },
  'PA.00.0060': { label: 'Rezidiv-Zuschlag (30% AL/IPL)', base: 'consultation', chapterPrefix: 'PA.', extraPrefixes: ['WA.10'], baseType: 'al_tl', percentAL: 30, percentTL: 30 },
  'VA.00.0030': { label: 'Gastro-Kinder <16J (51% IPL)', base: 'chapter', chapterPrefix: 'VA.', baseType: 'tl', percentTL: 51 }
};
const PERCENT_AMBIGUOUS = new Set(['JE.00.0070', 'JE.00.0080', 'JE.00.0090', 'TG.05.0080', 'TG.05.0300', 'MP.15.0100']);

const buildSpecialDefaults = (item = {}) => {
  const code = item.code || '';
  const def = PERCENT_SURCHARGE_DEFS[code] || null;
  const percentRule = (item.special_rules || []).find((r) => r.rule === 'percentage_surcharge');
  const unitRule = (item.special_rules || []).find((r) => r.rule === 'pathology_counter');
  const basePrefixes = [];
  if (def?.chapterPrefix) basePrefixes.push(def.chapterPrefix);
  if (Array.isArray(def?.extraPrefixes)) basePrefixes.push(...def.extraPrefixes);
  const defaults = {
    auto_calc: Boolean(def) && !PERCENT_AMBIGUOUS.has(code),
    percent_al: def?.percentAL ?? percentRule?.percent ?? null,
    percent_tl: def?.percentTL ?? 0,
    base_mode: def?.base || 'consultation',
    base_type: def?.baseType || (def?.percentTL ? 'al_tl' : 'al'),
    base_prefixes: Array.from(new Set(basePrefixes)).filter(Boolean),
    manual_base_al: '',
    manual_base_tl: '',
    manual_taxpoints: '',
    manual_base_chf: '',
    al_override: '',
    tl_override: '',
    taxpoints_override: '',
    mark_unclear: PERCENT_AMBIGUOUS.has(code) || (item.special_flags || []).includes('pauschale_zero_tax'),
    unit_label: unitRule?.suggested_unit ? `Anzahl ${unitRule.suggested_unit}` : (unitRule ? 'Anzahl Proben' : ''),
    has_zero_points: (item.special_flags || []).includes('zero_al_ipl'),
    pauschale_zero_tax: (item.special_flags || []).includes('pauschale_zero_tax')
  };
  return defaults;
};

const ensureSpecialHandling = (item = {}) => {
  const defaults = buildSpecialDefaults(item);
  const existing = item.special_handling || {};
  return { ...item, special_handling: { ...defaults, ...existing } };
};

const needsSpecialHandling = (item = {}) => {
  const kind = (item.kind || '').toLowerCase();
  if (kind === 'pauschale') return false;
  const sh = item.special_handling || {};
  const pts = effectivePoints(item);
  const hasPoints = (pts.al + pts.tl + pts.taxpoints) > 0;
  if (isPercentSurcharge(item)) return true; // Zuschläge brauchen Basis/Prozent
  if (!hasPoints && (item.special_flags || []).includes('zero_al_ipl')) return true; // AL/IPL fehlen
  if (sh.unit_label) return true; // Pathologie-Mengen
  if (!hasPoints && sh.mark_unclear) return true; // unklare Fälle ohne Punkte
  return false;
};

const selectionsEqual = (a = [], b = []) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] || {};
    const y = b[i] || {};
    const keys = ['code','amount','user_hint','al_points','tl_points','taxpoints'];
    for (const k of keys) {
      if ((x[k] ?? null) !== (y[k] ?? null)) return false;
    }
    const sx = x.special_handling || {};
    const sy = y.special_handling || {};
    const shKeys = ['auto_calc','percent_al','percent_tl','base_mode','manual_base_al','manual_base_tl','al_override','tl_override','taxpoints_override'];
    for (const k of shKeys) {
      if ((sx[k] ?? null) !== (sy[k] ?? null)) return false;
    }
  }
  return true;
};

const isPercentSurcharge = (item = {}) => {
  const sh = item.special_handling || {};
  const hasRule = (item.special_rules || []).some((r) => r.rule === 'percentage_surcharge');
  const def = PERCENT_SURCHARGE_DEFS[item.code];
  if (!hasRule && !def) return false;
  if (PERCENT_AMBIGUOUS.has(item.code)) return false;
  return sh.auto_calc !== false;
};

const effectivePoints = (item = {}) => {
  const sh = item.special_handling || {};
  const qty = Number(item.amount || item.quantity || 1) || 0;
  const al = Number(sh.al_override !== '' && sh.al_override != null ? sh.al_override : (item.al_points ?? item.taxpunkte_al ?? 0)) || 0;
  const tl = Number(sh.tl_override !== '' && sh.tl_override != null ? sh.tl_override : (item.tl_points ?? item.taxpunkte_tl ?? 0)) || 0;
  const manualTp = sh.taxpoints_override;
  const tpOverride = (manualTp !== '' && manualTp != null) ? Number(manualTp) : (item.taxpoints ?? item.taxpunkte ?? null);
  const fallbackTp = Number(item.taxpoints ?? item.taxpunkte ?? 0) || 0;
  let taxpoints = Number.isFinite(tpOverride) ? Number(tpOverride) : null;
  if (!Number.isFinite(taxpoints)) {
    if (al || tl) taxpoints = al + tl;
    else if (fallbackTp) taxpoints = fallbackTp;
    else taxpoints = 0;
  }
  return { qty, al, tl, taxpoints };
};

const resolveBaseForSurcharge = (item, items) => {
  const sh = item.special_handling || {};
  const def = PERCENT_SURCHARGE_DEFS[item.code] || {};
  const mode = sh.base_mode || def.base || 'consultation';
  const explicitPrefixes = [...(sh.base_prefixes || []), def.chapterPrefix, ...(def.extraPrefixes || [])].filter(Boolean);
  const prefixes = (() => {
    const set = new Set(explicitPrefixes);
    if (mode === 'consultation') set.add('AA.'); // Konsultations-Zuschläge nur auf AA.* oder explizite Präfixe
    return Array.from(set).filter(Boolean);
  })();
  let baseAl = Number(sh.manual_base_al || 0) || 0;
  let baseTl = Number(sh.manual_base_tl || 0) || 0;
  const used = [];
  if (!(baseAl || baseTl)) {
    (items || []).forEach((other) => {
      if (!other || other.code === item.code) return;
      if (isPercentSurcharge(other)) return;
      if ((other.kind || '').toLowerCase() === 'pauschale') return;
      if (mode === 'chapter' && prefixes.length && !prefixes.some((p) => (other.code || '').startsWith(p))) return;
      if (mode === 'consultation' && prefixes.length && !prefixes.some((p) => (other.code || '').startsWith(p))) return;
      const pts = effectivePoints(other);
      baseAl += pts.al * pts.qty;
      baseTl += pts.tl * pts.qty;
      used.push(other.code);
    });
  }
  return { baseAl, baseTl, used, mode };
};

const computeLine = (item, items, punktwert) => {
  const sh = item.special_handling || {};
  const prepared = effectivePoints(item);
  const pv = Number(punktwert || 1);
  let warnings = [];
  let unclear = false;
  let auto_note = '';
  let calcAl = prepared.al;
  let calcTl = prepared.tl;
  let calcTaxpoints = prepared.taxpoints;
  let surchargeBase = null;
  let pctAL = 0;
  let pctTL = 0;

  const isPauschale = (item.kind || '').toLowerCase() === 'pauschale';

  if (isPercentSurcharge(item)) {
    const def = PERCENT_SURCHARGE_DEFS[item.code] || {};
    pctAL = Number(sh.percent_al ?? def.percentAL ?? 0) || 0;
    pctTL = Number(sh.percent_tl ?? def.percentTL ?? 0) || 0;
    surchargeBase = resolveBaseForSurcharge(item, items);
    const tpFromAl = surchargeBase.baseAl * (pctAL / 100);
    const tpFromTl = surchargeBase.baseTl * (pctTL / 100);
    calcAl = Number(tpFromAl.toFixed(4));
    calcTl = Number(tpFromTl.toFixed(4));
    calcTaxpoints = Number((calcAl + calcTl).toFixed(4));
    if (!(surchargeBase.baseAl || surchargeBase.baseTl)) {
      unclear = true;
      warnings.push('Keine Basis für Zuschlag gefunden – bitte Basis/Tarifpunkte prüfen.');
    }
    const baseTxt = surchargeBase.used?.length ? surchargeBase.used.join(', ') : (surchargeBase.baseAl || surchargeBase.baseTl ? 'manuell gesetzt' : 'keine Basis');
    auto_note = `${pctAL || pctTL}% Zuschlag (Basis ${baseTxt})`;
  }

  if (!isPauschale) {
    const hasTaxOverride = sh.taxpoints_override !== '' && sh.taxpoints_override != null;
    const hasAlOverride = sh.al_override !== '' && sh.al_override != null;
    const hasTlOverride = sh.tl_override !== '' && sh.tl_override != null;

    if (!isPercentSurcharge(item) && (calcAl || calcTl)) {
      calcTaxpoints = calcAl + calcTl;
    } else if (!isPercentSurcharge(item) && !calcTaxpoints && prepared.taxpoints) {
      calcTaxpoints = prepared.taxpoints;
    }
    // If user provides total taxpoints override (but no explicit AL/IPL overrides),
    // keep AL/IPL coherent for downstream exports (and mirror server behavior).
    if (!isPercentSurcharge(item) && hasTaxOverride && !(hasAlOverride || hasTlOverride)) {
      calcAl = calcTaxpoints;
      calcTl = 0;
    }

    if ((item.special_flags || []).includes('zero_al_ipl') && calcTaxpoints === 0) {
      warnings.push('AL/IPL = 0 – Taxpunkte eingeben.');
      unclear = true;
    }

    if (sh.mark_unclear) {
      warnings.push('Automatisierung unsicher – bitte manuell prüfen.');
      unclear = true;
    }

    const heuristics = Array.isArray(item.heuristic_rules) ? item.heuristic_rules : [];
    heuristics.forEach((h) => {
      if (h.max && Number(prepared.qty) > Number(h.max.value || 0)) {
        warnings.push(`Maximal ${h.max.value} (${h.max.scope || 'Scope unbekannt'}) empfohlen`);
      }
      if (h.nicht_kumulierbar_flag) warnings.push('Nicht kumulierbar laut Heuristik');
      if (Array.isArray(h.nicht_kumulierbar_mit) && h.nicht_kumulierbar_mit.length) {
        warnings.push(`Nicht kumulierbar mit ${h.nicht_kumulierbar_mit.join(', ')}`);
      }
    });
  } else {
    const hasZeroPauschale = (item.special_flags || []).includes('pauschale_zero_tax');
    if (hasZeroPauschale && calcTaxpoints === 0) {
      warnings.push('Pauschale ohne Taxpunkte – bitte Taxpunkte eingeben.');
      unclear = true;
    }
  }

  const amount_chf = (item.kind || '').toLowerCase() === 'pauschale'
    ? Number((calcTaxpoints * pv * prepared.qty).toFixed(2))
    : Number((calcTaxpoints * pv * prepared.qty).toFixed(2));

  return {
    line: {
      ...item,
      amount: prepared.qty,
      al_points: calcAl,
      tl_points: calcTl,
      taxpoints: calcTaxpoints,
      amount_chf,
      auto_note,
      calc_warnings: warnings,
      calc_surcharge_base: surchargeBase,
      calc_percent: { al: pctAL, tl: pctTL }
    },
    warnings,
    unclear
  };
};

const computeTarifLines = (items, punktwert) => {
  const prepared = (items || []).map((it) => ensureSpecialHandling(it));
  const lines = [];
  const warnings = [];
  const unclear = [];
  let total = 0;
  prepared.forEach((item) => {
    const res = computeLine(item, prepared, punktwert);
    lines.push(res.line);
    total += Number(res.line.amount_chf || 0);
    res.warnings.forEach((w) => warnings.push(`${item.code}: ${w}`));
    if (res.unclear) unclear.push({ code: item.code, reason: res.warnings[0] || 'Bitte manuell prüfen' });
  });
  return { lines, warnings, unclear, total: Number(total.toFixed(2)) };
};
/* ============================================================================
   QRR / SCOR
============================================================================ */
function qrrCheckDigit(numberStr) {
  const T = [0,9,4,6,8,2,7,1,3,5];
  let carry = 0;
  for (const ch of numberStr.replace(/\D/g,'')) carry = T[(carry + Number(ch)) % 10];
  const cd = (10 - carry) % 10;
  return String(cd);
}
function makeQrrReference(baseDigits) {
  const digits = baseDigits.replace(/\D/g,'');
  const body = digits.padStart(26, '0').slice(-26);
  return body + qrrCheckDigit(body);
}
function makeScorRF(base) {
  const cleaned = (base || '').toUpperCase().replace(/[^0-9A-Z]/g,'');
  const tmp = cleaned + 'RF00';
  const alnum = tmp.replace(/[A-Z]/g, ch => (ch.charCodeAt(0) - 55).toString()); // A=10 … Z=35
  let remainder = 0;
  for (const d of alnum) remainder = (remainder * 10 + Number(d)) % 97;
  const check = String(98 - remainder).padStart(2, '0');
  return `RF${check}${cleaned}`;
}

function generateQrrReference(prefixDigits, invoiceId) {
  const digits = `${prefixDigits || ''}${(invoiceId || '').replace(/\D/g, '')}`;
  const fallback = `${Date.now()}`;
  const base = (digits || fallback).replace(/\D/g, '');
  const body = base.padStart(26, '0').slice(-26);
  return makeQrrReference(body);
}

function generateScorReference(prefix, invoiceId) {
  const cleaned = `${prefix || ''}${invoiceId || ''}`.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  return makeScorRF(cleaned || `INV${Date.now()}`);
}

/* ============================================================================
   TARDOC / ambulante Pauschalen: Suche & Auswahl
============================================================================ */
function TariffSmartSelector({ selected, onAdd }) {
  const [input, setInput] = useState('');
  const debounced = useDebounced(input, 300);
  const [results, setResults] = useState([]);
  const [show, setShow] = useState(false);
  const abortRef = useRef();
  const [highlight, setHighlight] = useState(-1);
  const [filterKind, setFilterKind] = useState('all');
  const [hintOpen, setHintOpen] = useState(null);

  useEffect(() => {
    const controller = new AbortController(); abortRef.current = controller;
    const query = SYNONYM_MAP[debounced.trim().toLowerCase()] || debounced;

    (async () => {
      try {
        const res = await fetch(`${API_URL}/items?search=${encodeURIComponent(query)}`, {
          signal: controller.signal,
          headers: AUTH_HEADERS(),
          credentials: 'include'
        });
        if (!res.ok) throw new Error('Server-Fehler');
        const arr = await res.json();
        const data = Array.isArray(arr) ? arr : [];
        data.sort((a, b) => {
          const at = (a.text || a.title || '').toLowerCase();
          const bt = (b.text || b.title || '').toLowerCase();
          const byText = at.localeCompare(bt, 'de', { numeric: true });
          return byText !== 0 ? byText : a.code.localeCompare(b.code, 'de', { numeric: true });
        });
        setResults(data); setShow(true);
      } catch (e) {
        if (e.name !== 'AbortError') { console.error(e); setResults([]); setShow(false); }
      }
    })();

    return () => { controller.abort(); };
  }, [debounced]);

  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') { setShow(false); setInput(''); setResults([]); } };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, []);

  const choose = (entry) => {
    onAdd(entry);
    setHighlight(-1);
    setShow(true);
  };

  const formatPoints = (item) => {
    if ((item.kind || '').toLowerCase() === 'pauschale') return `${Number(item.taxpoints || 0).toFixed(2)} TP`;
    const al = Number(item.al_points || 0).toFixed(2);
    const tl = Number(item.tl_points || 0).toFixed(2);
    return `AL ${al} / IPL ${tl}`;
  };

  const filtered = useMemo(() => {
    if (filterKind === 'all') return results;
    const titleMatch = (r, regex) => regex.test((r.title || r.text || '').toLowerCase());
    if (filterKind === 'sprechstunde') return results.filter((r) => titleMatch(r, /sprech|konsult/));
    if (filterKind === 'labor') return results.filter((r) => titleMatch(r, /labor|analyt/));
    if (filterKind === 'notfall') return results.filter((r) => titleMatch(r, /notfall|urgent/));
    if (filterKind === 'pauschale') return results.filter((r) => (r.kind || '').toLowerCase() === 'pauschale');
    return results;
  }, [results, filterKind]);

  const handleKeyDown = (e) => {
    if (!show || !filtered.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((prev) => (prev + 1) % filtered.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((prev) => (prev - 1 + filtered.length) % filtered.length);
    } else if (e.key === 'Enter') {
      if (highlight >= 0 && filtered[highlight]) {
        e.preventDefault();
        choose(filtered[highlight]);
      }
    }
  };

  return (
    <div className="tarmed-search-pane">
      <input
        className="w-full p-3 rounded-xl border border-blue-200 focus:ring-2 focus:ring-blue-300 text-lg bg-blue-50"
        placeholder="TARDOC-/Pauschalen-Code oder Text suchen…"
        value={input}
        onChange={(e) => { setInput(e.target.value); setShow(true); setHighlight(-1); }}
        onKeyDown={handleKeyDown}
        style={{ marginBottom: 0, width: '100%' }}
        autoFocus
      />
      <div className="flex items-center gap-2 mt-2 flex-wrap">
        {['all','sprechstunde','labor','notfall','pauschale'].map((k) => (
          <button
            key={k}
            type="button"
            className={`chip ${filterKind === k ? 'chip-active' : ''}`}
            onClick={() => { setFilterKind(k); setShow(true); }}
          >
            {k === 'all' ? 'Alle' : k.charAt(0).toUpperCase() + k.slice(1)}
          </button>
        ))}
        <span className="text-xs text-gray-500 ml-auto">Enter = hinzufügen, ↑↓ = Auswahl</span>
      </div>
      {show && results.length > 0 && (
        <>
          <button className="tarmed-search-close-btn" onClick={() => { setShow(false); setInput(''); setResults([]); }} title="Liste schließen" type="button">×</button>
          <div className="tarmed-card-grid">
            {filtered.map((item, idx) => {
              const hint = item.rules_text || item.note || '';
              const isHintOpen = hintOpen === item.code;
              return (
              <div
                key={item.code}
                className={`tarmed-card ${highlight === idx ? 'card-highlight' : ''}`}
                onClick={() => choose(item)}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/json', JSON.stringify(item));
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                title="Ziehen zum Korb oder klicken/Enter zum Hinzufügen"
              >
                <div className="card-body" style={{ alignItems: 'flex-start', gap: 6 }}>
                  <div className="card-title" style={{ fontSize: '1.05rem', fontWeight: 700 }}>{item.title || item.text}</div>
                  <div className="card-meta" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span className="font-mono font-bold text-blue-800">{item.code}</span>
                    <span className="badge">{(item.kind || '').toUpperCase()}</span>
                    <span style={{ color: '#475569' }}>{formatPoints(item)}</span>
                  </div>
                  {hint ? (
                    <div style={{ marginTop: 6 }}>
                      <button
                        type="button"
                        className="tarmed-add-btn"
                        style={{ padding: '4px 8px', fontSize: 12 }}
                        onClick={(e) => { e.stopPropagation(); setHintOpen(isHintOpen ? null : item.code); }}
                      >
                        {isHintOpen ? 'Hinweis ausblenden' : 'Hinweis anzeigen'}
                      </button>
                      {isHintOpen && (
                        <div style={{ marginTop: 6, fontSize: 12, color: '#334155', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 8 }}>
                          {hint}
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
                <button className="tarmed-add-btn w-full" type="button" onClick={(e) => { e.stopPropagation(); choose(item); }}>Hinzufügen</button>
              </div>
            );})}
          </div>
        </>
      )}
    </div>
  );
}

function SpecialHandlingEditor({ item, lineCalc, onChange }) {
  const sh = item.special_handling || {};
  const isPct = isPercentSurcharge(item);
  const hasZero = (item.special_flags || []).includes('zero_al_ipl');
  const hasZeroPauschale = (item.special_flags || []).includes('pauschale_zero_tax');
  const unitLabel = sh.unit_label || '';
  const heuristics = Array.isArray(item.heuristic_rules) ? item.heuristic_rules : [];
  return (
    <div className="mt-3 p-2 rounded-lg border border-blue-100 bg-white" style={{ fontSize: 12 }}>
      {isPct && (
        <div style={{ marginBottom: 8 }}>
          <div className="font-semibold text-blue-800 mb-1">Zuschlags-Logik</div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={sh.auto_calc !== false} onChange={(e) => onChange({ auto_calc: e.target.checked })} />
            Automatisch berechnen
          </label>
          <div className="flex gap-2 mt-1">
            <input type="number" step="0.1" min="0" className="border rounded px-2 py-1 w-24" value={sh.percent_al ?? ''} onChange={(e) => onChange({ percent_al: e.target.value })} placeholder="% auf AL" />
            <input type="number" step="0.1" min="0" className="border rounded px-2 py-1 w-24" value={sh.percent_tl ?? ''} onChange={(e) => onChange({ percent_tl: e.target.value })} placeholder="% auf IPL" />
          </div>
          <div className="flex gap-2 mt-2 items-center">
            <label style={{ minWidth: 80 }}>Basis:</label>
            <select className="border rounded px-2 py-1" value={sh.base_mode || 'consultation'} onChange={(e) => onChange({ base_mode: e.target.value })}>
              <option value="consultation">Summe Konsultation</option>
              <option value="chapter">Nur Kapitel/Prefix</option>
              <option value="manual">Manuell (Basis-Punkte)</option>
            </select>
          </div>
          {sh.base_mode === 'manual' && (
            <div className="flex gap-2 mt-2">
              <input type="number" step="0.01" className="border rounded px-2 py-1 w-32" value={sh.manual_base_al} onChange={(e) => onChange({ manual_base_al: e.target.value })} placeholder="Basis AL-Punkte" />
              <input type="number" step="0.01" className="border rounded px-2 py-1 w-32" value={sh.manual_base_tl} onChange={(e) => onChange({ manual_base_tl: e.target.value })} placeholder="Basis IPL-Punkte" />
            </div>
          )}
          {lineCalc?.calc_surcharge_base && (
            <div className="text-xs text-slate-600 mt-2">
              Basis aktuell: AL {Number(lineCalc.calc_surcharge_base.baseAl || 0).toFixed(2)} / IPL {Number(lineCalc.calc_surcharge_base.baseTl || 0).toFixed(2)}
              {lineCalc.calc_surcharge_base.used?.length ? ` · verwendet: ${lineCalc.calc_surcharge_base.used.join(', ')}` : ''}
            </div>
          )}
        </div>
      )}

      {(hasZero || hasZeroPauschale) && (
        <div style={{ marginBottom: 8 }}>
          <div className="font-semibold text-blue-800 mb-1">Taxpunkte ergänzen</div>
          <div className="flex gap-2 flex-wrap">
            <input type="number" step="0.01" className="border rounded px-2 py-1 w-24" value={sh.al_override} onChange={(e) => onChange({ al_override: e.target.value })} placeholder="AL" />
            <input type="number" step="0.01" className="border rounded px-2 py-1 w-24" value={sh.tl_override} onChange={(e) => onChange({ tl_override: e.target.value })} placeholder="IPL" />
            <input type="number" step="0.01" className="border rounded px-2 py-1 w-28" value={sh.taxpoints_override} onChange={(e) => onChange({ taxpoints_override: e.target.value })} placeholder="Taxpunkte gesamt" />
          </div>
          <div className="text-xs text-slate-500 mt-1">Wenn ausgefüllt, werden diese Werte für die Berechnung genutzt.</div>
        </div>
      )}

      {unitLabel && <div className="text-amber-800 mb-2">⚠ Menge = {unitLabel}</div>}
      {heuristics.length > 0 && (
        <div className="text-slate-700">
          <div className="font-semibold text-blue-800 mb-1">Heuristische Regeln</div>
          <ul className="list-disc ml-4">
            {heuristics.map((h, idx) => {
              if (h.max) return <li key={idx}>Max. {h.max.value} ({h.max.scope || 'Scope offen'})</li>;
              if (h.nicht_kumulierbar_flag) return <li key={idx}>Nicht kumulierbar (Flag)</li>;
              return <li key={idx}>{h.hinweis || JSON.stringify(h)}</li>;
            })}
          </ul>
        </div>
      )}
      {lineCalc?.calc_warnings?.length ? (
        <div className="text-amber-800 mt-2">
          {lineCalc.calc_warnings.map((w, idx) => <div key={idx}>⚠ {w}</div>)}
        </div>
      ) : null}
    </div>
  );
}

function TariffSelectedList({ selected, onRemove, onAmountChange, onAdd, onEditHint, onSpecialChange, kanton, punktwert, punktwertSource = 'fallback' }) {
  const calcResult = useMemo(() => computeTarifLines(selected, punktwert), [selected, punktwert]);
  const calcMap = useMemo(() => {
    const m = new Map();
    (calcResult.lines || []).forEach((l) => m.set(l.code, l));
    return m;
  }, [calcResult]);

  const onAddFromDrop = (item) => {
    if (!item?.code) return;
    const existing = selected.find((x) => x.code === item.code);
    if (existing) {
      onAmountChange(item.code, Number(existing.amount || 1) + 1);
    } else if (onAdd) {
      onAdd({ ...item, amount: Number(item.amount || 1) || 1 });
    }
  };
  const [isDropping, setIsDropping] = useState(false);
  const onDropItem = (e) => {
    e.preventDefault();
    setIsDropping(false);
    try {
      const txt = e.dataTransfer.getData('application/json') || e.dataTransfer.getData('text/plain');
      if (txt) {
        const obj = JSON.parse(txt);
        if (obj?.code) {
          onAddFromDrop(obj);
          return;
        }
      }
    } catch (_) { /* ignore */ }
  };
  const [openHint, setOpenHint] = useState(null);
  return (
    <div
      className={`tarmed-selected-pane ${isDropping ? 'drop-active' : ''}`}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setIsDropping(true); }}
      onDragLeave={() => setIsDropping(false)}
      onDrop={onDropItem}
    >
      <div className="tarmed-selected-title">Ausgewählte Leistungen</div>
      {selected.length === 0 && <div style={{ color: '#666', paddingTop: 12 }}>Noch keine Positionen gewählt.</div>}
      {selected.map((item) => {
        const lineCalc = calcMap.get(item.code) || {};
        const unitLabel = item.special_handling?.unit_label || '';
        return (
          <div key={item.code} className="flex flex-col bg-blue-50 border border-blue-100 rounded-xl shadow px-3 py-2 mb-3" style={{ gap: 6 }} title={item.title || item.text || item.code}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1, fontWeight: 700 }}>{item.title || item.text}</div>
              <span className="font-mono font-bold text-blue-800">{item.code}</span>
              <span className="px-2 py-0.5 rounded-full bg-white border border-blue-200 text-blue-700 text-xs">{(item.kind || '').toUpperCase()}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="text-xs text-gray-500 font-mono">x{item.amount}{unitLabel ? ` (${unitLabel})` : ''}</span>
              <span className="text-xs text-gray-400">{chf(lineCalc.amount_chf || 0)}</span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                <button className="tarmed-add-btn" style={{ padding: '2px 8px' }} onClick={() => onAmountChange(item.code, Number(item.amount || 1) + 1)} title="Erhöhe Anzahl" type="button">+</button>
                <button className="tarmed-add-btn" style={{ padding: '2px 8px' }} onClick={() => onAmountChange(item.code, Number(item.amount || 1) - 1)} disabled={(Number(item.amount || 1)) <= 1} title="Verringere Anzahl" type="button">-</button>
                <button className="text-red-500 hover:text-red-700" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' }} onClick={() => onRemove(item.code)} title="Entfernen" type="button">×</button>
              </div>
            </div>
            {needsSpecialHandling(item) && (
              <>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button
                    type="button"
                    className="tarmed-add-btn"
                    style={{ padding: '2px 8px', fontSize: 12 }}
                    onClick={() => setOpenHint(openHint === item.code ? null : item.code)}
                  >
                    {openHint === item.code ? 'Details ausblenden' : 'Spezial-Eingaben'}
                  </button>
                  <input
                    type="text"
                    placeholder="Manuelle Angabe/Hinweis"
                    value={item.user_hint || ''}
                    onChange={(e) => onEditHint(item.code, e.target.value)}
                    style={{ flex: 1, padding: '6px 8px', borderRadius: 8, border: '1px solid #d1d5db' }}
                  />
                </div>
                {openHint === item.code && (
                  <div style={{ marginTop: 6, fontSize: 12, color: '#334155', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 8 }}>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>Katalog-Hinweis:</div>
                    <div>{item.rules_text || item.note || 'Keine Hinweise gefunden.'}</div>
                    {item.hinweis && (
                      <div style={{ marginTop: 6 }}>
                        <div style={{ fontWeight: 600 }}>Zusatz:</div>
                        <div>{item.hinweis}</div>
                      </div>
                    )}
                    <SpecialHandlingEditor item={ensureSpecialHandling(item)} lineCalc={lineCalc} onChange={(patch) => onSpecialChange(item.code, patch)} />
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}
      <hr style={{ margin: '14px 0' }} />
      {calcResult.unclear.length > 0 && (
        <div style={{ color: '#b88600', fontWeight: 600, marginBottom: 6 }}>
          ⚠️ {calcResult.unclear.length} Leistung(en) benötigen Eingabe/Prüfung
          <ul className="mt-2 ml-1 text-xs text-yellow-800">
            {calcResult.unclear.map((w, i) => <li key={i}>{w.code}: {w.reason}</li>)}
          </ul>
        </div>
      )}
      {calcResult.warnings.length > 0 && (
        <div style={{ color: '#92400e', fontWeight: 600, marginBottom: 6 }}>
          Hinweise:
          <ul className="mt-2 ml-1 text-xs text-amber-800">
            {calcResult.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}
      <div style={{ color: '#2563eb', fontSize: 15, margin: '8px 0 0 0', fontWeight: 500 }}>
        Kanton für Rechnungs-PLZ: <b>{kanton ? kanton : 'Unbekannt'}</b>{punktwert ? ` (Punktwert: ${Number(punktwert).toFixed(2)} CHF${punktwertSource === 'tenant' ? ', Quelle: Mandant' : ''})` : ''}
      </div>
      <div className="mt-4 text-blue-900 font-mono font-bold text-xl" style={{ textAlign: 'right' }}>
        Gesamt: {chf(calcResult.total)}
      </div>
    </div>
  );
}

function TariffKonsultation({ value, onChange, punktwert = 1, kanton, punktwertSource = 'fallback' }) {
  const normalizeSelection = (arr) => (arr && Array.isArray(arr) ? arr.map((it) => ensureSpecialHandling(it)) : []);
  const [selected, setSelected] = useState(normalizeSelection(value));
  useEffect(() => {
    const normalized = normalizeSelection(value);
    setSelected((prev) => selectionsEqual(prev, normalized) ? prev : normalized);
  }, [value]);

  useEffect(() => { onChange && onChange(selected); /* eslint-disable-next-line */ }, [selected]);

  const handleAdd = (item) => {
    const found = selected.find((x) => x.code === item.code);
    const amt = Number(item.amount || 1) || 1;
    if (found) setSelected(selected.map((x) => (x.code === item.code ? { ...x, amount: Number(x.amount || 1) + 1 } : x)));
    else setSelected([...selected, ensureSpecialHandling({ ...item, amount: amt, user_hint: '' })]);
  };
  const handleRemove = (code) => { setSelected(selected.filter((x) => x.code !== code)); };
  const handleAmountChange = (code, amount) => {
    const amt = Number(amount);
    if (amt < 1 || Number.isNaN(amt)) { setSelected(selected.filter((x) => x.code !== code)); return; }
    setSelected(selected.map((x) => (x.code === code ? { ...x, amount: amt } : x)));
  };
  const handleSpecialChange = (code, patch = {}) => {
    setSelected((prev) => prev.map((x) => {
      if (x.code !== code) return x;
      const normalized = ensureSpecialHandling(x);
      return { ...normalized, special_handling: { ...normalized.special_handling, ...(patch || {}) } };
    }));
  };

  return (
    <div className="tarmed-layout" style={{ marginTop: 12 }}>
      <TariffSmartSelector selected={selected} onAdd={handleAdd} />
      <TariffSelectedList
        selected={selected}
        onRemove={handleRemove}
        onAmountChange={handleAmountChange}
        onAdd={handleAdd}
        onEditHint={(code, val) => setSelected((prev) => prev.map((x) => (x.code === code ? { ...x, user_hint: val } : x)))}
        kanton={kanton}
        punktwert={punktwert}
        punktwertSource={punktwertSource}
        onSpecialChange={handleSpecialChange}
      />
    </div>
  );
}

function FallStammdaten({ falldaten, setFalldaten, selectedPatient }) {
  return (
    <div className="konsultation-box" style={{ marginBottom: 32 }}>
      <strong className="block mb-3 text-blue-800 text-lg">Falldaten</strong>
      <div className="form-row mb-2">
        <div className="form-group">
          <label>Falltyp</label>
          <select
            value={falldaten.caseCategory || CASE_CATEGORY_DEFAULT}
            onChange={(e) => setFalldaten((fd) => ({ ...fd, caseCategory: e.target.value }))}
          >
            {CASE_CATEGORY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label>Krankenkasse</label>
          <input type="text" value={selectedPatient?.krankenkasse || ''} readOnly style={{ background: '#f2f5f7', color: '#555' }} tabIndex={-1} />
        </div>
        <div className="form-group">
          <label>Versichertennummer</label>
          <input type="text" value={selectedPatient?.versichertennummer || ''} readOnly style={{ background: '#f2f5f7', color: '#555' }} tabIndex={-1} />
        </div>
      </div>
      <div className="form-row mb-2">
        <div className="form-group">
          <label>Abrechnung / Fallart</label>
          <select value={falldaten.fallart} onChange={(e) => setFalldaten((fd) => ({ ...fd, fallart: e.target.value }))} required>
            {fallarten.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
        </div>
      </div>

      <div className="form-row mb-2">
        <div className="form-group">
          <label>Einweisungsdiagnose</label>
          <input type="text" value={falldaten.diagnose} onChange={(e) => setFalldaten((fd) => ({ ...fd, diagnose: e.target.value }))} placeholder="ICD-Code oder Freitext" required />
        </div>
        <div className="form-group">
          <label>Zuweiser</label>
          <select value={falldaten.zuweiser} onChange={(e) => setFalldaten((fd) => ({ ...fd, zuweiser: e.target.value }))}>
            {zuweiser.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label>Unfall (nur bei UVG)</label>
          <select value={falldaten.unfallart} onChange={(e) => setFalldaten((fd) => ({ ...fd, unfallart: e.target.value }))} disabled={falldaten.fallart !== 'UVG'}>
            {unfallarten.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
        </div>
      </div>

      <div className="form-row mb-2">
        <div className="form-group">
          <label>Unfalldatum</label>
          <input type="date" value={falldaten.unfalldatum} onChange={(e) => setFalldaten((fd) => ({ ...fd, unfalldatum: e.target.value }))} disabled={falldaten.fallart !== 'UVG'} />
        </div>
        <div className="form-group">
          <label>Unfallnummer (SUVA)</label>
          <input type="text" value={falldaten.unfallnummer} onChange={(e) => setFalldaten((fd) => ({ ...fd, unfallnummer: e.target.value }))} disabled={falldaten.fallart !== 'UVG'} placeholder="z.B. 2024/123456" />
        </div>
        <div className="form-group">
          <label>Bemerkung</label>
          <input type="text" value={falldaten.bemerkung} onChange={(e) => setFalldaten((fd) => ({ ...fd, bemerkung: e.target.value }))} placeholder="Optional" />
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   VALIDIERUNG & CLAIM-BUILDER
============================================================================ */
function validateFall({ falldaten, fallData, empfaengerArt, andereName, andereAdresse, selectedPatient, isMinor, guardianComplete, selectedDoctor }) {
  const errors = [];
  if (!falldaten.caseCategory) errors.push('Falltyp ist erforderlich.');
  if (!falldaten.fallart) errors.push('Fallart ist erforderlich.');
  if (!falldaten.diagnose) errors.push('Diagnose ist erforderlich.');
  if (falldaten.fallart === 'UVG') {
    if (!falldaten.unfallart) errors.push('Unfallart erforderlich (UVG).');
    if (!falldaten.unfalldatum) errors.push('Unfalldatum erforderlich (UVG).');
    if (!falldaten.unfallnummer) errors.push('Unfallnummer erforderlich (UVG).');
  }
  if (!fallData.konsultationen?.length) errors.push('Mindestens eine Konsultation ist erforderlich.');
  else fallData.konsultationen.forEach((k, i) => {
    if (!k.datum) errors.push(`Konsultation ${i + 1}: Datum fehlt.`);
    if (!k.leistung) errors.push(`Konsultation ${i + 1}: Leistung fehlt.`);
    if (!k.tarifLeistungen?.length) errors.push(`Konsultation ${i + 1}: Mindestens eine TARDOC-/Pauschalen-Leistung.`);
  });
  if (empfaengerArt === 'andere') {
    if (!andereName?.trim()) errors.push('Empfängername (Andere/r) ist erforderlich.');
    if (!andereAdresse?.trim()) errors.push('Empfängeradresse (Andere/r) ist erforderlich.');
  }
  if (!selectedPatient) errors.push('Kein Patient ausgewählt.');
  if (isMinor) {
    if (!guardianComplete) errors.push('Verantwortliche Person für minderjährigen Patienten fehlt.');
    if (empfaengerArt !== 'guardian') errors.push('Empfänger muss die verantwortliche Person sein.');
  }
  const requiresDoctor = Boolean(falldaten.fallart && falldaten.fallart !== 'Selbstzahler');
  if (requiresDoctor && !selectedDoctor) errors.push('Behandelnder Arzt für TARDOC / KVG erforderlich.');
  return { ok: errors.length === 0, errors };
}

function buildSwissClaim({ falldaten, fallData, empfaengerArt, empfaengerPLZ, empfaengerKanton, empfaengerPunktwert, andereName, andereAdresse, selectedPatient, refMode, doctor, existingInvoiceId = null }) {
  const clinic = clinicMeta();
  const provider = providerFromMeta();
  const paymentInfo = paymentMeta();
  const branding = brandingMeta();

  const id = existingInvoiceId || uuidLike();
  const createdAt = new Date();
  const due = new Date(createdAt); due.setDate(due.getDate() + 30);

  const settlement = {
    canton: empfaengerKanton || '',
    point_value_chf: Number(empfaengerPunktwert || 1),
    code_system: CODE_SYSTEM,
    tariff_version: TARIFF_VERSION
  };

  const recipient = (() => {
    if (empfaengerArt === 'patient') {
      const name = [selectedPatient.vorname, selectedPatient.nachname].filter(Boolean).join(' ');
      const str = [selectedPatient.adresse, selectedPatient.hausnummer].filter(Boolean).join(' ');
      const city = [selectedPatient.plz, selectedPatient.ort].filter(Boolean).join(' ');
      return { type: 'patient', name, address: str, city, zip: selectedPatient.plz || '', country: 'CH' };
    }
    if (empfaengerArt === 'kasse') {
      const adr = selectedPatient.krankenkasse_adresse || '';
      return { type: 'insurer', name: selectedPatient.krankenkasse || '', address: adr, zip: extractPLZ(adr, ''), country: 'CH' };
    }
    if (empfaengerArt === 'guardian') {
      const guardian = selectedPatient.guardian || {};
      const name = [
        selectedPatient.guardian_first_name || guardian.first_name || '',
        selectedPatient.guardian_last_name || guardian.last_name || ''
      ].filter(Boolean).join(' ');
      const street = selectedPatient.guardian_adresse || guardian.address?.street || '';
      const houseNo = selectedPatient.guardian_hausnummer || guardian.address?.houseNo || '';
      const zip = selectedPatient.guardian_plz || guardian.address?.zip || '';
      const city = selectedPatient.guardian_ort || guardian.address?.city || '';
      const address = [street, houseNo].filter(Boolean).join(' ');
      return {
        type: 'guardian',
        name: name || 'Verantwortliche Person',
        address,
        zip,
        city,
        country: 'CH',
        phone: selectedPatient.guardian_phone || guardian.phone || '',
        relationship: selectedPatient.guardian_relationship || guardian.relationship || ''
      };
    }
    return { type: 'other', name: andereName || '', address: andereAdresse || '', zip: extractPLZ(andereAdresse, ''), country: 'CH' };
  })();

  const billing_mode = (falldaten.fallart === 'Selbstzahler') ? 'TG' : 'TP';
  const insurer = (['KVG','UVG','IV'].includes(falldaten.fallart))
    ? {
        name: selectedPatient.krankenkasse || selectedPatient.insurance_name || '',
        gln: selectedPatient.ean || selectedPatient.versicherung_ean || '',
        ean: selectedPatient.ean || selectedPatient.versicherung_ean || '',
        insured_id: selectedPatient.versichertennummer || '',
        address: selectedPatient.insurance_address || selectedPatient.krankenkasse_adresse || '',
        zip: selectedPatient.insurance_zip || '',
        city: selectedPatient.insurance_city || ''
      }
    : null;

  const services = [];
  let total = 0;
  (fallData.konsultationen || []).forEach((k) => {
    const date = k.datum;
    const calc = computeTarifLines(k.tarifLeistungen || [], settlement.point_value_chf);
    (calc.lines || []).forEach((it) => {
      const qty = Number(it.amount || it.quantity || 1);
      const kind = (it.kind || '').toLowerCase() === 'pauschale' ? 'pauschale' : 'tardoc';
      const al = Number(it.al_points ?? it.taxpunkte_al ?? 0);
      const tl = Number(it.tl_points ?? it.taxpunkte_tl ?? 0);
      const taxpoints = Number(it.taxpoints ?? it.taxpunkte ?? 0);
      const pv = Number(settlement.point_value_chf);
      const amount = Number(it.amount_chf ?? (kind === 'pauschale' ? taxpoints * pv * qty : (al + tl) * pv * qty));
      total += amount;
      services.push({
        date,
        code_system: CODE_SYSTEM,
        kind,
        code: it.code,
        text: it.title || it.text,
        al_points: al,
        tl_points: tl,
        taxpoints,
        quantity: qty,
        point_value_chf: pv,
        amount_chf: Number(amount.toFixed(2)),
        special_handling: it.special_handling || null,
        note: [k.bemerkung || '', it.user_hint || '', it.auto_note || '', it.rules_text || it.note || ''].filter(Boolean).join(' | ')
      });
    });
  });

  let payment_ref = { type: refMode || 'NON', value: '' };
  if (payment_ref.type === 'QRR') {
    const prefixDigits = (paymentInfo.referencePrefix || '').replace(/\D/g, '');
    payment_ref.value = generateQrrReference(prefixDigits, id);
  } else if (payment_ref.type === 'SCOR') {
    const prefixAlpha = (paymentInfo.referencePrefix || '').replace(/[^0-9A-Za-z]/g, '');
    payment_ref.value = generateScorReference(prefixAlpha, id);
  }

  const referenceNote = paymentInfo.referencePrefix
    ? `${paymentInfo.referencePrefix}-${id.slice(-6).toUpperCase()}`
    : `Rechnung ${id}`;

  const claim = {
    schema: 'ch.med.invoice', version: '1.0',
    invoice: {
      id, created_at: createdAt.toISOString(), due_date: due.toISOString(),
      currency: 'CHF', billing_mode, payment_terms: paymentInfo.terms,
      payment_ref,
      case: {
        type: falldaten.caseCategory || falldaten.fallart || '',
        coverage: falldaten.fallart || '',
        diagnosis: falldaten.diagnose || '',
        referrer: falldaten.zuweiser || '',
        accident: (falldaten.fallart === 'UVG') ? { type: falldaten.unfallart || '', date: falldaten.unfalldatum || '', number: falldaten.unfallnummer || '' } : null,
        remark: falldaten.bemerkung || ''
      }
    },
    provider,
    patient: {
      id: selectedPatient.id ?? null,
      first_name: selectedPatient.vorname, last_name: selectedPatient.nachname,
      gender: selectedPatient.geschlecht || selectedPatient.gender || '',
      sex: selectedPatient.treated_sex || selectedPatient.sex || selectedPatient.billing_sex || '',
      birthdate: selectedPatient.geburtsdatum || '', ahv: selectedPatient.ahv_nummer || '',
      insured_id: selectedPatient.versichertennummer || '',
      address: { street: selectedPatient.adresse || '', houseNo: selectedPatient.hausnummer || '', zip: selectedPatient.plz || '', city: selectedPatient.ort || '', country: 'CH' }
    },
    insurer,
    recipient: { type: recipient.type, name: recipient.name, address: recipient.address, zip: recipient.zip, city: recipient.city || '', country: recipient.country, canton: settlement.canton, point_value_chf: settlement.point_value_chf },
    settlement, services,
    totals: { total_chf: Number(total.toFixed(2)), vat_chf: 0, net_chf: Number(total.toFixed(2)) },
    clinicMeta: clinic,
    invoiceMeta: paymentInfo,
    branding,
    payment: {
      iban: provider.iban,
      bankName: paymentInfo.bankName,
      bankAddress: paymentInfo.bankAddress,
      referenceType: payment_ref.type,
      reference: payment_ref.value,
      amount: Number(total.toFixed(2)),
      currency: 'CHF',
      invoiceId: id,
      referenceNote
    }
  };

  if (doctor) {
    const nameParts = [
      doctor.name,
      [doctor.vorname, doctor.nachname].filter(Boolean).join(' ')
    ].filter(Boolean);
    const doctorPayload = {
      id: doctor.id ?? null,
      name: nameParts.join(' – ') || '',
      email: doctor.email || '',
      sparte: doctor.sparte || doctor.specialty || '',
      dignitaet: doctor.dignitaet || doctor.dignity || doctor.qual_dignitaet || '',
      fachrichtung: doctor.fachrichtung || '',
      active: doctor.aktiv !== false
    };
    claim.doctor = doctorPayload;
  }

  return claim;
}

/* ============================================================================
   HAUPTKOMPONENTE – CREATE & EDIT
============================================================================ */
function FallEröffnung(props) {
  const {
    tenantMeta = null,
    // Kompatibilität mit alter API
    selectedPatient: _selectedPatientFromProps,
    closepop_fall,
    closepopup_fall,
    closepopup_falle,
    // Neue Props
    mode = 'create',          // 'create' | 'edit'
    claimId = null,           // bei edit
    onClose = null,
    onSaved = null,
    isOpen = true,
    onMinimize = null,
    initialState = null
  } = props;
  useEffect(() => { setActiveTenantMeta(tenantMeta); }, [tenantMeta]);

  // Stammdaten
  const [falldaten, setFalldaten] = useState({
    fallart: '',
    diagnose: '',
    zuweiser: '',
    unfallart: '',
    unfallnummer: '',
    bemerkung: '',
    unfalldatum: '',
    caseCategory: CASE_CATEGORY_DEFAULT
  });
  const [fallData, setFallData] = useState({ konsultationen: [] });
  const [doctors, setDoctors] = useState([]);
  const [doctorLoading, setDoctorLoading] = useState(false);
  const [doctorError, setDoctorError] = useState('');
  const [selectedDoctorId, setSelectedDoctorId] = useState('');

  // Zahlung/Empfänger
  const [empfaengerArt, setEmpfaengerArt] = useState('patient');
  const [andereName, setAndereName] = useState('');
  const [andereAdresse, setAndereAdresse] = useState('');

  // Restore working state if provided
  useEffect(() => {
    if (initialState && typeof initialState === 'object') {
      if (initialState.falldaten) setFalldaten((prev) => ({ ...prev, ...initialState.falldaten }));
      if (initialState.fallData) setFallData((prev) => ({ ...prev, ...initialState.fallData }));
      if (initialState.selectedDoctorId) setSelectedDoctorId(String(initialState.selectedDoctorId));
      if (initialState.empfaengerArt) setEmpfaengerArt(initialState.empfaengerArt);
      if (initialState.andereName) setAndereName(initialState.andereName);
      if (initialState.andereAdresse) setAndereAdresse(initialState.andereAdresse);
    }
  }, [initialState]);

  const [empfaengerFehler, setEmpfaengerFehler] = useState('');

  // PLZ->Kanton/Punktwert
  const [kantonPunkte, setKantonPunkte] = useState({});
  const [plzKanton, setPlzKanton] = useState({});
  const [empfaengerPLZ, setEmpfaengerPLZ] = useState('');
  const [empfaengerKanton, setEmpfaengerKanton] = useState('');
  const [empfaengerPunktwert, setEmpfaengerPunktwert] = useState(1);
  const [punktwertSource, setPunktwertSource] = useState('fallback'); // 'tenant' | 'fallback'
  const [billingSettings, setBillingSettings] = useState(null);

  // Referenz
  const [refMode, setRefMode] = useState('NON');

  // Patient – bei Create vom Aufrufer, bei Edit aus Claim (DB-Resolve)
  const [selectedPatient, setSelectedPatient] = useState(_selectedPatientFromProps || null);
  const [existingInvoiceId, setExistingInvoiceId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [validationState, setValidationState] = useState({ status: 'idle', warnings: [], error: '', totals: null, timestamp: null });
  const [internalOpen, setInternalOpen] = useState(Boolean(isOpen));
  const patientMinor = useMemo(() => Boolean(isMinorPatient(selectedPatient)), [selectedPatient]);
  const selectedDoctor = useMemo(() => {
    if (!selectedDoctorId || !doctors.length) return null;
    return doctors.find((doc) => String(doc.id) === String(selectedDoctorId)) || null;
  }, [doctors, selectedDoctorId]);

  const closeCallbacks = useMemo(() => {
    const fns = [onClose, closepop_fall, closepopup_fall, closepopup_falle];
    return fns.filter((fn, idx) => typeof fn === 'function' && fns.indexOf(fn) === idx);
  }, [onClose, closepop_fall, closepopup_fall, closepopup_falle]);

  useEffect(() => {
    setInternalOpen(Boolean(isOpen));
  }, [isOpen]);

  const loadDoctors = useCallback(async () => {
    setDoctorLoading(true);
    setDoctorError('');
    try {
      const res = await fetch(`${API_URL}/doctors`, {
        headers: AUTH_HEADERS(),
        credentials: 'include'
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json().catch(() => []);
      const list = Array.isArray(data) ? data : [];
      setDoctors(list);
      setSelectedDoctorId((prev) => prev || (list.length ? String(list[0].id) : ''));
    } catch (err) {
      console.error('Doctors load failed:', err);
      setDoctorError('Ärzte konnten nicht geladen werden.');
    } finally {
      setDoctorLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!internalOpen) return;
    loadDoctors();
  }, [internalOpen, loadDoctors]);

  useEffect(() => {
    if (!internalOpen) return;
    (async () => {
      try {
        const { data } = await api.get('/api/settings/billing');
        setBillingSettings(data?.settings || null);
      } catch (_) {
        setBillingSettings(null);
      }
    })();
  }, [internalOpen]);

  useEffect(() => {
    if (existingInvoiceId) return;
    if (!selectedPatient) return;
    setFalldaten((prev) => {
      const category = prev.caseCategory || CASE_CATEGORY_DEFAULT;
      const desired = patientMinor
        ? (category === 'Unfall' ? 'UVG' : (category === 'Selbstzahler' ? 'Selbstzahler' : 'KVG'))
        : deriveCaseCoverage(category);
      if (prev.fallart === desired) return prev;
      return { ...prev, fallart: desired };
    });
  }, [falldaten.caseCategory, patientMinor, selectedPatient, existingInvoiceId]);

  // Auto-Validierung nach Eingaben (debounced)
  useEffect(() => {
    if (!internalOpen || saving || validating) return;
    if (!selectedPatient?.id) {
      setValidationState((prev) => ({ ...prev, status: 'idle', error: '', warnings: [], totals: null }));
      return;
    }
    const guardianComplete = hasGuardianInfo(selectedPatient);
    const basic = validateFall({
      falldaten,
      fallData,
      empfaengerArt,
      andereName,
      andereAdresse,
      selectedPatient,
      isMinor: patientMinor,
      guardianComplete,
      selectedDoctor
    });
    if (!basic.ok) {
      setValidationState((prev) => ({ ...prev, status: 'idle', error: '', warnings: [], totals: null }));
      return;
    }
    const claim = makeClaimPayload();
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      runServerValidation(claim, { throwOnError: false });
    }, 600);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [falldaten, fallData, empfaengerArt, andereName, andereAdresse, selectedPatient, empfaengerPLZ, empfaengerKanton, empfaengerPunktwert, refMode, internalOpen, saving, selectedDoctor]);

  const showToast = (message) => {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      try {
        window.dispatchEvent(new CustomEvent('app:toast', { detail: { message } }));
        return;
      } catch (err) {
        console.warn('Toast dispatch failed:', err);
      }
    }
    console.info('[toast]', message);
  };
  const handleClose = () => {
    setFeedback(null);
    setInternalOpen(false);
    closeCallbacks.forEach((fn) => {
      try { fn(); } catch (err) { console.error('Modal close handler failed:', err); }
    });
  };
  const overlayRef = useRef(null);

  // Fälle-Popup: Kein Schließen per ESC oder Overlay-Klick
  useEffect(() => {
    const onEsc = (e) => {
      // intentionally ignored to force explicit actions (Speichern/Abbrechen)
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, []);
  const handleOverlayClick = (_e) => {
    // intentionally ignored to prevent accidental close
  };

  // Stammdaten-Tabellen (Kanton/PV)
  useEffect(() => {
    fetch('./kantonPunkte.json').then(r => r.json()).then(setKantonPunkte).catch(() => {});
    fetch('./plzKanton.json').then(r => r.json()).then(setPlzKanton).catch(() => {});
  }, []);

  useEffect(() => {
    if (existingInvoiceId) return;
    if (patientMinor) {
      setEmpfaengerArt('guardian');
    } else {
      if (falldaten.fallart === 'Selbstzahler') setEmpfaengerArt('patient');
      else if (falldaten.fallart === 'KVG') setEmpfaengerArt('kasse');
      else setEmpfaengerArt('andere');
    }
    setRefMode(DEFAULT_REF_FOR(falldaten.fallart || ''));
    setAndereName('');
    setAndereAdresse('');
    setEmpfaengerFehler('');
  }, [falldaten.fallart, existingInvoiceId, patientMinor]);

  useEffect(() => {
    if (mode !== 'edit') {
      setExistingInvoiceId(null);
    }
  }, [mode]);

  useEffect(() => {
    // Kanton/Punktwert automatisch
    if (!plzKanton || !kantonPunkte) return;
    let plz = '';
    if (empfaengerArt === 'patient') {
      plz = (selectedPatient && selectedPatient.plz) || '';
      if (!plz && selectedPatient?.adresse) plz = extractPLZ(selectedPatient.adresse, '');
    } else if (empfaengerArt === 'kasse') {
      plz = selectedPatient?.krankenkasse_adresse ? extractPLZ(selectedPatient.krankenkasse_adresse, '') : '';
    } else if (empfaengerArt === 'andere') {
      plz = extractPLZ(andereAdresse, '');
    }
    const plzStr = plz ? String(plz).replace(/\s/g,'').padStart(4,'0').slice(0,4) : '';
    setEmpfaengerPLZ(plzStr);
    const canton = plzKanton[plzStr] || '';
    setEmpfaengerKanton(canton);
    const pvTenant = resolvePointValueFromBillingSettings({ billingSettings, law: falldaten.fallart, canton });
    const pvFallback = canton ? (kantonPunkte[canton] || 1) : 1;
    setEmpfaengerPunktwert(pvTenant ?? pvFallback);
    setPunktwertSource(pvTenant ? 'tenant' : 'fallback');
  }, [empfaengerArt, selectedPatient, andereAdresse, plzKanton, kantonPunkte, billingSettings, falldaten.fallart]);

  // EDIT: Claim laden und Formular füllen + >>> DB-Resolve des Patienten <<<
  useEffect(() => {
    if (mode !== 'edit' || !claimId) return;
    (async () => {
      try {
        const r = await fetch(`${API_URL}/invoices/${encodeURIComponent(claimId)}`, { headers: { ...AUTH_HEADERS() }, credentials: 'include' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const dto = await r.json();
        const claim = dto?.payload || {};

        const inv = claim.invoice || {};
        setExistingInvoiceId(inv.id || dto?.id || null);
        const c = inv.case || {};
        setFalldaten({
          fallart: c.type || '',
          diagnose: c.diagnosis || '',
          zuweiser: c.referrer || '',
          unfallart: c.accident?.type || '',
          unfallnummer: c.accident?.number || '',
          bemerkung: c.remark || '',
          unfalldatum: c.accident?.date || ''
        });
        if (inv.payment_ref?.type) {
          setRefMode(inv.payment_ref.type);
        }

        // >>> Patient aus Claim-Daten ermitteln -> in DB auflösen
        const p = claim.patient || {};
        const addrLine = [
          p.address?.street || '',
          p.address?.houseNo || '',
          p.address?.zip || '',
          p.address?.city || ''
        ].filter(Boolean).join(' ').trim();

        let resolved = null;
        try {
          const qs = new URLSearchParams({
            vorname: p.first_name || '',
            nachname: p.last_name || '',
            adresse: addrLine || '',
            versichertennummer: p.insured_id || ''
          });
          const headers = { ...AUTH_HEADERS() };
          const tenantResolveUrl = `${API_URL}/patients/resolve?${qs.toString()}`;
          const resp = await fetch(tenantResolveUrl, { headers, credentials: 'include' });
          if (resp.ok) {
            resolved = await resp.json();
          } else if (resp.status !== 404) {
            console.warn('Patient resolve via /patients/resolve fehlgeschlagen:', resp.status);
          }
        } catch (e) {
          console.warn('patient resolve fehlgeschlagen – fallback auf Claim-Daten', e);
        }

        if (resolved) {
          // Nutze echten DB-Datensatz
          setSelectedPatient(resolved);
        } else if (claim.patient) {
          // Fallback: aus Claim mappen (wie vorher)
          setSelectedPatient({
            id: p.id, // falls vorhanden
            vorname: p.first_name || '',
            nachname: p.last_name || '',
            geburtsdatum: p.birthdate || '',
            ahv_nummer: p.ahv || '',
            versichertennummer: p.insured_id || '',
            adresse: p.address?.street || '',
            hausnummer: p.address?.houseNo || '',
            plz: p.address?.zip || '',
            ort: p.address?.city || '',
            krankenkasse: claim.insurer?.name || '',
            krankenkasse_adresse: claim.insurer?.address || ''
          });
        }

        const recipient = claim.recipient || {};
        if (recipient.type === 'patient') {
          setEmpfaengerArt('patient');
        } else if (recipient.type === 'insurer') {
          setEmpfaengerArt('kasse');
        } else if (recipient.type === 'other') {
          setEmpfaengerArt('andere');
          setAndereName(recipient.name || '');
          setAndereAdresse(recipient.address || '');
        }

        // Konsultationen aus services gruppieren (FIX: taxpunkte_* korrekt setzen)
        const services = claim.services || [];
        const metaCache = {};
        const uniqueCodes = Array.from(new Set(services.map((s) => s.code).filter(Boolean)));
        for (const code of uniqueCodes) {
          try {
            const resp = await fetch(`${API_URL}/item/${encodeURIComponent(code)}`, { headers: AUTH_HEADERS(), credentials: 'include' });
            if (resp.ok) {
              metaCache[code] = await resp.json();
            }
          } catch (err) {
            console.warn('Tarif-Metadaten konnten nicht geladen werden für', code, err);
          }
        }
        const grouped = {};
        services.forEach(s => {
          const key = s.date || '';
          if (!grouped[key]) grouped[key] = [];
          const kind = (s.kind || '').toLowerCase() === 'pauschale' ? 'pauschale' : 'tardoc';
          const meta = metaCache[s.code] || {};
          grouped[key].push({
            code: s.code,
            title: s.text || meta.title || meta.text,
            kind,
            al_points: s.al_points ?? meta.al_points,
            tl_points: s.tl_points ?? meta.tl_points,
            taxpoints: s.taxpoints ?? meta.taxpoints,
            amount: s.quantity,
            special_rules: meta.special_rules || [],
            heuristic_rules: meta.heuristic_rules || [],
            special_flags: meta.special_flags || [],
            special_handling: s.special_handling || meta.special_handling || {}
          });
        });
        const kons = Object.keys(grouped).map((d) => ({
          datum: d,
          leistung: '', // bleibt frei
          bemerkung: '',
          tarifLeistungen: grouped[d]
        }));
        setFallData({ konsultationen: kons.length ? kons : [{ datum: '', leistung: '', bemerkung: '', tarifLeistungen: [] }] });
      } catch (e) {
        console.error(e);
        alert('Konnte Rechnung nicht laden.');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, claimId]);

  // UI-Helper
  const addKonsultation = () => setFallData(prev => ({ ...prev, konsultationen: [...prev.konsultationen, { datum: '', leistung: '', bemerkung: '', tarifLeistungen: [] }] }));
  const handleKonsultationChange = (idx, feld, wert) => {
    const upd = [...fallData.konsultationen]; upd[idx][feld] = wert; setFallData(prev => ({ ...prev, konsultationen: upd }));
  };

  const makeClaimPayload = () => {
    const claim = buildSwissClaim({
      falldaten,
      fallData,
      empfaengerArt,
      empfaengerPLZ,
      empfaengerKanton,
      empfaengerPunktwert,
      andereName,
      andereAdresse,
      selectedPatient,
      refMode,
      doctor: selectedDoctor,
      existingInvoiceId: mode === 'edit' ? existingInvoiceId : null
    });
    claim.patient = claim.patient || {};
    claim.patient.id = selectedPatient?.id ?? claim.patient.id ?? null;
    return claim;
  };

  const runServerValidation = async (claim, { throwOnError = true } = {}) => {
    setValidating(true);
    setValidationState((prev) => ({ ...prev, status: 'running', error: '' }));
    try {
      const r = await fetch(`${API_URL}/tardoc/validate`, {
        method: 'POST',
        headers: { ...AUTH_HEADERS() },
        credentials: 'include',
        body: JSON.stringify(claim)
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || data.ok === false) {
        const msg = data.error || `Validierung fehlgeschlagen (HTTP ${r.status})`;
        setValidationState({ status: 'error', warnings: [], error: msg, totals: null, timestamp: new Date().toISOString() });
        if (throwOnError) throw new Error(msg);
        return null;
      }
      const normalized = data.normalized || claim;
      const warnings = Array.isArray(data.warnings) ? data.warnings : (Array.isArray(normalized.warnings) ? normalized.warnings : []);
      const totals = data.totals || normalized.totals || null;
      setValidationState({ status: 'ok', warnings, error: '', totals, timestamp: new Date().toISOString() });
      return { normalized, warnings, totals };
    } catch (err) {
      const msg = err?.message || 'Validierung fehlgeschlagen.';
      setValidationState({ status: 'error', warnings: [], error: msg, totals: null, timestamp: new Date().toISOString() });
      if (throwOnError) throw err;
      return null;
    } finally {
      setValidating(false);
    }
  };

  // Submit (Create & Edit) – FIX: Speichern direkt gegen /api/faelle
  const handleFallSubmit = async (e) => {
    e.preventDefault();
    if (saving) return;

    if (empfaengerArt === 'andere' && (!andereName.trim() || !andereAdresse.trim())) {
      setEmpfaengerFehler('Bitte Empfängername und Adresse eingeben!');
      setFeedback({ type: 'error', message: 'Bitte Empfängername und Adresse eingeben.' });
      return;
    }
    if (!selectedPatient || !selectedPatient.id) {
      setFeedback({ type: 'error', message: 'Bitte einen gespeicherten Patienten auswählen.' });
      return;
    }
    if (patientMinor && empfaengerArt !== 'guardian') {
      setFeedback({ type: 'error', message: 'Rechnungsempfänger muss die verantwortliche Person sein.' });
      return;
    }

    const unresolved = [];
    (fallData.konsultationen || []).forEach((k, idx) => {
      const calc = computeTarifLines(k.tarifLeistungen || [], empfaengerPunktwert);
      (calc.unclear || []).forEach((u) => unresolved.push(`K${idx + 1} ${u.code}: ${u.reason}`));
    });
    if (unresolved.length) {
      setFeedback({ type: 'warning', message: `Spezialfälle prüfen: ${unresolved.slice(0, 4).join('; ')}` });
      // Weiter speichern, nur warnen
    }

    const guardianComplete = hasGuardianInfo(selectedPatient);
    const validation = validateFall({
      falldaten,
      fallData,
      empfaengerArt,
      andereName,
      andereAdresse,
      selectedPatient,
      isMinor: patientMinor,
      guardianComplete,
      selectedDoctor
    });
    if (!validation.ok) {
      setFeedback({ type: 'error', message: validation.errors.join(' • ') });
      return;
    }

    let claim = makeClaimPayload();

    setSaving(true);
    setFeedback(null);
    try {
      const validationRes = await runServerValidation(claim);
      if (validationRes?.normalized) {
        claim = validationRes.normalized;
      }
      claim.patient = claim.patient || {};
      claim.patient.id = selectedPatient.id;

      // POST /api/faelle (Server legt Claim ab; PDF/XML werden über GET erzeugt)
      const r = await fetch(`${API_URL}/faelle`, {
        method: 'POST',
        headers: { ...AUTH_HEADERS() },
        credentials: 'include',
        body: JSON.stringify(claim)
      });
      if (!r.ok) {
        let msg = '';
        try {
          const errJson = await r.json();
          msg = errJson?.error || errJson?.message || '';
        } catch {
          msg = await r.text().catch(() => '');
        }
        throw new Error(msg || `Fehler beim Speichern (HTTP ${r.status})`);
      }
      const saved = await r.json().catch(() => ({}));

      // Zusätzlich: Rechnung in der DB speichern + PDF erzeugen
      // Rechnung speichern + PDF erzeugen; Fehler sichtbar machen, damit Nutzer merkt wenn PDF fehlt
      const invRes = await fetch(`${API_URL}/invoices`, {
        method: 'POST',
        headers: { ...AUTH_HEADERS() },
        credentials: 'include',
        body: JSON.stringify(claim)
      });
      if (!invRes.ok) {
        let msg = '';
        try {
          const m = await invRes.json();
          msg = m?.message || '';
        } catch {
          msg = await invRes.text().catch(() => '');
        }
        throw new Error(msg || `Invoice save failed (HTTP ${invRes.status})`);
      }
      await invRes.json().catch(() => ({}));

      showToast(mode === 'edit' ? 'Fall aktualisiert.' : 'Fall gespeichert.');
      if (onSaved) onSaved(saved);
      handleClose();
    } catch (err) {
      console.error(err);
      setFeedback({ type: 'error', message: err.message || 'Speichern fehlgeschlagen.' });
    } finally {
      setSaving(false);
    }
  };

  // Löschen (nur Edit)
  const handleDelete = async () => {
    if (mode !== 'edit' || !existingInvoiceId) return;
    alert('Das Löschen von Fällen ist hier noch nicht verdrahtet.');
  };

  const renderDoctorSelector = () => (
    <div className="konsultation-box" style={{ marginBottom: 16, background: '#f8fbff', border: '1px solid #dbeafe' }}>
      <strong className="block mb-3 text-blue-800 text-lg">Behandelnder Arzt / Fachgebiet</strong>
      <div className="form-group">
        <label>Arzt</label>
        {doctorLoading ? (
          <div>Ärzte werden geladen…</div>
        ) : (
          <select value={selectedDoctorId} onChange={(e) => setSelectedDoctorId(e.target.value)}>
            <option value="">Arzt wählen…</option>
            {doctors.map((doc) => (
              <option key={doc.id} value={doc.id}>
                {(doc.name || `${doc.vorname || ''} ${doc.nachname || ''}`.trim()) || 'Arzt'}
                {doc.fachrichtung ? ` – ${doc.fachrichtung}` : ''}
              </option>
            ))}
          </select>
        )}
        {doctorError && <div className="error">{doctorError}</div>}
        {selectedDoctor && (
          <div style={{ marginTop: 8, fontSize: 13, color: '#1d4ed8' }}>
            {selectedDoctor.fachrichtung && <div><strong>Fachrichtung:</strong> {selectedDoctor.fachrichtung}</div>}
            {selectedDoctor.sparte && <div><strong>Sparte:</strong> {selectedDoctor.sparte}</div>}
            {selectedDoctor.dignitaet && <div><strong>Dignität:</strong> {selectedDoctor.dignitaet}</div>}
            {!selectedDoctor.aktiv && <div style={{ color: '#b91c1c' }}>Hinweis: Arzt ist momentan deaktiviert.</div>}
          </div>
        )}
      </div>
    </div>
  );

  // UI – Empfängerinfo Box
  function renderEmpfaengerBox() {
    if (!selectedPatient) return null;
    const guardianComplete = hasGuardianInfo(selectedPatient);
    let lines = [];
    if (empfaengerArt === 'patient') {
      const name = [selectedPatient.vorname, selectedPatient.nachname].filter(Boolean).join(' ');
      const str = [selectedPatient.adresse, selectedPatient.hausnummer].filter(Boolean).join(' ');
      const city = [selectedPatient.plz, selectedPatient.ort].filter(Boolean).join(' ');
      lines.push(<b key="name">{name}</b>);
      if (str || city) lines.push(<span key="adr" style={{ marginTop: 6, display: 'block' }}>{[str, city].filter(Boolean).join(', ')}</span>);
      if (selectedPatient.versichertennummer) lines.push(<span key="versnr" style={{ marginTop: 6, display: 'block' }}>Versichertennummer: {selectedPatient.versichertennummer}</span>);
    } else if (empfaengerArt === 'kasse') {
      lines.push(<b key="kasse">{selectedPatient.krankenkasse || 'Versicherer'}</b>);
      if (selectedPatient.krankenkasse_adresse) lines.push(<span key="kassenadr" style={{ marginTop: 6, display: 'block' }}>{selectedPatient.krankenkasse_adresse}</span>);
      if (selectedPatient.versichertennummer) lines.push(<span key="versnr" style={{ marginTop: 6, display: 'block' }}>Versichertennummer: {selectedPatient.versichertennummer}</span>);
    } else if (empfaengerArt === 'guardian') {
      const guardian = selectedPatient.guardian || {};
      const nameParts = [
        selectedPatient.guardian_relationship || guardian.relationship || '',
        [selectedPatient.guardian_first_name || guardian.first_name || '', selectedPatient.guardian_last_name || guardian.last_name || ''].filter(Boolean).join(' ')
      ].filter(Boolean);
      const guardianName = nameParts.join(' – ');
      const street = selectedPatient.guardian_adresse || guardian.address?.street || '';
      const houseNo = selectedPatient.guardian_hausnummer || guardian.address?.houseNo || '';
      const zip = selectedPatient.guardian_plz || guardian.address?.zip || '';
      const city = selectedPatient.guardian_ort || guardian.address?.city || '';
      const addressLine = [street, houseNo].filter(Boolean).join(' ');
      const cityLine = [zip, city].filter(Boolean).join(' ');
      lines.push(<b key="guardian">{guardianName || 'Verantwortliche Person'}</b>);
      if (addressLine || cityLine) lines.push(<span key="guardianadr" style={{ marginTop: 6, display: 'block' }}>{[addressLine, cityLine].filter(Boolean).join(', ')}</span>);
      const phone = selectedPatient.guardian_phone || guardian.phone;
      if (phone) lines.push(<span key="guardianphone" style={{ marginTop: 6, display: 'block' }}>Tel: {phone}</span>);
      const email = selectedPatient.guardian_email || guardian.email;
      if (email) lines.push(<span key="guardianemail" style={{ marginTop: 6, display: 'block' }}>{email}</span>);
      if (!guardianComplete) {
        lines.push(<span key="guardianerror" style={{ marginTop: 6, display: 'block', color: 'red' }}>Verantwortliche Person benötigt vollständige Kontaktdaten.</span>);
      }
    } else if (empfaengerArt === 'andere') {
      const name = andereName, adr = andereAdresse;
      lines.push(<b key="andere">{name || <span style={{ color: '#999' }}>Empfängername fehlt</span>}</b>);
      if (adr) lines.push(<span key="adr" style={{ marginTop: 6, display: 'block' }}>{adr}</span>);
    }

    return (
      <div className="rechnungsempfaenger-box" style={{ border: '1px solid #b7d7f7', background: '#e7f2fd', borderRadius: 14, padding: '16px 22px', margin: '24px 0 0 0' }}>
        <div className="text-blue-800 font-bold mb-2">Rechnungsempfänger:</div>
        <div style={{ marginBottom: 10 }}>
          <label>Empfänger:</label>{' '}
          <select value={empfaengerArt} onChange={(e) => { setEmpfaengerArt(e.target.value); setEmpfaengerFehler(''); }}>
            <option value="patient" disabled={patientMinor}>Patient</option>
            <option value="kasse" disabled={patientMinor || falldaten.fallart !== 'KVG'}>Krankenkasse</option>
            <option value="guardian" disabled={!patientMinor || !guardianComplete}>Verantwortliche Person</option>
            <option value="andere" disabled={patientMinor}>Andere/r (manuell eingeben)</option>
          </select>
        </div>
        {empfaengerArt === 'andere' && (
          <div className="flex flex-col gap-2 mb-2">
            <input type="text" className="border rounded-xl px-3 py-2" placeholder="Empfänger-Name*" value={andereName} onChange={(e) => setAndereName(e.target.value)} required />
            <input type="text" className="border rounded-xl px-3 py-2" placeholder="Empfänger-Adresse*" value={andereAdresse} onChange={(e) => setAndereAdresse(e.target.value)} required />
            {empfaengerFehler && <div style={{ color: 'red', fontWeight: 'bold' }}>{empfaengerFehler}</div>}
          </div>
        )}
        <div className="text-base flex flex-col gap-1" style={{ marginTop: 6 }}>{lines}</div>
        <div style={{ marginTop: 8, color: '#444', fontSize: 15 }}>
          <span style={{ fontWeight: 600 }}>Kanton erkannt:</span> <b>{empfaengerKanton || 'Unbekannt'}</b> {empfaengerPLZ ? `(PLZ: ${empfaengerPLZ})` : ''}
          {empfaengerPunktwert ? ` — Punktwert: ${Number(empfaengerPunktwert).toFixed(2)} CHF` : ''}
        </div>
      </div>
    );
  }

  const renderPaymentOptions = () => (
    <div className="konsultation-box" style={{ marginTop: 12 }}>
      <strong className="block mb-2 text-blue-800">Zahlungsoptionen</strong>
      <div className="form-row">
        <div className="form-group">
          <label>Referenztyp</label>
          <select value={refMode} onChange={(e) => setRefMode(e.target.value)}>
            <option value="NON">Ohne Referenz (NON)</option>
            <option value="QRR">QR-Referenz (QRR)</option>
            <option value="SCOR">Creditor Reference (SCOR)</option>
          </select>
          <small>Für QRR benötigst du eine QR-IBAN. SCOR generiert eine ISO-11649 RF-Referenz.</small>
        </div>
      </div>
    </div>
  );

  if (!internalOpen) {
    return null;
  }

  return (
    <div className="popup-overlay flex items-center justify-center min-h-screen p-4" ref={overlayRef} onMouseDown={handleOverlayClick} role="dialog" aria-modal="true">
      <div className="popup-container" style={{ width: '96vw', maxWidth: '1700px' }} onMouseDown={(e) => e.stopPropagation()}>
        <form onSubmit={handleFallSubmit}>
          {feedback && (
            <div
              className="form-feedback"
              role="alert"
              style={{
                marginBottom: '16px',
                padding: '12px 16px',
                borderRadius: '12px',
                background: feedback.type === 'error' ? '#fee2e2' : '#dcfce7',
                color: feedback.type === 'error' ? '#991b1b' : '#166534',
                border: `1px solid ${feedback.type === 'error' ? '#fecaca' : '#bbf7d0'}`
              }}
            >
              {feedback.message}
            </div>
          )}
          <h2 className="h2" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'relative' }}>
            <span style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)' }}>
              {mode === 'edit' ? 'Fall bearbeiten' : 'Fall eröffnen'}: {selectedPatient ? `${selectedPatient?.vorname || ''} ${selectedPatient?.nachname || ''}` : ''}
            </span>
            {typeof onMinimize === 'function' && (
              <button type="button" className="btn-cancel" onClick={() => onMinimize({ falldaten, fallData, empfaengerArt, andereName, andereAdresse })} title="Als Tab ablegen" style={{ background: '#e0e7ff', color: '#3730a3', borderColor: '#c7d2fe' }}>Als Tab</button>
            )}
          </h2>
          <br /><hr />

          <FallStammdaten falldaten={falldaten} setFalldaten={setFalldaten} selectedPatient={selectedPatient || {}} />
          {renderDoctorSelector()}
          {renderEmpfaengerBox()}

          <div className="section-header font-bold text-blue-600 my-3">Konsultationen im Fall (TARDOC + ambulante Pauschalen)</div>
          <div className="text-sm text-blue-800 mb-2">
            Hinweis: TARMED ist nicht mehr abrechenbar. Bitte Leistungen aus TARDOC oder den ambulanten Pauschalen wählen. Die Suche oben unterstützt beim Mapping.
          </div>
          {fallData.konsultationen.map((kons, idx) => (
            <div key={idx} className="konsultation-box mb-6">
              <strong className="block mb-2 text-blue-800">Konsultation {idx + 1}</strong>
              <div className="flex flex-wrap gap-3 mb-2">
                <input className="border rounded-xl px-3 py-2" type="date" value={kons.datum} onChange={(e) => handleKonsultationChange(idx, 'datum', e.target.value)} required />
                <input className="border rounded-xl px-3 py-2 flex-1" type="text" value={kons.leistung} onChange={(e) => handleKonsultationChange(idx, 'leistung', e.target.value)} placeholder="z. B. Kontrolle, Gespräch" required />
                <input className="border rounded-xl px-3 py-2 flex-1" type="text" value={kons.bemerkung} onChange={(e) => handleKonsultationChange(idx, 'bemerkung', e.target.value)} placeholder="Bemerkung (optional)" />
              </div>
              <TariffKonsultation value={kons.tarifLeistungen} onChange={(val) => handleKonsultationChange(idx, 'tarifLeistungen', val)} punktwert={empfaengerPunktwert} punktwertSource={punktwertSource} kanton={empfaengerKanton} />
            </div>
          ))}
          <button type="button" className="btn-add" onClick={addKonsultation}>+ Konsultation hinzufügen</button>

          {renderPaymentOptions()}

          <div className="konsultation-box" style={{ marginTop: 12, background: '#eff6ff', border: '1px solid #dbeafe' }}>
            <div className="flex items-center gap-3 mb-2">
              <strong className="text-blue-800">TARDOC-Validierung (Server)</strong>
              {validationState.status === 'running' && <span style={{ color: '#92400e' }}>Prüfe…</span>}
              {validationState.status === 'ok' && (
                <span style={{ color: '#166534', fontWeight: 600 }}>
                  ✓ gültig{validationState.warnings?.length ? ` · ${validationState.warnings.length} Hinweis(e)` : ''}
                </span>
              )}
              {validationState.status === 'idle' && <span style={{ color: '#0f172a' }}>läuft automatisch während der Eingabe</span>}
              {validationState.status === 'error' && <span style={{ color: '#991b1b', fontWeight: 600 }}>{validationState.error}</span>}
            </div>
            {validationState.totals && (
              <div style={{ fontSize: 13, color: '#0f172a' }}>
                Netto: {chf(validationState.totals.net_chf)} · Total: {chf(validationState.totals.total_chf)} · Punktwert: {Number(empfaengerPunktwert || 1).toFixed(2)} CHF
              </div>
            )}
            {validationState.warnings?.length > 0 && (
              <ul className="mt-2 text-sm text-amber-800" style={{ paddingLeft: 18 }}>
                {validationState.warnings.slice(0, 4).map((w, idx) => <li key={idx}>⚠️ {w}</li>)}
                {validationState.warnings.length > 4 && <li>… {validationState.warnings.length - 4} weitere Hinweise</li>}
              </ul>
            )}
          </div>

          <div className="form-actions flex gap-2 mt-6" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button type="submit" className="btn-save" disabled={saving}>
              {saving ? 'Speichern…' : mode === 'edit' ? 'Änderungen speichern' : 'Fall speichern'}
            </button>
            <button type="button" className="btn-cancel" onClick={handleClose} disabled={saving}>Abbrechen</button>
            {mode === 'edit' && (
              <button type="button" className="btn-cancel" style={{ background: '#fee2e2', color: '#991b1b' }} onClick={handleDelete} disabled={saving}>
                <FontAwesomeIcon icon={faTrash} /> Löschen
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

export default FallEröffnung;
