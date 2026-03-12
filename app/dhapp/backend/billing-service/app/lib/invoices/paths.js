'use strict';

const fs = require('fs');
const path = require('path');

const { describeTenantStorage } = require('../storage');

const SAFE_SEGMENT = /^[A-Za-z0-9_-]+$/;

const sanitizePatientId = (value) => {
  const num = Number(value);
  if (!Number.isInteger(num) || num <= 0) {
    throw new Error('Ungültige patient_id für Pfadberechnung.');
  }
  return String(num);
};

const sanitizeInvoiceId = (value) => {
  const str = String(value || '').trim();
  if (!str || !SAFE_SEGMENT.test(str.replace(/-/g, ''))) {
    throw new Error('Ungültige invoice_id für Pfadberechnung.');
  }
  return str;
};

const ensureDir = (dir) => {
  fs.mkdirSync(dir, { recursive: true, mode: 0o750 });
};

function resolveInvoicePaths(tenantCtx, patientId, invoiceId) {
  const storage = describeTenantStorage(tenantCtx);
  const safePatientId = sanitizePatientId(patientId);
  const safeInvoiceId = sanitizeInvoiceId(invoiceId);

  const patientDir = path.join(storage.patientFiles, safePatientId, 'invoices');
  const tenantDir = storage.documents.pdf;

  ensureDir(patientDir);
  ensureDir(tenantDir);

  const patientPath = path.join(patientDir, `${safeInvoiceId}.pdf`);
  const tenantPath = path.join(tenantDir, `${safeInvoiceId}.pdf`);

  return {
    tenantBase: storage.documents.root,
    patientPath,
    tenantPath
  };
}

module.exports = {
  resolveInvoicePaths
};
