// server/app.ts
import express from 'express';
import bodyParser from 'body-parser';
import { appointmentsRouter } from './routes/appointments';
import { calendarsRouter } from './routes/calendars';

export const app = express();
app.use(bodyParser.json());

// simple auth mock (replace with real middleware)
app.use((req, _res, next) => {
  // expect headers: x-tenant-id, x-user-id
  (req as any).auth = {
    tenantId: req.header('x-tenant-id') || '',
    userId:   Number(req.header('x-user-id') || NaN),
  };
  next();
});

app.use('/api/appointments', appointmentsRouter);
app.use('/api/calendars', calendarsRouter);

