import React, { useEffect, useMemo, useRef, useState } from 'react';
import { listLetters, createLetter, updateLetter, finalizeLetter, letterPdfUrl, getLetter, deleteLetter } from './api';

const TYPES = [
  { value: 'ARZTBRIEF', label: 'Arztbrief (Standard)' },
  { value: 'OP_BERICHT', label: 'OP-Bericht' },
  { value: 'AUSTRITTSBERICHT', label: 'Austrittsbericht' },
  { value: 'ZUWEISUNG', label: 'Zuweisung' },
  { value: 'VERSICHERUNGSBRIEF', label: 'Versicherungsbericht' },
  { value: 'SONSTIGER_BRIEF', label: 'Sonstiger Brief' },
];

function defaultContentFor(type, patient, user, tenantCity) {
  const base = {
    patient: {
      name: [patient?.vorname, patient?.nachname].filter(Boolean).join(' '),
      birthdate: patient?.geburtsdatum || '',
      gender: patient?.geschlecht || '',
      address: patient?.adresse || '',
      insurance_number: patient?.versichertennummer || patient?.insurance_number || '',
    },
    recipient: {},
    sections: {},
  };
  const today = new Date();
  const titleDate = `${String(today.getDate()).padStart(2,'0')}.${String(today.getMonth()+1).padStart(2,'0')}.${today.getFullYear()}`;
  const city = tenantCity || '';
  switch (type) {
    case 'OP_BERICHT':
      base.sections = {
        opDate: titleDate,
        opTeam: user?.name ? `Operateur: ${user.name}` : '',
        preDiag: '',
        postDiag: '',
        opTitle: '',
        indication: '',
        preStatus: '',
        opCourse: '',
        intraFindings: '',
        materials: '',
        bloodLoss: '',
        complications: '',
        postRegime: '',
        conclusion: '',
      };
      break;
    case 'ZUWEISUNG':
      base.sections = { reason: '', priorFindings: '', question: '' };
      break;
    case 'VERSICHERUNGSBRIEF':
      base.sections = { diagnoses: '', history: '', course: '', workCapacity: '', prognosis: '' };
      break;
    case 'SONSTIGER_BRIEF':
      base.sections = { subject: '', salutation: '', text: '', closing: `Mit freundlichen Grüßen\n${city}` };
      break;
    case 'AUSTRITTSBERICHT':
    case 'ARZTBRIEF':
    default:
      base.sections = {
        reason: '', history: '', findings: '', diagnostics: '',
        diagnoses: '', course: '', medication: '', recommendations: '',
        workCapacity: '', notes: ''
      };
  }
  return base;
}

function useSession() {
  const [session, setSession] = useState({ user: null, tenant: null });
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/session', { credentials: 'include' });
        const data = await res.json();
        setSession({ user: data?.user || null, tenant: data?.tenant || null, tenantMeta: data?.tenantMeta || null });
      } catch {}
    })();
  }, []);
  return session;
}

// Dictation: Web Speech API wrapper
function useDictation() {
  const [active, setActive] = useState(false);
  const recRef = useRef(null);
  const supported = useMemo(() => {
    return (
      typeof window !== 'undefined' && (
        window.SpeechRecognition || window.webkitSpeechRecognition
      )
    );
  }, []);

  const start = (onResult) => {
    if (!supported || active) return;
    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new Rec();
    rec.lang = 'de-CH,de-DE';
    rec.interimResults = true;
    try { rec.continuous = true; } catch (_) {}
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      try {
        const idx = e.resultIndex;
        const res = e.results && e.results[idx];
        const text = res && res[0] ? (res[0].transcript || '') : '';
        if (res && res.isFinal && typeof onResult === 'function') {
          onResult(text, e);
        }
      } catch (_) {}
    };
    rec.onend = () => { setActive(false); };
    rec.onerror = () => { setActive(false); };
    recRef.current = rec;
    setActive(true);
    try { rec.start(); } catch { setActive(false); }
  };
  const stop = () => { try { recRef.current?.stop(); } catch {} finally { setActive(false); } };
  const abort = () => { try { recRef.current?.abort(); } catch {} finally { setActive(false); } };
  return { supported: Boolean(supported), active, start, stop, abort };
}

const MicButton = ({ onAppend, title='Zum Sprechen gedrückt halten' }) => {
  const { supported, active, start, stop, abort } = useDictation();
  const downRef = useRef(false);
  if (!supported) return null;

  const begin = (e) => {
    e.preventDefault();
    if (downRef.current) return;
    downRef.current = true;
    start((t) => onAppend?.(t));
    // Als Sicherheitsnetz: wenn der Finger außerhalb losgelassen wird
    const onUp = () => { end(); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointerup', onUp);
  };
  const end = (e) => {
    if (e) e.preventDefault();
    if (!downRef.current) return;
    downRef.current = false;
    stop();
  };

  return (
    <span style={{ marginLeft: 6, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <button
        type="button"
        title={title}
        onPointerDown={begin}
        onPointerUp={end}
        onPointerCancel={end}
        onPointerLeave={(e) => { /* wenn gedrückt und verlassen -> beim Loslassen stoppt window listener */ }}
        style={{
          padding: '2px 8px',
          borderRadius: 8,
          border: '1px solid #cbd5e1',
          background: active ? '#fee2e2' : '#ffffff',
          color: '#111827',
          cursor: 'pointer'
        }}
      >
        {active ? '🎙️ Aufnahme…' : '🎤 Diktieren'}
      </button>
    </span>
  );
};

const LabeledText = ({ label, value, onChange, rows=4, spell=true }) => {
  const ref = useRef(null);
  const append = (t) => {
    const el = ref.current;
    if (el && typeof el.selectionStart === 'number') {
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const newValue = value.slice(0, start) + t + value.slice(end);
      onChange({ target: { value: newValue } });
      // move caret to end of inserted text
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = start + t.length;
      });
    } else {
      onChange({ target: { value: (value || '') + (t || '') } });
    }
  };
  return (
    <div className="form-group">
      <label style={{ display: 'flex', alignItems: 'center' }}>
        <span style={{ flex: 1 }}>{label}</span>
        <MicButton onAppend={append} />
      </label>
      <textarea
        ref={ref}
        rows={rows}
        value={value}
        onChange={onChange}
        spellCheck={spell}
        lang="de-CH"
        style={{ width: '100%' }}
      />
    </div>
  );
};

const Briefe = ({ selectedPatient, onClose, onMinimize, initialState }) => {
  const { user, tenantMeta } = useSession();
  const [type, setType] = useState('ARZTBRIEF');
  const [letters, setLetters] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [current, setCurrent] = useState(null); // active letter object

  useEffect(() => {
    if (!selectedPatient?.id) return;
    (async () => {
      setBusy(true); setError('');
      try {
        const items = await listLetters(selectedPatient.id);
        setLetters(items);
      } catch { setError('Briefe konnten nicht geladen werden.'); }
      finally { setBusy(false); }
    })();
  }, [selectedPatient?.id]);

  useEffect(() => {
    if (initialState && !current) {
      setType(initialState.type || 'ARZTBRIEF');
    }
  }, [initialState, current]);

  const ensureCurrent = async () => {
    if (current) return current;
    const content = defaultContentFor(type, selectedPatient, user, tenantMeta?.clinic?.address?.city);
    const title = `${TYPES.find(t => t.value===type)?.label?.split(' (')[0] || 'Brief'} – ${selectedPatient?.nachname || ''} ${selectedPatient?.vorname || ''}`.trim();
    setBusy(true); setError('');
    try {
      const created = await createLetter({ patient_id: selectedPatient.id, type, title, content });
      setLetters((prev) => [created, ...prev]);
      setCurrent({ ...created, content });
      return created;
    } catch (e) {
      setError(e?.message || 'Neuer Brief konnte nicht erstellt werden');
      return null;
    } finally { setBusy(false); }
  };

  const handleSaveDraft = async () => {
    const cur = current || await ensureCurrent();
    if (!cur) return;
    setBusy(true); setError('');
    try {
      const updated = await updateLetter(cur.id, { title: cur.title, type: cur.type, content: cur.content, status: 'DRAFT' });
      setCurrent(updated || cur);
      if (updated) {
        setLetters((list) => list.map((l) => (l.id === updated.id ? { ...l, title: updated.title, type: updated.type, status: updated.status, updated_at: updated.updated_at } : l)));
      }
      alert('Entwurf gespeichert');
    } catch (e) { setError(e?.message || 'Speichern fehlgeschlagen'); }
    finally { setBusy(false); }
  };

  const handleFinalize = async () => {
    const cur = current || await ensureCurrent();
    if (!cur) return;
    if (!window.confirm('Brief finalisieren und PDF erzeugen?')) return;
    setBusy(true); setError('');
    try {
      const resp = await finalizeLetter(cur.id);
      const updated = resp?.letter || cur;
      setCurrent({ ...updated, content: cur.content });
      setLetters((list) => list.map(l => l.id === updated.id ? updated : l));
      if (resp?.pdf) window.open(resp.pdf, '_blank', 'noopener');
    } catch (e) {
      setError(e?.message || 'Finalisieren fehlgeschlagen');
    } finally { setBusy(false); }
  };

  const isFinal = current?.status === 'FINAL';

  // Editors per type
  const s = (k) => current?.content?.sections?.[k] || '';
  const setS = (k, v) => setCurrent((prev) => ({ ...prev, content: { ...prev.content, sections: { ...prev.content.sections, [k]: v } } }));

  const renderEditor = () => {
    const disabled = isFinal;
    const onChange = (k) => (e) => setS(k, e.target.value);
    const field = (label, key, rows=4) => (
      <LabeledText label={label} value={s(key)} onChange={onChange(key)} rows={rows} spell={!disabled} />
    );
    switch ((current?.type || type)) {
      case 'OP_BERICHT':
        return (
          <>
            {field('Datum der Operation', 'opDate', 2)}
            {field('Operateur, Assistenz, Anästhesieform', 'opTeam', 3)}
            {field('Diagnose präoperativ', 'preDiag', 3)}
            {field('Diagnose postoperativ', 'postDiag', 3)}
            {field('Eingriff / Operation', 'opTitle', 3)}
            {field('Indikation zur Operation', 'indication', 3)}
            {field('Präoperativer Status', 'preStatus', 3)}
            {field('Operationsverlauf', 'opCourse', 6)}
            {field('Intraoperative Befunde', 'intraFindings', 4)}
            {field('Verwendetes Material / Implantate', 'materials', 3)}
            {field('Blutverlust, besondere Vorkommnisse', 'bloodLoss', 3)}
            {field('Komplikationen', 'complications', 3)}
            {field('Postoperatives Regime / Anordnungen', 'postRegime', 4)}
            {field('Abschluss / Besonderheiten', 'conclusion', 4)}
          </>
        );
      case 'ZUWEISUNG':
        return (
          <>
            {field('Grund der Zuweisung', 'reason', 4)}
            {field('Relevante Vorbefunde', 'priorFindings', 4)}
            {field('Fragestellung', 'question', 4)}
          </>
        );
      case 'VERSICHERUNGSBRIEF':
        return (
          <>
            {field('Diagnosen', 'diagnoses', 4)}
            {field('Kurze Anamnese', 'history', 4)}
            {field('Verlauf / aktuelle Situation', 'course', 4)}
            {field('Arbeitsfähigkeit', 'workCapacity', 3)}
            {field('Prognose (keine juristischen Bewertungen)', 'prognosis', 3)}
          </>
        );
      case 'SONSTIGER_BRIEF':
        return (
          <>
            {field('Betreff', 'subject', 2)}
            {field('Anrede', 'salutation', 2)}
            {field('Text', 'text', 10)}
            {field('Schlussformel', 'closing', 3)}
          </>
        );
      case 'AUSTRITTSBERICHT':
      case 'ARZTBRIEF':
      default:
        return (
          <>
            {field('Grund der Konsultation / Hospitalisation', 'reason', 3)}
            {field('Relevante Anamnese', 'history', 4)}
            {field('Status / klinische Befunde', 'findings', 4)}
            {field('Diagnostik / Untersuchungen', 'diagnostics', 4)}
            {field('Diagnosen (Haupt-/Nebendiagnosen)', 'diagnoses', 4)}
            {field('Verlauf / Therapie', 'course', 4)}
            {field('Medikation aktuell / bei Austritt', 'medication', 4)}
            {field('Empfehlungen / weiteres Vorgehen', 'recommendations', 4)}
            {field('Arbeitsfähigkeit', 'workCapacity', 3)}
            {field('Freitext / Bemerkungen', 'notes', 4)}
          </>
        );
    }
  };

  const runGrammarCheck = async () => {
    const LT = process.env.REACT_APP_LT_API_URL || '';
    if (!LT) {
      alert('Grammatikprüfung ist nicht konfiguriert (REACT_APP_LT_API_URL) – die Browser-Rechtschreibprüfung ist aktiv.');
      return;
    }
    const text = Object.values(current?.content?.sections || {}).filter(Boolean).join('\n\n');
    if (!text.trim()) { alert('Kein Text zum Prüfen.'); return; }
    try {
      const form = new URLSearchParams();
      form.set('text', text);
      form.set('language', 'de-CH');
      const res = await fetch(`${LT.replace(/\/+$/,'')}/v2/check`, { method: 'POST', body: form });
      const data = await res.json();
      const matches = Array.isArray(data?.matches) ? data.matches : [];
      if (!matches.length) { alert('Keine Fehler gefunden.'); return; }
      const first = matches.slice(0, 10).map((m) => `• ${m.message} (${m.replacements?.[0]?.value || '-'})`).join('\n');
      alert(`Gefundene Hinweise (${matches.length}):\n${first}${matches.length>10?'\n…':''}`);
    } catch {
      alert('Prüfung fehlgeschlagen.');
    }
  };

  const startNewWithType = async () => {
    setCurrent(null);
    await ensureCurrent();
  };

  return (
    <div className="popup-overlay">
      <div className="popup-container" style={{ maxWidth: '96vw', width: '96vw', maxHeight: '95vh', overflow: 'auto' }}>
        <h2 className="h2" style={{ margin: 0 }}>
          📨 Briefe für {selectedPatient?.vorname} {selectedPatient?.nachname}
        </h2>
        <div className="title-actions" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          {onMinimize && (
            <button className="btn-save" onClick={() => onMinimize({ type, current })} title="Als Tab" type="button">Als Tab</button>
          )}
          <button className="btn-cancel" onClick={() => onClose?.()} title="Schließen" type="button">❌</button>
        </div>
        <br />
        <hr />

        {error && <div role="alert" style={{ color: '#b91c1c' }}>{error}</div>}
        {busy && <div>Bitte warten…</div>}

        <div style={{ display: 'flex', gap: 16 }}>
          <div style={{ flex: 1 }}>
            <label>Briefart</label>
            <select value={current?.type || type} onChange={(e) => current ? setCurrent({ ...current, type: e.target.value }) : setType(e.target.value)}>
              {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <button style={{ marginLeft: 8 }} className="btn-save" onClick={startNewWithType}>Neuer Brief</button>

            <div style={{ marginTop: 16 }}>
              <label>Titel</label>
              <input type="text" value={current?.title || ''} onChange={(e) => setCurrent((prev) => prev ? { ...prev, title: e.target.value } : prev)} disabled={current?.status === 'FINAL'} style={{ width: '100%' }} />
            </div>

            <div style={{ marginTop: 16 }}>
              <strong>Patientendaten</strong>
              <div style={{ fontSize: 13, color: '#4b5563', marginTop: 4 }}>
                {selectedPatient?.vorname} {selectedPatient?.nachname}{selectedPatient?.geburtsdatum ? `, geb. ${new Date(selectedPatient.geburtsdatum).toLocaleDateString('de-CH')}` : ''}
                <br/>{selectedPatient?.adresse || ''}
                <br/>{selectedPatient?.versichertennummer ? `Versichertennummer: ${selectedPatient.versichertennummer}` : ''}
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              <label>Empfänger</label>
              <input type="text" placeholder="Name / Institution" value={current?.content?.recipient?.name || ''} onChange={(e) => setCurrent((prev) => ({ ...prev, content: { ...prev.content, recipient: { ...(prev.content?.recipient||{}), name: e.target.value } } }))} disabled={current?.status === 'FINAL'} style={{ width: '100%' }} />
              <textarea rows={3} placeholder="Adresse" value={current?.content?.recipient?.address || ''} onChange={(e) => setCurrent((prev) => ({ ...prev, content: { ...prev.content, recipient: { ...(prev.content?.recipient||{}), address: e.target.value } } }))} disabled={current?.status === 'FINAL'} style={{ width: '100%' }} spellCheck lang="de-CH" />
            </div>

            <div style={{ marginTop: 16 }}>
              {current ? renderEditor() : <div style={{ color: '#6b7280' }}>Neuen Brief anlegen oder vorhandenen wählen…</div>}
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 16, alignItems: 'center' }}>
              <button className="btn-save" disabled={!selectedPatient} onClick={handleSaveDraft}>Speichern (Entwurf)</button>
              <button className="btn-save" disabled={!selectedPatient} onClick={handleFinalize}>Finalisieren & PDF</button>
              <button className="btn-save" type="button" onClick={runGrammarCheck}>Text prüfen</button>
              {current?.id && current?.pdf_path && (
                <button className="btn-save" type="button" onClick={() => window.open(letterPdfUrl(current.id, true), '_blank', 'noopener')}>PDF anzeigen</button>
              )}
              {current?.id && (
                <button
                  className="btn-cancel"
                  type="button"
                  disabled={current?.status === 'FINAL'}
                  title={current?.status === 'FINAL' ? 'Finalisierte Briefe können nicht gelöscht werden' : 'Entwurf löschen'}
                  onClick={async () => {
                    if (!window.confirm('Diesen Brief löschen?')) return;
                    try {
                      await deleteLetter(current.id);
                      setLetters((list) => list.filter((x) => x.id !== current.id));
                      setCurrent(null);
                    } catch (e) {
                      alert(e?.message || 'Löschen fehlgeschlagen');
                    }
                  }}
                >
                  Löschen
                </button>
              )}
            </div>
          </div>

          <div style={{ width: 380 }}>
            <strong>Vorhandene Briefe</strong>
            <table className="table" style={{ width: '100%', marginTop: 6 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Datum</th>
                  <th style={{ textAlign: 'left' }}>Art</th>
                  <th style={{ textAlign: 'left' }}>Titel</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {letters.map((l) => (
                  <tr
                    key={l.id}
                    style={{ cursor: 'pointer' }}
                    onClick={async () => {
                      try {
                        const full = await getLetter(l.id);
                        if (full) setCurrent(full);
                      } catch (_) {
                        setCurrent({ ...l, content: l.content || defaultContentFor(l.type, selectedPatient, user, tenantMeta?.clinic?.address?.city) });
                      }
                    }}
                  >
                    <td>{new Date(l.created_at).toLocaleDateString('de-CH')}</td>
                    <td>{TYPES.find(t => t.value===l.type)?.label?.split(' (')[0] || l.type}</td>
                    <td title={l.title}>{(l.title||'').slice(0,18)}</td>
                    <td>{l.status}</td>
                  </tr>
                ))}
                {letters.length === 0 && (
                  <tr><td colSpan={4} style={{ color: '#6b7280' }}>Keine Briefe vorhanden.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Briefe;
