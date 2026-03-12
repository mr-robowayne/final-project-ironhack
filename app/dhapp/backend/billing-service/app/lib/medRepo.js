'use strict';

// JSON-backed medication repository (no DB access)
const store = require('./medJsonStore');

async function findMedsForQuery({ tenantId, q, limit = 12, lactoseSafe = false }) {
  // tenantId and lactoseSafe are ignored; data is global and JSON-backed
  const items = store.search(q, { limit: limit || 12 }) || [];
  // Ensure shape similar to DB rows; map holder->manufacturer for UI compatibility
  return items.map((r) => ({
    id: r.id,
    name: r.name,
    atc_code: r.atc_code,
    manufacturer: r.manufacturer || r.holder || null,
    active_substances: r.active_substances,
    forms: r.forms,
    indications: r.indications,
    contraindications: r.contraindications,
    side_effects: r.side_effects,
    interactions: r.interactions,
    warnings: r.warnings,
    pregnancy: r.pregnancy,
    allergens: r.allergens || null,
    leaflet_ref: r.leaflet_ref || null,
    approved_status: r.approved_status || null,
  }));
}

module.exports = { findMedsForQuery };
