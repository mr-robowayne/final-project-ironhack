'use strict';

const sanitizeIban = (iban) => String(iban || '').replace(/\s+/g, '').toUpperCase();
const sanitizeColor = (color, fallback) => (/^#([0-9A-Fa-f]{3}){1,2}$/).test(color || '') ? color : fallback;
const asArray = (value) => {
  if (Array.isArray(value)) return value.filter(Boolean).map((v) => String(v));
  if (!value) return [];
  if (typeof value === 'string') return value.split('\n').map((v) => v.trim()).filter(Boolean);
  return [];
};

const DEFAULT_CONFIG = {
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
    paymentTerms: 'Zahlbar innert 30 Tagen netto.',
    bankName: '',
    bankAddress: '',
    referencePrefix: '',
    paymentReferenceType: 'NON',
    paymentReference: ''
  },
  branding: {
    logo: '',
    primary: '#0F6DF6',
    accent: '#00A2FF',
    accentSoft: '#E6F1FF',
    textDark: '#1B2A4B',
    textMuted: '#4F5D7A',
    background: '#FFFFFF'
  }
};

const ensureObject = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
};

const cache = new Map();
const CACHE_TTL_MS = 60 * 1000;

const normalizeClinic = (baseClinic = {}, row = null) => {
  const clinic = {
    ...DEFAULT_CONFIG.clinic,
    ...JSON.parse(JSON.stringify(baseClinic || {}))
  };

  if (row) {
    if (row.creditor_name) clinic.name = String(row.creditor_name);
    if (row.creditor_additional) clinic.subtitle = String(row.creditor_additional);
    const lines = asArray(row.address_lines);
    if (lines[0]) clinic.address.street = lines[0];
    if (lines[1]) clinic.address.houseNo = lines[1];
    clinic.address.zip = row.zip ? String(row.zip) : clinic.address.zip;
    clinic.address.city = row.city ? String(row.city) : clinic.address.city;
    clinic.address.country = row.country ? String(row.country).toUpperCase() : clinic.address.country;
    clinic.iban = sanitizeIban(row.iban || clinic.iban);
    clinic.qrIban = sanitizeIban(row.iban || clinic.qrIban || clinic.iban);
  } else {
    clinic.iban = sanitizeIban(clinic.iban);
    clinic.qrIban = sanitizeIban(clinic.qrIban || clinic.iban);
  }

  return clinic;
};

const normalizeInvoice = (baseInvoice = {}, row = null) => {
  const invoice = {
    ...DEFAULT_CONFIG.invoice,
    ...JSON.parse(JSON.stringify(baseInvoice || {}))
  };

  if (row) {
    invoice.bankName = row.bank_name ? String(row.bank_name) : invoice.bankName;
    invoice.bankAddress = row.bank_address ? String(row.bank_address) : invoice.bankAddress;
    invoice.paymentReferenceType = row.payment_reference_type
      ? String(row.payment_reference_type).toUpperCase()
      : invoice.paymentReferenceType;
    invoice.paymentReference = row.payment_reference ? String(row.payment_reference) : invoice.paymentReference;
    if (row.additional_text) {
      invoice.paymentTerms = String(row.additional_text);
    }
  }

  invoice.paymentReferenceType = ['NON', 'QRR', 'SCOR'].includes(invoice.paymentReferenceType)
    ? invoice.paymentReferenceType
    : 'NON';

  return invoice;
};

const normalizeBranding = (baseBranding = {}, row = null) => {
  const branding = {
    ...DEFAULT_CONFIG.branding,
    ...JSON.parse(JSON.stringify(baseBranding || {}))
  };
  if (row?.logo_path) branding.logo = String(row.logo_path);

  branding.primary = sanitizeColor(branding.primary, DEFAULT_CONFIG.branding.primary);
  branding.accent = sanitizeColor(branding.accent, DEFAULT_CONFIG.branding.accent);
  branding.accentSoft = sanitizeColor(branding.accentSoft, DEFAULT_CONFIG.branding.accentSoft);
  branding.textDark = sanitizeColor(branding.textDark, DEFAULT_CONFIG.branding.textDark);
  branding.textMuted = sanitizeColor(branding.textMuted, DEFAULT_CONFIG.branding.textMuted);
  branding.background = sanitizeColor(branding.background, DEFAULT_CONFIG.branding.background);

  return branding;
};

async function getTenantBillingConfig(tenantCtx) {
  const tenantId = tenantCtx.id;
  const cached = cache.get(tenantId);
  if (cached && cached.expires > Date.now()) {
    return cached.value;
  }

  let row = null;
  let settingsJson = {};
  try {
    const result = await tenantCtx.db.query(
      `SELECT tenant_id, iban, creditor_name, creditor_additional, address_lines,
              zip, city, country, logo_path, bank_name, bank_address,
              payment_reference_type, payment_reference, additional_text,
              metadata
         FROM tenant_settings
        WHERE tenant_id = $1
        LIMIT 1`,
      [tenantId]
    );
    row = result.rows[0] || null;
    settingsJson = ensureObject(row?.metadata);
  } catch (err) {
    if (err?.code === '42P01') {
      row = null;
    } else if (err?.code === '42703') {
      // Minimal schema variant: tenant_settings(tenant_id, settings jsonb, ...)
      try {
        const result = await tenantCtx.db.query(
          `SELECT tenant_id, settings
             FROM tenant_settings
            WHERE tenant_id = $1
            LIMIT 1`,
          [tenantId]
        );
        row = result.rows[0] || null;
        settingsJson = ensureObject(row?.settings);
      } catch (e2) {
        if (e2?.code !== '42P01') throw e2;
        row = null;
      }
    } else {
      throw err;
    }
  }

  const baseMeta = tenantCtx.meta || {};

  const mergedMeta = {
    ...baseMeta,
    clinic: { ...(baseMeta.clinic || {}), ...(ensureObject(settingsJson.clinic)) },
    invoice: { ...(baseMeta.invoice || {}), ...(ensureObject(settingsJson.invoice)) },
    branding: { ...(baseMeta.branding || {}), ...(ensureObject(settingsJson.branding)) },
    billing: { ...(ensureObject(baseMeta.billing)), ...(ensureObject(settingsJson.billing)) }
  };

  const clinic = normalizeClinic(mergedMeta.clinic, row && row.iban !== undefined ? row : null);
  const invoice = normalizeInvoice(mergedMeta.invoice, row && row.payment_reference_type !== undefined ? row : null);
  const branding = normalizeBranding(mergedMeta.branding, row && row.logo_path !== undefined ? row : null);
  const recipe = JSON.parse(JSON.stringify(mergedMeta.recipe || {}));

  const value = { clinic, invoice, branding, recipe, billing: mergedMeta.billing || {} };
  cache.set(tenantId, { value, expires: Date.now() + CACHE_TTL_MS });
  return value;
}

module.exports = {
  getTenantBillingConfig
};
