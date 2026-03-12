'use strict';

const path = require('path');

/**
 * Returns a normalized view of the tenant storage layout.
 * Useful when swapping to different backends (e.g. S3, MinIO).
 */
function describeTenantStorage(tenantCtx) {
  if (!tenantCtx?.paths) {
    throw new Error('Tenant context ohne Pfade übergeben.');
  }
  const { paths } = tenantCtx;
  return {
    root: paths.baseDir,
    data: {
      root: paths.dataDir,
      patients: paths.dataPatientsDir,
      invoices: paths.dataInvoicesDir,
      faelleJson: paths.faelleJsonPath,
    },
    documents: {
      root: paths.documentsDir,
      pdf: paths.pdfDir,
      json: paths.jsonDir,
      xml: paths.xmlDir,
      ack: paths.ackDir,
    },
    uploads: paths.uploadsDir,
    patientFiles: paths.patientFilesDir,
    tmp: paths.tmpDir,
    logs: paths.logsDir,
  };
}

function resolveTenantPath(tenantCtx, relativePath) {
  const storage = describeTenantStorage(tenantCtx);
  const candidate = path.resolve(storage.root, relativePath || '');
  if (!candidate.startsWith(storage.root)) {
    throw new Error('Pfad liegt außerhalb des Mandantenverzeichnisses.');
  }
  return candidate;
}

module.exports = {
  describeTenantStorage,
  resolveTenantPath,
};
