import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { listWaitingRoom, setWaitingStatus, createNote, setPatientJourneyStage } from './api';
import PatientSearchInput from './PatientSearchInput';

const STATUSES = [
  { key: 'ANGEMELDET', label: 'Angemeldet' },
  { key: 'WARTEZIMMER', label: 'Wartezimmer' },
  { key: 'IN_BEHANDLUNG', label: 'In Behandlung' },
  { key: 'FERTIG', label: 'Fertig' },
];

function fmtDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  const h = Math.floor(m / 60);
  const min = m % 60;
  if (h > 0) return `${h}h ${min}m`;
  return `${min}m ${sec}s`;
}

export default function WaitingRoomView() {
  const [items, setItems] = useState([]);
  const [tick, setTick] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [newPatient, setNewPatient] = useState(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const data = await listWaitingRoom({ status: filterStatus || undefined });
      setItems(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e?.message || 'Laden fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  }, [filterStatus]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const onSet = async (patientId, status) => {
    const current = items.find((p) => p.patient_id === patientId);
    try {
      await setWaitingStatus(patientId, status);
      const nowIso = new Date().toISOString();
      setItems(prev =>
        prev.map(p =>
          p.patient_id === patientId
            ? { ...p, status, last_change_at: nowIso, waiting_ms: 0 }
            : p
        )
      );
      if (status === 'FERTIG') {
        // Journey-Stage aktualisieren (für Auswertung/Dashboard)
        try {
          await setPatientJourneyStage(patientId, 'ABGESCHLOSSEN');
        } catch (_) {
          // Journey-Update ist optional
        }
      }
    } catch (e) {
      alert(e?.message || 'Update fehlgeschlagen');
    }
  };

  const grouped = useMemo(() => {
    const map = new Map(STATUSES.map(s => [s.key, []]));
    for (const it of items) {
      if (!map.has(it.status)) map.set(it.status, []);
      map.get(it.status).push(it);
    }
    return map;
  }, [items]);

  const displayed = useMemo(() => {
    if (filterStatus) return items.filter(x => x.status === filterStatus);
    // Standardansicht: „fertige“ Patienten ausblenden
    return items.filter(x => x.status !== 'FERTIG');
  }, [items, filterStatus]);

  return (
    <div style={{ padding: 8 }}>
      <h3>Wartezimmer</h3>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
          <option value="">Alle</option>
          {STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <div style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6, alignItems: 'center', minWidth: 260 }}>
          <PatientSearchInput value={newPatient} onChange={setNewPatient} placeholder="Patient hinzufügen…" />
          <button
            className="btn-save"
            onClick={async () => {
              const pid = newPatient?.id;
              if (!pid) return;
              try { await setWaitingStatus(pid, 'ANGEMELDET'); setNewPatient(null); await load(); } catch (e) { alert(e?.message || 'Hinzufügen fehlgeschlagen'); }
            }}
          >
            Hinzufügen
          </button>
        </div>
      </div>
      {error && <div style={{ color: 'crimson' }}>{error}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: '3fr 1.2fr', gap: 12, alignItems: 'start' }}>
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8 }}>
          <div style={{ fontWeight: 700, padding: '8px 10px', background: '#eef2ff', borderBottom: '1px solid #e5e7eb' }}>Aktuelle Patienten</div>
          <div style={{ padding: 8 }}>
            {displayed.length === 0 && <div style={{ color: '#6b7280' }}>Keine Einträge</div>}
            {displayed.map(row => (
              <div key={`${row.patient_id}`}
                   style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderBottom: '1px dashed #e5e7eb' }}>
              <div>
                <div style={{ fontWeight: 600 }}>{row.vorname || ''} {row.nachname || ''}</div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>Status: {row.status.replace('_',' ')}</div>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>
                    {row.status === 'IN_BEHANDLUNG' ? 'Behandlungszeit' : 'Wartezeit'}: {fmtDuration(Math.max(0, (row.waiting_ms ?? 0) + tick * 1000))}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {STATUSES.map(s => (
                    <button key={s.key}
                            onClick={() => onSet(row.patient_id, s.key)}
                            style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #e5e7eb', background: row.status === s.key ? '#22c55e' : '#f8fafc', color: row.status === s.key ? '#fff' : '#111827' }}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8 }}>
          <div style={{ fontWeight: 700, padding: '8px 10px', background: '#eef2ff', borderBottom: '1px solid #e5e7eb' }}>Nach Status</div>
          <div style={{ padding: 8, display: 'grid', gridTemplateColumns: '1fr', gap: 8 }}>
            {STATUSES.map(s => (
              <div key={s.key} style={{ background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 6 }}>
                <div style={{ fontWeight: 600, fontSize: 13, padding: '6px 8px', borderBottom: '1px solid #e5e7eb' }}>{s.label}</div>
                <div style={{ padding: 8, fontSize: 13 }}>
                  {(grouped.get(s.key) || []).length} Patient(en)
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
