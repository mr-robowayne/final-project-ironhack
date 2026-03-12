import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { listPatientJourney, setPatientJourneyStage } from './api';
import PatientSearchInput from './PatientSearchInput';

const STAGES = [
  { key: 'NEW', label: 'Neuanmeldung' },
  { key: 'ABKLAERUNG', label: 'Abklärung' },
  { key: 'OP_GEPLANT', label: 'OP geplant' },
  { key: 'OP_ERFOLGT', label: 'OP erfolgt' },
  { key: 'NACHKONTROLLE', label: 'Nachkontrolle' },
  { key: 'ABGESCHLOSSEN', label: 'Abgeschlossen' },
];

export default function PatientJourneyBoard() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const [newPatient, setNewPatient] = useState(null);

  const grouped = useMemo(() => {
    const map = new Map(STAGES.map(s => [s.key, []]));
    for (const it of items) {
      if (!map.has(it.stage)) map.set(it.stage, []);
      map.get(it.stage).push(it);
    }
    return map;
  }, [items]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const data = await listPatientJourney();
      setItems(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e?.message || 'Laden fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onDropTo = async (stageKey, patientEntry) => {
    if (!patientEntry || patientEntry.stage === stageKey) return;
    try {
      await setPatientJourneyStage(patientEntry.patient_id, stageKey);
      setItems(prev => prev.map(p => p.patient_id === patientEntry.patient_id ? { ...p, stage: stageKey, updated_at: new Date().toISOString() } : p));
    } catch (e) {
      alert(e?.message || 'Update fehlgeschlagen');
    }
  };

  const onDragStart = (evt, entry) => {
    evt.dataTransfer.setData('application/json', JSON.stringify({ patient_id: entry.patient_id }));
    evt.dataTransfer.effectAllowed = 'move';
  };
  const onDragOver = (evt) => { evt.preventDefault(); evt.dataTransfer.dropEffect = 'move'; };
  const onDrop = (evt, stageKey) => {
    evt.preventDefault();
    try {
      const data = JSON.parse(evt.dataTransfer.getData('application/json'));
      const entry = items.find(i => i.patient_id === data.patient_id);
      if (entry) onDropTo(stageKey, entry);
    } catch {}
  };

  return (
    <div style={{ padding: 12, maxWidth: '100vw' }}>
      <h3 style={{ marginTop: 0, marginBottom: 8 }}>Patienten OP Verlauf</h3>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, maxWidth: '100%' }}>
        <input
          type="text"
          placeholder="Filter (Name/ID)"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ maxWidth: 220 }}
        />
        <div style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6, alignItems: 'center', minWidth: 260 }}>
          <PatientSearchInput value={newPatient} onChange={setNewPatient} placeholder="Patient hinzufügen…" />
          <button
            className="btn-save"
            onClick={async () => {
              const pid = newPatient?.id;
              if (!pid) return;
              try { await setPatientJourneyStage(pid, 'NEW'); setNewPatient(null); await load(); } catch (e) { alert(e?.message || 'Hinzufügen fehlgeschlagen'); }
            }}
          >
            Hinzufügen
          </button>
        </div>
      </div>
      {error && <div style={{ color: 'crimson' }}>{error}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${STAGES.length}, minmax(220px, 1fr))`, gap: 12, overflowX: 'auto' }}>
        {STAGES.map(col => (
          <div key={col.key}
               onDragOver={onDragOver}
               onDrop={(e) => onDrop(e, col.key)}
               style={{ background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 8, minHeight: 280, overflow: 'hidden' }}>
            <div style={{ fontWeight: 700, padding: '8px 10px', background: '#eef2ff', borderBottom: '1px solid #e5e7eb' }}>{col.label}</div>
            <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(grouped.get(col.key) || [])
                .filter(card => {
                  if (!filter) return true;
                  const f = filter.toLowerCase();
                  return String(card.patient_id).includes(f) || `${card.vorname||''} ${card.nachname||''}`.toLowerCase().includes(f);
                })
                .map(card => (
                <div key={`${card.patient_id}`}
                     draggable
                     onDragStart={(e) => onDragStart(e, card)}
                     title={`Letzte Änderung: ${new Date(card.updated_at || Date.now()).toLocaleString('de-CH')}`}
                     style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: 6, padding: 8, boxShadow: '0 1px 0 rgba(0,0,0,0.02)' }}>
                  <div style={{ fontWeight: 600 }}>{card.vorname || ''} {card.nachname || ''}</div>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>Patient-ID: {card.patient_id}</div>
                  <div style={{ marginTop: 6 }}>
                    <select value={card.stage} onChange={async (e) => {
                      try { await setPatientJourneyStage(card.patient_id, e.target.value); setItems(prev => prev.map(p => p.patient_id === card.patient_id ? { ...p, stage: e.target.value, updated_at: new Date().toISOString() } : p)); } catch (err) { alert(err?.message || 'Update fehlgeschlagen'); }
                    }}>
                      {STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                    </select>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
