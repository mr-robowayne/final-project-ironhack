import React, { useEffect, useState } from 'react';
import api from './api';

export default function TenantDashboard({ onClose }) {
  const [data, setData] = useState(null);
  const [from, setFrom] = useState(() => new Date(Date.now() - 30*24*60*60*1000).toISOString().slice(0,10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0,10));
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const p = new URLSearchParams();
      p.set('from', new Date(from).toISOString());
      p.set('to', new Date(to).toISOString());
      const { data } = await api.get(`/api/dashboard/tenantSummary?${p.toString()}`);
      setData(data);
    } catch (e) { setError(e?.message || 'Dashboard konnte nicht geladen werden'); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  return (
    <div className="popup-overlay">
      <div className="popup-container wide-popup">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 className="h2" style={{ margin: 0 }}>📊 Praxis‑Dashboard</h2>
          <button className="btn-cancel" onClick={() => onClose?.()} title="Schließen" type="button">❌</button>
        </div>
        <hr />
        {error && <div style={{ color: 'crimson' }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
          <label>Von</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <label>Bis</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          <button className="btn-save" onClick={load}>Aktualisieren</button>
        </div>
        {!data ? (
          <div>Lade…</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 12, color: '#6b7280' }}>Konsultationen (Zeitraum)</div>
              <div style={{ fontSize: 28, fontWeight: 700 }}>{data.consultations}</div>
            </div>
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 12, color: '#6b7280' }}>Neue Patienten</div>
              <div style={{ fontSize: 28, fontWeight: 700 }}>{data.newPatients}</div>
            </div>
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 12, color: '#6b7280' }}>Überfällige Tasks</div>
              <div style={{ fontSize: 28, fontWeight: 700 }}>{data.overdueTasks}</div>
            </div>
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 12, color: '#6b7280' }}>Tasks nach Typ</div>
              <div>
                {(data.tasksByType||[]).map(t => (
                  <div key={t.type} style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>{t.type}</span>
                    <strong>{t.count}</strong>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
        
      </div>
    </div>
  );
}
