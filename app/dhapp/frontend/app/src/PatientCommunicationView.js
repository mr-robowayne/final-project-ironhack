import React, { useEffect, useState } from 'react';
import api from './api';

const TYPES = ['PHONE','EMAIL','SMS','LETTER','IN_PERSON'];
const DIRS = ['INBOUND','OUTBOUND'];

export default function PatientCommunicationView({ patient, onClose }) {
  const [items, setItems] = useState([]);
  const [type, setType] = useState('PHONE');
  const [dir, setDir] = useState('OUTBOUND');
  const [summary, setSummary] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    try { const { data } = await api.get(`/api/patients/${encodeURIComponent(patient.id)}/communication`); setItems(data?.items || []); } catch (e) { setError(e?.message || 'Kommunikationslog konnte nicht geladen werden'); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [patient?.id]);

  const save = async () => {
    try { await api.post(`/api/patients/${encodeURIComponent(patient.id)}/communication`, { type, direction: dir, summary }); setSummary(''); await load(); } catch (e) { alert(e?.response?.data?.message || e?.message || 'Speichern fehlgeschlagen'); }
  };

  return (
    <div className="popup-overlay">
      <div className="popup-container wide-popup">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 className="h2" style={{ margin: 0 }}>📞 Kommunikation: {patient?.vorname} {patient?.nachname}</h2>
          <button className="btn-cancel" onClick={() => onClose?.()} title="Schließen" type="button">❌</button>
        </div>
        <hr />
        {error && <div style={{ color: 'crimson' }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={dir} onChange={(e) => setDir(e.target.value)}>
            {DIRS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <input type="text" placeholder="Kurzbeschreibung" value={summary} onChange={(e) => setSummary(e.target.value)} style={{ flex: 1 }} />
          <button className="btn-save" onClick={save}>Speichern</button>
        </div>
        <div>
          {items.length === 0 && <div style={{ color: '#6b7280' }}>Keine Einträge</div>}
          {items.map(it => (
            <div key={it.id} style={{ padding: '8px 0', borderBottom: '1px dashed #e5e7eb' }}>
              <strong>{it.type} · {it.direction}</strong> · {new Date(it.created_at).toLocaleString('de-CH')} · {it.author_name || '—'}
              <div>{it.summary || '—'}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

