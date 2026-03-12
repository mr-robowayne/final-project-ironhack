import React, { useEffect, useState } from 'react';
import api from './api';

const ICON = {
  APPOINTMENT: '📅', TASK: '✅', NOTE: '📝', COMM: '📞', DOCUMENT: '📄'
};

export default function PatientTimeline({ patient, onClose }) {
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');

  const load = async () => {
    try { const { data } = await api.get(`/api/patients/${encodeURIComponent(patient.id)}/timeline`); setItems(Array.isArray(data?.items) ? data.items : []); } catch (e) { setError(e?.message || 'Timeline konnte nicht geladen werden'); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [patient?.id]);

  return (
    <div className="popup-overlay">
      <div className="popup-container wide-popup">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 className="h2" style={{ margin: 0 }}>🕒 Timeline: {patient?.vorname} {patient?.nachname}</h2>
          <button className="btn-cancel" onClick={() => onClose?.()} title="Schließen" type="button">❌</button>
        </div>
        <hr />
        {error && <div style={{ color: 'crimson' }}>{error}</div>}
        <div>
          {items.length === 0 && <div style={{ color: '#6b7280' }}>Keine Einträge</div>}
          {items.map((it, idx) => (
            <div key={idx} style={{ padding: '6px 0', borderBottom: '1px dashed #e5e7eb' }}>
              <strong>{ICON[it.type] || '•'} {new Date(it.date).toLocaleString('de-CH')}</strong> · {it.text}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

