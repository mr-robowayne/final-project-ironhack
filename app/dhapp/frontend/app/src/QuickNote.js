import React, { useEffect, useState } from 'react';
import { createNote, searchPatients } from './api';

function PatientPickerInline({ value, onChange }) {
  const [q, setQ] = useState('');
  const [opts, setOpts] = useState([]);
  useEffect(() => {
    let t;
    const run = async () => {
      if (q.trim().length < 2) { setOpts([]); return; }
      try {
        const list = await searchPatients(q.trim());
        setOpts(Array.isArray(list) ? list.slice(0, 8) : []);
      } catch (_) { setOpts([]); }
    };
    t = setTimeout(run, 250);
    return () => { if (t) clearTimeout(t); };
  }, [q]);
  return (
    <div>
      <input type="text" placeholder="Patient suchen…" value={q} onChange={(e) => setQ(e.target.value)} />
      {opts.length > 0 && (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 6, maxHeight: 160, overflowY: 'auto', marginTop: 6 }}>
          {opts.map((p) => (
            <div key={p.id} onClick={() => { onChange?.(p); setQ(''); setOpts([]); }} style={{ padding: 6, cursor: 'pointer' }}>
              #{p.id} · {p.vorname} {p.nachname}
            </div>
          ))}
        </div>
      )}
      {value && <div style={{ marginTop: 6 }}>Ausgewählt: #{value.id} · {value.vorname} {value.nachname}</div>}
    </div>
  );
}

export default function QuickNote({ onCreated, show, onClose, hideFab = false }) {
  const isControlled = typeof show === 'boolean';
  const [openState, setOpenState] = useState(false);
  const open = isControlled ? show : openState;
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [visibility, setVisibility] = useState('PERSONAL');
  const [patient, setPatient] = useState(null);
  const [saving, setSaving] = useState(false);

  // Global shortcut Alt+N
  useEffect(() => {
    const onKey = (e) => {
      if (!isControlled && e.altKey && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault(); setOpenState(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isControlled]);

  const reset = () => { setTitle(''); setContent(''); setVisibility('PERSONAL'); setPatient(null); };

  const save = async () => {
    if (!title.trim() && !content.trim()) { if (isControlled) onClose?.(); else setOpenState(false); return; }
    try {
      setSaving(true);
      const payload = { title: title || '(ohne Titel)', content, visibilityType: visibility };
      if (visibility === 'PATIENT' && patient?.id) payload.patientId = patient.id;
      const row = await createNote(payload);
      onCreated?.(row);
      reset();
      if (isControlled) onClose?.(); else setOpenState(false);
    } catch (e) {
      alert(e?.message || 'Notiz konnte nicht gespeichert werden');
    } finally { setSaving(false); }
  };

  return (
    <>
      {/* Floating Button (optional) */}
      {!hideFab && (
        <button
          onClick={() => (isControlled ? null : setOpenState(true))}
          style={{ position: 'fixed', right: 16, bottom: 16, zIndex: 50, width: 56, height: 56, borderRadius: 9999, background: '#2563eb', color: '#fff', border: 0, boxShadow: '0 2px 8px rgba(0,0,0,0.2)', cursor: 'pointer' }}
          title="Quick Note (Alt+N)"
        >
          ✎
        </button>
      )}

      {open && (
        <div className="popup-overlay" onClick={() => (isControlled ? onClose?.() : setOpenState(false))}>
          <div className="popup-container" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <h2 className="h2" style={{ margin: 0 }}>Schnellnotiz</h2>
            <div className="title-actions" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="btn-cancel" onClick={() => (isControlled ? onClose?.() : setOpenState(false))}>Schließen</button>
            </div>
            <div className="form-group">
              <label>Titel</label>
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
            </div>
            <div className="form-group">
              <label>Inhalt</label>
              <textarea rows={5} value={content} onChange={(e) => setContent(e.target.value)} spellCheck lang="de-CH" placeholder="Kurze Notiz…" />
            </div>
            <div className="form-group">
              <label>Sichtbarkeit</label>
              <select value={visibility} onChange={(e) => setVisibility(e.target.value)}>
                <option value="PERSONAL">Meine Notiz</option>
                <option value="PRACTICE">Praxis-weit</option>
                <option value="PATIENT">Patientenbezogen</option>
              </select>
            </div>
            {visibility === 'PATIENT' && (
              <div className="form-group">
                <label>Patient</label>
                <PatientPickerInline value={patient} onChange={setPatient} />
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn" onClick={() => { reset(); (isControlled ? onClose?.() : setOpenState(false)); }}>Abbrechen</button>
              <button className="btn-save" onClick={save} disabled={saving}>{saving ? 'Speichern…' : 'Speichern'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
