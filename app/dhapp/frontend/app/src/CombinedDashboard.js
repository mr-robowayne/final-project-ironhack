import React, { useEffect, useMemo, useState } from 'react';
import api from './api';

export default function CombinedDashboard() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState(null);
  const [lowStock, setLowStock] = useState(0);
  const [waitCounts, setWaitCounts] = useState({});
  const [journeyCounts, setJourneyCounts] = useState({});
  const [sopStats, setSopStats] = useState({ total: 0, locked: 0 });
  const [invoiceStats, setInvoiceStats] = useState({ total: 0, byStatus: [] });
  const [from, setFrom] = useState(() => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0,10); });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0,10));

  const load = async () => {
    try {
      setLoading(true); setError('');
      const fromDate = new Date(from);
      const toDate = new Date(to);
      const p = new URLSearchParams(); p.set('from', fromDate.toISOString()); p.set('to', toDate.toISOString());
      const [sumRes, waitRes, journeyRes, invRes, sopRes] = await Promise.all([
        api.get(`/api/dashboard/tenantSummary?${p.toString()}`),
        api.get('/api/waiting-room'),
        api.get('/api/patient-journey'),
        api.get('/api/inventory/items?lowStockOnly=true'),
        api.get('/api/sops')
      ]);
      setSummary(sumRes?.data || null);
      const waitItems = (waitRes?.data?.items || []);
      const wc = {}; waitItems.forEach(i => { wc[i.status] = (wc[i.status]||0)+1; }); setWaitCounts(wc);
      const jItems = (journeyRes?.data?.items || []);
      const jc = {}; jItems.forEach(i => { jc[i.stage] = (jc[i.stage]||0)+1; }); setJourneyCounts(jc);
      setLowStock(Array.isArray(invRes?.data?.items) ? invRes.data.items.length : 0);
      const sops = (sopRes?.data?.items || []); setSopStats({ total: sops.length, locked: sops.filter(s => s.locked).length });

      // Rechnungen im Zeitraum (clientseitig gefiltert)
      try {
        const inv = await api.get('/api/invoices?limit=500');
        const list = Array.isArray(inv?.data) ? inv.data : [];
        const inRange = list.filter(r => { const d = r.created_at ? new Date(r.created_at) : null; return d && d >= fromDate && d <= toDate; });
        const by = {}; inRange.forEach(r => { const s = (r.status || 'UNKNOWN').toUpperCase(); by[s] = (by[s]||0)+1; });
        const byStatus = Object.keys(by).sort().map(k => ({ status: k, count: by[k] }));
        setInvoiceStats({ total: inRange.length, byStatus });
      } catch {}
    } catch (e) {
      setError(e?.message || 'Dashboard konnte nicht geladen werden');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);
  const tasksByType = useMemo(() => summary?.tasksByType || [], [summary]);

  return (
    <div style={{ padding: 0 }}>
      <h2 className="h2" style={{ marginTop: 0 }}>Dashboard</h2>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <label>Von</label>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <label>Bis</label>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <button className="btn-save" onClick={load}>Aktualisieren</button>
      </div>
      {error && <div style={{ color: 'crimson', marginBottom: 8 }}>{error}</div>}
      {loading && <div>Lade…</div>}
      {!loading && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 12, color: '#6b7280' }}>Konsultationen (Zeitraum)</div>
              <div style={{ fontSize: 28, fontWeight: 700 }}>{summary?.consultations ?? '—'}</div>
            </div>
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 12, color: '#6b7280' }}>Neue Patienten</div>
              <div style={{ fontSize: 28, fontWeight: 700 }}>{summary?.newPatients ?? '—'}</div>
            </div>
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 12, color: '#6b7280' }}>Überfällige Tasks</div>
              <div style={{ fontSize: 28, fontWeight: 700 }}>{summary?.overdueTasks ?? '—'}</div>
            </div>
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 12, color: '#6b7280' }}>Rechnungen (Zeitraum)</div>
              <div style={{ fontSize: 28, fontWeight: 700 }}>{invoiceStats.total}</div>
            </div>
          </div>

          <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Offene Aufgaben nach Typ</div>
              {(tasksByType||[]).length === 0 && <div style={{ color: '#6b7280' }}>Keine offenen Aufgaben</div>}
              {(tasksByType||[]).map(t => (
                <div key={t.type} style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>{t.type}</span>
                  <strong>{t.count}</strong>
                </div>
              ))}
            </div>
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Wartezimmer</div>
              {['ANGEMELDET','WARTEZIMMER','IN_BEHANDLUNG','FERTIG'].map(s => (
                <div key={s} style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>{s.replace('_',' ')}</span>
                  <strong>{Number(waitCounts[s]||0)}</strong>
                </div>
              ))}
            </div>
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Patienten‑Journey</div>
              {['NEW','ABKLAERUNG','OP_GEPLANT','OP_ERFOLGT','NACHKONTROLLE','ABGESCHLOSSEN'].map(s => (
                <div key={s} style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>{s.replace('_',' ')}</span>
                  <strong>{Number(journeyCounts[s]||0)}</strong>
                </div>
              ))}
            </div>
          </div>

          <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>SOPs</div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Gesamt</span>
                <strong>{sopStats.total}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Gesperrt</span>
                <strong>{sopStats.locked}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Unter Mindestbestand</span>
                <strong>{lowStock}</strong>
              </div>
            </div>
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Rechnungen nach Status</div>
              {invoiceStats.byStatus.length === 0 && <div style={{ color: '#6b7280' }}>Keine Rechnungen im Zeitraum</div>}
              {invoiceStats.byStatus.map(r => (
                <div key={r.status} style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>{r.status}</span>
                  <strong>{r.count}</strong>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
