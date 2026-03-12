'use strict';

const express = require('express');
const router = express.Router();
const store = require('../../lib/medJsonStore');
const fs = require('fs');
const path = require('path');

// Helper: sanitize pagination
function pg(opts = {}) {
  const limit = Math.max(1, Math.min(100, Number(opts.limit || 20)));
  const offset = Math.max(0, Number(opts.offset || 0));
  return { limit, offset };
}

// GET /api/meds?q=...&limit=&offset=
router.get('/', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const { limit, offset } = pg(req.query);
    const all = store.search(q, { limit: limit + offset }) || [];
    const slice = all.slice(offset, offset + limit);
    // Map holder->manufacturer for UI display
    const items = slice.map(r => ({
      id: r.id,
      atc_code: r.atc_code,
      name: r.name,
      manufacturer: r.manufacturer || r.holder || null,
      active_substances: r.active_substances,
      forms: r.forms,
    }));
    return res.json({ items, limit, offset, q });
  } catch (err) {
    console.error('meds search error (json):', err?.message || err);
    return res.status(500).json({ message: 'Fehler bei der Suche' });
  }
});

// Utility endpoints
router.get('/_status', (req, res) => {
  try { return res.json({ ok: true, ...store.info() }); }
  catch (e) { return res.status(500).json({ ok: false, error: e?.message || String(e) }); }
});

router.post('/_reload', (req, res) => {
  try { store.reload(); return res.json({ ok: true, ...store.info() }); }
  catch (e) { return res.status(500).json({ ok: false, error: e?.message || String(e) }); }
});

// GET /api/meds/:id
router.get('/:id(\\d+)', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: 'Ungültige ID' });
    const rec = store.getById(id);
    if (!rec) return res.status(404).json({ message: 'Nicht gefunden' });
    // Keep shape similar to DB row
    const out = { ...rec };
    if (!out.manufacturer && out.holder) out.manufacturer = out.holder;
    // Add leaflet_local if offline exists
    const leafDir = process.env.MED_LEAFLETS_DIR || '/app/data/leaflets';
    const candidate = path.join(leafDir, `${out.swissmedic_no5}.html`);
    try { if (fs.existsSync(candidate)) out.leaflet_local = `/leaflets/${out.swissmedic_no5}.html`; } catch {}
    return res.json(out);
  } catch (err) {
    console.error('meds detail error (json):', err?.message || err);
    return res.status(500).json({ message: 'Fehler beim Laden' });
  }
});

module.exports = { medsRouter: router };
