import React, { useEffect, useState } from 'react';
import api from './api';

export default function PersonalDashboard({ onClose }) {
  const [widgets, setWidgets] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [notes, setNotes] = useState([]);
  const [patients, setPatients] = useState([]);

  const loadWidgets = async () => {
    try { const { data } = await api.get('/api/me/dashboard'); setWidgets(Array.isArray(data?.widgets)? data.widgets : []); } catch {}
  };
  const loadData = async () => {
    try {
      const tasksRes = await api.get('/api/tasks?status=OPEN,IN_PROGRESS&limit=20');
      setTasks(Array.isArray(tasksRes?.data?.items) ? tasksRes.data.items : []);
    } catch {}
    try {
      const notesRes = await api.get('/api/notes?visibilityType=PERSONAL&limit=10');
      setNotes(Array.isArray(notesRes?.data?.items) ? notesRes.data.items : []);
    } catch {}
    try {
      const p = new URLSearchParams(); p.set('limit', '10');
      const patRes = await api.get(`/api/patients?${p.toString()}`);
      setPatients(Array.isArray(patRes?.data) ? patRes.data.slice(0,10) : []);
    } catch {}
  };
  useEffect(() => { loadWidgets(); loadData(); }, []);

  return (
    <div className="popup-overlay">
      <div className="popup-container wide-popup">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 className="h2" style={{ margin: 0 }}>🏠 Mein Dashboard</h2>
          <button className="btn-cancel" onClick={() => onClose?.()} title="Schließen" type="button">❌</button>
        </div>
        <hr />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 8 }}>
            <h3 style={{ marginTop: 0 }}>Meine Aufgaben</h3>
            {tasks.length === 0 && <div style={{ color: '#6b7280' }}>Keine Aufgaben</div>}
            {tasks.slice(0,8).map(t => (
              <div key={t.id}>
                <strong>{t.title}</strong> · <span style={{ color: '#6b7280' }}>{t.status}</span>
              </div>
            ))}
          </div>
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 8 }}>
            <h3 style={{ marginTop: 0 }}>Meine Notizen</h3>
            {notes.length === 0 && <div style={{ color: '#6b7280' }}>Keine Notizen</div>}
            {notes.slice(0,8).map(n => (
              <div key={n.id}>
                <strong>{n.title || '(ohne Titel)'}</strong>
              </div>
            ))}
          </div>
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 8 }}>
            <h3 style={{ marginTop: 0 }}>Letzte Patienten</h3>
            {patients.length === 0 && <div style={{ color: '#6b7280' }}>Keine Patienten</div>}
            {patients.map(p => (
              <div key={p.id}>{p.vorname} {p.nachname}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

