'use strict';

const fs = require('fs');
const path = require('path');

const META_PATH = process.env.MED_SECTIONS_META || '/app/data/med_sections_meta.jsonl';

let _loaded = false;
let _byNo5 = new Map();
let _pathUsed = META_PATH;

function loadOnce() {
  if (_loaded) return;
  let p = META_PATH;
  try {
    if (!fs.existsSync(p)) {
      const dev = path.join(process.cwd(), 'data', 'med_sections_meta.jsonl');
      const devAlt = path.join(process.cwd(), 'dhpatientsync_20251007_144615', 'data', 'med_sections_meta.jsonl');
      if (fs.existsSync(dev)) p = dev;
      else if (fs.existsSync(devAlt)) p = devAlt;
    }
    const txt = fs.readFileSync(p, 'utf8');
    const lines = txt.split(/\r?\n/);
    const map = new Map();
    for (const line of lines) {
      const s = (line || '').trim();
      if (!s) continue;
      try {
        const rec = JSON.parse(s);
        const no5 = rec?.swissmedic_no5;
        const sec = rec?.section;
        const txt2 = rec?.text;
        if (!no5 || !sec || !txt2) continue;
        if (!map.has(no5)) map.set(no5, {});
        const slot = map.get(no5);
        if (!slot[sec]) slot[sec] = txt2;
      } catch {}
    }
    _byNo5 = map;
    _pathUsed = p;
    _loaded = true;
  } catch (e) {
    _byNo5 = new Map();
    _loaded = true;
  }
}

function get(no5) {
  loadOnce();
  return _byNo5.get(Number(no5)) || null;
}

function info() {
  loadOnce();
  return { path: _pathUsed, entries: _byNo5.size };
}

module.exports = { get, info };
