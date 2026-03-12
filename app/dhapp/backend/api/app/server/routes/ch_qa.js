'use strict';

const express = require('express');
const router = express.Router();
const { answer } = require('../../lib/ch_qa/pipeline');

router.post('/', async (req, res) => {
  try {
    const q = String(req.body?.query || '').trim();
    if (!q) return res.status(400).json({ message: 'query required' });
    const out = await answer(q);
    return res.json({ answer: out });
  } catch (e) {
    console.error('[ch-qa] error:', e?.stack || e?.message || e);
    return res.status(500).json({ message: 'error' });
  }
});

module.exports = { chQARouter: router };

