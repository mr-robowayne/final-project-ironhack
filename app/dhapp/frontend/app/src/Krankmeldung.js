import React, { useEffect, useState } from 'react';
import { listSickNotes, createSickNote, updateSickNote, finalizeSickNote, sickNotePdfUrl } from './api';

const RECEIVER_TYPES = [
  { value: 'ARBEITGEBER', label: 'Arbeitgeber' },
  { value: 'VERSICHERUNG', label: 'Versicherung' },
  { value: 'PATIENT', label: 'Patient' },
  { value: 'SONSTIGER', label: 'Sonstiger' },
];

function toDateInputValue(v) {
  if (!v) return '';
  const s = String(v);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${mm}-${dd}`;
}

const Krankmeldung = ({ selectedPatient, onClose, onMinimize, initialState }) => {
  const [notes, setNotes] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [current, setCurrent] = useState(null);

  const todayYmd = toDateInputValue(new Date());

  useEffect(() => {
    if (!selectedPatient?.id) return;
    (async () => {
      setBusy(true); setError('');
      try {
        const items = await listSickNotes(selectedPatient.id);
        setNotes(items);
      } catch {
        setError('Krankmeldungen konnten nicht geladen werden.');
      } finally {
        setBusy(false);
      }
    })();
  }, [selectedPatient?.id]);

  const ensureCurrent = async () => {
    if (current) return current;
    setBusy(true); setError('');
    try {
      const payload = {
        patient_id: selectedPatient.id,
        start_date: todayYmd,
        end_date: null,
        open_end: false,
        degree_percent: 100,
        receiver_type: 'PATIENT',
      };
      const created = await createSickNote(payload);
      setNotes((prev) => [created, ...prev]);
      setCurrent(created);
      return created;
    } catch (e) {
      setError(e?.message || 'Neue Krankmeldung konnte nicht erstellt werden');
      return null;
    } finally { setBusy(false); }
  };

  const isFinal = current?.status === 'FINAL';

  const handleSaveDraft = async () => {
    const cur = current || await ensureCurrent();
    if (!cur) return;
    setBusy(true); setError('');
    try {
      const payload = {
        start_date: cur.start_date,
        end_date: cur.open_end ? null : cur.end_date,
        open_end: cur.open_end,
        degree_percent: Number(cur.degree_percent || 100),
        diagnosis_short: cur.diagnosis_short || null,
        remark: cur.remark || null,
        receiver_type: cur.receiver_type || 'PATIENT',
        receiver_name: cur.receiver_name || null,
        receiver_address: cur.receiver_address || null,
        status: 'DRAFT',
      };
      const updated = await updateSickNote(cur.id, payload);
      setCurrent(updated || cur);
      setNotes((list) => list.map(n => n.id === cur.id ? updated : n));
      alert('Entwurf gespeichert');
    } catch (e) { setError(e?.message || 'Speichern fehlgeschlagen'); }
    finally { setBusy(false); }
  };

  const handleFinalize = async () => {
    const cur = current || await ensureCurrent();
    if (!cur) return;
    if (!window.confirm('Krankmeldung finalisieren und PDF erzeugen?')) return;
    setBusy(true); setError('');
    try {
      const resp = await finalizeSickNote(cur.id);
      const updated = resp?.note || cur;
      setCurrent(updated);
      setNotes((list) => list.map(n => n.id === updated.id ? updated : n));
      if (resp?.pdf) window.open(resp.pdf, '_blank', 'noopener');
    } catch (e) {
      setError(e?.message || 'Finalisieren fehlgeschlagen');
    } finally { setBusy(false); }
  };

  const setField = (k, v) => setCurrent((prev) => ({ ...prev, [k]: v }));

  return (
    <div className="popup-overlay">
      <div className="popup-container" style={{ width: '980px', maxWidth: '980px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2>Krankmeldung / Arbeitsunfähigkeitszeugnis – {selectedPatient?.vorname} {selectedPatient?.nachname}</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            {onMinimize && (
              <button className="btn-save" onClick={() => onMinimize({ current })} title="Als Tab" type="button">Als Tab</button>
            )}
            <button className="btn-cancel" onClick={() => onClose?.()} title="Schließen" type="button">❌</button>
          </div>
        </div>
        <br />
        <hr />

        {error && <div role="alert" style={{ color: '#b91c1c' }}>{error}</div>}
        {busy && <div>Bitte warten…</div>}

        <div style={{ display: 'flex', gap: 16 }}>
          <div style={{ flex: 1 }}>
            <div style={{ marginBottom: 12 }}>
              <strong>Patient</strong>
              <div style={{ fontSize: 13, color: '#4b5563', marginTop: 4 }}>
                {selectedPatient?.vorname} {selectedPatient?.nachname}{selectedPatient?.geburtsdatum ? `, geb. ${new Date(selectedPatient.geburtsdatum).toLocaleDateString('de-CH')}` : ''}
                <br/>{selectedPatient?.geschlecht ? `Geschlecht: ${selectedPatient.geschlecht}` : ''}
                <br/>{selectedPatient?.versichertennummer ? `Versichertennummer: ${selectedPatient.versichertennummer}` : ''}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: '8px 12px' }}>
              <div>Beginn der Arbeitsunfähigkeit</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input type="date" value={toDateInputValue(current?.start_date) || todayYmd} onChange={(e) => setField('start_date', e.target.value)} disabled={isFinal} />
                <button type="button" className="btn-save" onClick={() => setField('start_date', todayYmd)} disabled={isFinal}>ab heute</button>
              </div>

              <div>Ende der Arbeitsunfähigkeit</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="date" value={current?.open_end ? '' : toDateInputValue(current?.end_date)} onChange={(e) => setField('end_date', e.target.value)} disabled={isFinal || current?.open_end} />
                <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input type="checkbox" checked={Boolean(current?.open_end)} onChange={(e) => setField('open_end', e.target.checked)} disabled={isFinal} /> bis auf Weiteres
                </label>
              </div>

              <div>Arbeitsunfähigkeit in %</div>
              <div>
                <select value={Number(current?.degree_percent ?? 100)} onChange={(e) => setField('degree_percent', Number(e.target.value))} disabled={isFinal}>
                  {[100, 80, 50, 20].map(v => <option key={v} value={v}>{v}%</option>)}
                </select>
              </div>

              <div>Diagnose (Kurztext, optional)</div>
              <div><input type="text" value={current?.diagnosis_short || ''} onChange={(e) => setField('diagnosis_short', e.target.value)} disabled={isFinal} style={{ width: '100%' }} /></div>

              <div>Empfänger</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '6px' }}>
                <select value={current?.receiver_type || 'PATIENT'} onChange={(e) => setField('receiver_type', e.target.value)} disabled={isFinal}>
                  {RECEIVER_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
                <input type="text" placeholder="Name / Firma (optional)" value={current?.receiver_name || ''} onChange={(e) => setField('receiver_name', e.target.value)} disabled={isFinal} />
                <textarea rows={3} placeholder="Adresse (optional)" value={current?.receiver_address || ''} onChange={(e) => setField('receiver_address', e.target.value)} disabled={isFinal} />
              </div>

              <div>Bemerkungen (intern, optional)</div>
              <div><textarea rows={3} value={current?.remark || ''} onChange={(e) => setField('remark', e.target.value)} disabled={isFinal} /></div>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button className="btn-save" disabled={!selectedPatient} onClick={handleSaveDraft}>Speichern als Entwurf</button>
              <button className="btn-save" disabled={!selectedPatient} onClick={handleFinalize}>Finalisieren & PDF</button>
              {current?.id && current?.pdf_path && (
                <button className="btn-save" type="button" onClick={() => window.open(sickNotePdfUrl(current.id, true), '_blank', 'noopener')}>PDF anzeigen</button>
              )}
            </div>
          </div>

          <div style={{ width: 380 }}>
            <strong>Vorhandene Krankmeldungen</strong>
            <table className="table" style={{ width: '100%', marginTop: 6 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Datum</th>
                  <th style={{ textAlign: 'left' }}>%</th>
                  <th style={{ textAlign: 'left' }}>Zeitraum</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {notes.map((n) => (
                  <tr key={n.id} style={{ cursor: 'pointer' }} onClick={() => setCurrent(n)}>
                    <td>{new Date(n.created_at).toLocaleDateString('de-CH')}</td>
                    <td>{Number(n.degree_percent)}%</td>
                    <td>
                      {n.start_date ? new Date(n.start_date).toLocaleDateString('de-CH') : ''}
                      {n.open_end ? ' – bis auf Weiteres' : (n.end_date ? ` – ${new Date(n.end_date).toLocaleDateString('de-CH')}` : '')}
                    </td>
                    <td>{n.status}</td>
                  </tr>
                ))}
                {notes.length === 0 && (
                  <tr><td colSpan={4} style={{ color: '#6b7280' }}>Keine Einträge vorhanden.</td></tr>
                )}
              </tbody>
            </table>
            <div style={{ marginTop: 8 }}>
              <button className="btn-save" onClick={() => setCurrent(null)}>Neue Krankmeldung beginnen</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Krankmeldung;
