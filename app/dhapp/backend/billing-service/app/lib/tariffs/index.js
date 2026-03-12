const path = require('path');
const { loadTariffCatalog } = require('./loaders');

/**
 * Loads the TARDOC + ambulante Pauschalen catalog from ./Tardoc (relative to app root).
 * Keeps data in-memory for fast lookups; validation/calculation layers can consume this.
 *
 * Note: Field mappings are best-effort. Some columns in the spreadsheets are
 * sparsely documented; see TODOs in loaders.js and refine based on the PDFs:
 * - Klarstellungen_und_Beispiele_zu_Anhang_A2.pdf
 * - 241022_anhangc_richtlinien_fuer_die_ambulante_leistungserfassung-2.pdf
 * - 250430_AnhangG_Sparten.pdf / 250430_anhangf_dignitaeten-.pdf
 */
function initTariffCatalog(appDir) {
  const baseDir = path.join(appDir, 'Tardoc');
  return loadTariffCatalog({ baseDir });
}

module.exports = {
  initTariffCatalog
};

