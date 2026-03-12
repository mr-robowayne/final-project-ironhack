// server/routes/session.js
const express = require('express');

const router = express.Router();

// Minimal session info for frontend bootstrapping.
// Uses headers x-tenant-id and x-user-id provided by the proxy/dev to infer context.
router.get('/', async (req, res) => {
  const tenant = req.header('x-tenant-id') || req.header('X-Tenant-ID') || process.env.DEFAULT_TENANT || 'test';
  const userIdHeader = req.header('x-user-id') || req.header('X-User-ID');
  const userId = Number(userIdHeader);
  const user = Number.isFinite(userId) ? { id: userId } : null;

  res.json({
    tenant,
    tenantName: tenant,
    user,
  });
});

module.exports = { sessionRouter: router };

