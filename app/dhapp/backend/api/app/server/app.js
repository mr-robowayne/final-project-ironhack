// server/app.js (CommonJS)
const express = require('express');
const bodyParser = require('body-parser');
const { appointmentsRouter } = require('./routes/appointments');
const { calendarsRouter } = require('./routes/calendars');
const { sessionRouter } = require('./routes/session');
const { chQARouter } = require('./routes/ch_qa');

const app = express();
app.use(bodyParser.json());

// simple header-based auth mock: x-tenant-id / x-user-id
app.use((req, _res, next) => {
  req.auth = {
    tenantId: req.header('x-tenant-id') || '',
    userId: Number(req.header('x-user-id') || NaN),
  };
  next();
});

app.use('/api/appointments', appointmentsRouter);
app.use('/api/calendars', calendarsRouter);
app.use('/api/session', sessionRouter);
app.use('/api/ch-qa', chQARouter);

module.exports = { app };
