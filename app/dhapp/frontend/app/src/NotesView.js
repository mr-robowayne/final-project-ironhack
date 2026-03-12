import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import { listNotes, getNote, createNote, updateNote, lockNote, deleteNote, searchPatients } from './api';
import { sanitizeRichTextToPlainText } from './utils/textSanitizer';

const COLORS = ['YELLOW','BLUE','GREEN','RED','PURPLE','GRAY'];

// Dictation helper (Web Speech API)
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
        if (res && res.isFinal && typeof onResult === 'function') onResult(text, e);
      } catch (_) {}
    };
    rec.onend = () => { setActive(false); };
    rec.onerror = () => { setActive(false); };
    recRef.current = rec;
    setActive(true);
    try { rec.start(); } catch { setActive(false); }
  };
  const stop = () => { try { recRef.current?.stop(); } catch {} finally { setActive(false); } };
  return { supported: Boolean(supported), active, start, stop };
}

const MicButton = ({ onAppend }) => {
  const { supported, active, start, stop } = useDictation();
  if (!supported) return null;
  const handleStart = (e) => { e.preventDefault(); start((t) => onAppend?.(t)); };
  const handleStop = (e) => { e.preventDefault(); stop(); };
  return (
    <button type="button" onMouseDown={handleStart} onMouseUp={handleStop} title="Drücken zum Diktieren" style={{ padding: '2px 8px', borderRadius: 8, border: '1px solid #cbd5e1', background: active ? '#fee2e2' : '#ffffff', cursor: 'pointer' }}>
      {active ? '🎙️ Aufnahme…' : '🎤 Diktieren'}
    </button>
  );
};

function TagChips({ value = [], onChange }) {
  const [input, setInput] = useState('');
  const add = (t) => {
    const v = String(t || '').trim();
    if (!v) return;
    const next = Array.from(new Set([...(value || []).map(String), v]));
    onChange?.(next);
    setInput('');
  };
  const remove = (t) => {
    onChange?.((value || []).filter((x) => x !== t));
  };
  const onKey = (e) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(input); }
  };
  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
        {(value || []).map((t) => (
          <span key={t} style={{ background: '#e5e7eb', color: '#111827', padding: '2px 8px', borderRadius: 12 }}>
            {t}
            <button onClick={() => remove(t)} style={{ marginLeft: 6, background: 'transparent', border: 0, cursor: 'pointer' }} title="Entfernen">×</button>
          </span>
        ))}
      </div>
      <input type="text" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onKey} placeholder="Tag hinzufügen…" />
      <button className="btn-save" onClick={() => add(input)} style={{ marginLeft: 6 }}>Hinzufügen</button>
    </div>
  );
}

function PatientPicker({ value, onChange }) {
  const [q, setQ] = useState('');
  const [opts, setOpts] = useState([]);
  useEffect(() => {
    let t;
    const run = async () => {
      if (q.trim().length < 2) { setOpts([]); return; }
      try {
        const list = await searchPatients(q.trim());
        setOpts(Array.isArray(list) ? list.slice(0, 10) : []);
      } catch (_) { setOpts([]); }
    };
    t = setTimeout(run, 250);
    return () => { if (t) clearTimeout(t); };
  }, [q]);
  return (
    <div>
      <input type="text" placeholder="Patient suchen…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div style={{ maxHeight: 150, overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: 6, marginTop: 6 }}>
        {opts.map((p) => (
          <div key={p.id} onClick={() => { onChange?.(p); setQ(''); setOpts([]); }} style={{ padding: 6, cursor: 'pointer' }}>
            #{p.id} · {p.vorname} {p.nachname} {p.geburtsdatum ? `(${new Date(p.geburtsdatum).toLocaleDateString()})` : ''}
          </div>
        ))}
        {opts.length === 0 && q.trim().length >= 2 && <div style={{ padding: 6, color: '#6b7280' }}>Keine Treffer</div>}
      </div>
      {value && (
        <div style={{ marginTop: 6, color: '#111827' }}>Ausgewählt: #{value.id} · {value.vorname} {value.nachname}</div>
      )}
    </div>
  );
}

export default function NotesView({ user, onClose, preset = {} }) {
  const [tab, setTab] = useState(preset.visibilityType || 'PERSONAL'); // PERSONAL|PRACTICE|PATIENT
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null); // note object
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [allTags, setAllTags] = useState([]);
  const [activeTag, setActiveTag] = useState('');
  const [patient, setPatient] = useState(preset.patient || null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);

  const smallTabButton = { padding: '4px 10px', fontSize: 13, borderRadius: 10 };
  const smallFilterButton = { padding: '3px 8px', fontSize: 12, borderRadius: 10 };
  const smallActionButton = { padding: '4px 8px', fontSize: 12, borderRadius: 8 };

  const refresh = async () => {
    setLoading(true); setError('');
    try {
      const list = await listNotes({ visibilityType: tab, patientId: tab === 'PATIENT' ? (patient?.id || preset.patientId) : undefined, search, tag: activeTag, limit: 200 });
      setItems(list);
      // Build tag list
      const tags = new Set();
      list.forEach(n => (n.tags || []).forEach(t => tags.add(t)));
      setAllTags(Array.from(tags).sort((a,b) => a.localeCompare(b)));
    } catch (e) {
      setError(e?.message || 'Notizen konnten nicht geladen werden');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [tab, patient?.id, activeTag, search]);

  const open = async (note) => {
    try {
      const dto = await getNote(note.id);
      setSelected(dto?.note || note);
    } catch (e) {
      alert(e?.message || 'Notiz konnte nicht geladen werden');
    }
  };

  const addNew = async () => {
    try {
      const payload = { title: 'Neue Notiz', content: '', visibilityType: tab, pinned: false };
      if (tab === 'PATIENT') {
        const pid = patient?.id || preset.patientId || null;
        if (!pid) {
          alert('Bitte zuerst einen Patienten für die Notiz auswählen.');
          return;
        }
        payload.patientId = pid;
      }
      const row = await createNote(payload);
      setItems((prev) => [row, ...prev]);
      setSelected(row);
    } catch (e) {
      alert(e?.message || 'Notiz konnte nicht erstellt werden');
    }
  };

  // Autosave logic for selected note (title/content/tags/color/pinned)
  useEffect(() => {
    if (!selected || selected.locked) return;
    let t;
    const run = async () => {
      try {
        setSaving(true);
        const patch = {
          title: selected.title,
          content: selected.content,
          tags: selected.tags || null,
          color: selected.color || null,
          pinned: !!selected.pinned,
        };
        const updated = await updateNote(selected.id, patch);
        setSavedAt(new Date());
        // Update list item
        setItems((list) => list.map((n) => (n.id === updated.id ? { ...n, ...updated } : n)));
      } catch (_) { /* ignore transient */ }
      finally { setSaving(false); }
    };
    t = setTimeout(run, 800);
    return () => { if (t) clearTimeout(t); };
  }, [selected?.title, selected?.content, (selected?.tags||[]).join(','), selected?.color, selected?.pinned]);

  const togglePin = async (note) => {
    try {
      const updated = await updateNote(note.id, { pinned: !note.pinned });
      setItems((list) => list.map((n) => (n.id === updated.id ? { ...n, ...updated } : n)));
      if (selected?.id === note.id) setSelected((s) => ({ ...s, ...updated }));
    } catch (e) { alert(e?.message || 'Pin fehlgeschlagen'); }
  };

  const doLock = async (note) => {
    if (!window.confirm('Diese Notiz wird gesperrt und ist danach nur noch lesbar. Fortfahren?')) return;
    try {
      const updated = await lockNote(note.id);
      setItems((list) => list.map((n) => (n.id === updated.id ? { ...n, ...updated } : n)));
      if (selected?.id === note.id) setSelected((s) => ({ ...s, ...updated }));
    } catch (e) { alert(e?.message || 'Sperren fehlgeschlagen'); }
  };

  const doDelete = async (note) => {
    if (!window.confirm('Notiz in den Papierkorb verschieben?')) return;
    try {
      await deleteNote(note.id);
      setItems((list) => list.filter((n) => n.id !== note.id));
      if (selected?.id === note.id) setSelected(null);
    } catch (e) { alert(e?.message || 'Löschen fehlgeschlagen'); }
  };

  const doSave = async () => {
    if (!selected || selected.locked) return;
    try {
      setSaving(true);
      const patch = {
        title: selected.title,
        content: selected.content,
        tags: selected.tags || null,
        color: selected.color || null,
        pinned: !!selected.pinned,
      };
      const updated = await updateNote(selected.id, patch);
      setSavedAt(new Date());
      setItems((list) => list.map((n) => (n.id === updated.id ? { ...n, ...updated } : n)));
      setSelected((s) => ({ ...s, ...updated }));
    } catch (e) {
      alert(e?.message || 'Speichern fehlgeschlagen');
    } finally { setSaving(false); }
  };

  const quillModules = useMemo(() => ({
    toolbar: [
      [{ header: [1, 2, 3, false] }],
      ['bold', 'italic', 'underline', 'strike'],
      [{ list: 'ordered' }, { list: 'bullet' }],
      ['clean'],
      ['blockquote', 'code-block'],
      [{ align: [] }]
    ]
  }), []);

  const colorDot = (c) => ({
    display: 'inline-block', width: 10, height: 10,
    borderRadius: 999, background: (
      c === 'YELLOW' ? '#fde047' : c === 'BLUE' ? '#60a5fa' : c === 'GREEN' ? '#4ade80' : c === 'RED' ? '#f87171' : c === 'PURPLE' ? '#c084fc' : '#9ca3af'
    )
  });

  const panel = { background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 10 };

  return (
    <div className="popup-overlay" onClick={onClose} style={{ zIndex: 10001 }}>
      <div
        className="popup-container wide-popup"
        onClick={(e) => e.stopPropagation()}
        style={{ width: '90vw', maxWidth: 1800 }}
      >
        <h2 className="h2" style={{ margin: 0 }}>Notizen</h2>
        <div className="title-actions" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <button className="btn-cancel" onClick={onClose}>Schließen</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '320px 480px 1fr', gap: 16, marginTop: 12 }}>
          {/* Left: Filters */}
          <div style={{ ...panel }}>
            <div style={{ display: 'flex', gap: 6 }}>
              {['PERSONAL','PRACTICE','PATIENT'].map((t) => (
                <button
                  key={t}
                  className={tab === t ? 'btn-save' : 'btn'}
                  onClick={() => setTab(t)}
                  style={smallTabButton}
                >
                  {t === 'PERSONAL' ? 'Meine' : t === 'PRACTICE' ? 'Praxis' : 'Patienten'}
                </button>
              ))}
            </div>
            <div style={{ marginTop: 8 }}>
              <input type="text" placeholder="Suchen…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div style={{ marginTop: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Tags</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 220, overflowY: 'auto' }}>
                <button
                  className={!activeTag ? 'btn-save' : 'btn'}
                  onClick={() => setActiveTag('')}
                  style={smallFilterButton}
                >
                  Alle
                </button>
                {allTags.map((t) => (
                  <button
                    key={t}
                    className={activeTag === t ? 'btn-save' : 'btn'}
                    onClick={() => setActiveTag(t)}
                    style={smallFilterButton}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
            {tab === 'PATIENT' && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>Patient</div>
                <PatientPicker value={patient} onChange={setPatient} />
              </div>
            )}
            <div style={{ marginTop: 12 }}>
              <button className="btn-save" onClick={addNew} style={smallActionButton}>+ Neue Notiz</button>
            </div>
          </div>

          {/* Middle: List */}
          <div style={{ ...panel }}>
            {loading ? <div>Laden…</div> : null}
            {error ? <div style={{ color: '#dc2626' }}>{error}</div> : null}
            <div style={{ maxHeight: 600, overflowY: 'auto' }}>
              {items.map((n) => (
                <div key={n.id} onClick={() => open(n)} style={{ padding: 8, borderRadius: 8, border: '1px solid #e5e7eb', marginBottom: 6, cursor: 'pointer', background: selected?.id === n.id ? '#eef2ff' : 'white' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={colorDot(n.color)}></span>
                    <span style={{ fontWeight: 600, flex: 1 }}>{n.title || '(ohne Titel)'}</span>
                    {n.pinned ? <span title="angeheftet">📌</span> : null}
                    {n.locked ? <span title="gesperrt">🔒</span> : null}
                  </div>
                  <div style={{ color: '#6b7280', fontSize: 12, marginTop: 4 }}>{n.updated_at ? new Date(n.updated_at).toLocaleString() : ''}</div>
                  <div style={{ color: '#374151', fontSize: 12, marginTop: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {sanitizeRichTextToPlainText(n.content || '', 140)}
                  </div>
                </div>
              ))}
              {!items.length && <div style={{ color: '#6b7280' }}>Keine Notizen</div>}
            </div>
          </div>

          {/* Right: Editor */}
          <div style={{ ...panel }}>
            {!selected && (
              <div style={{ color: '#6b7280' }}>Wähle eine Notiz aus oder erstelle eine neue.</div>
            )}
            {selected && (
              <div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input type="text" value={selected.title || ''} onChange={(e) => setSelected((s) => ({ ...s, title: e.target.value }))} placeholder="Titel" disabled={selected.locked} style={{ fontSize: 18, fontWeight: 600, flex: 1 }} />
                  <div style={{ display: 'inline-flex', gap: 6 }}>
                    <button className="btn-save" onClick={doSave} disabled={selected.locked || saving} style={smallActionButton}>Speichern</button>
                    <button className="btn" onClick={() => togglePin(selected)} title={selected.pinned ? 'Lösen' : 'Anheften'} style={smallActionButton}>{selected.pinned ? '📌' : '📍'}</button>
                    <button className="btn" onClick={() => doLock(selected)} title="Sperren" disabled={selected.locked} style={smallActionButton}>🔒</button>
                    <button className="btn-cancel" onClick={() => doDelete(selected)} title="Löschen" style={smallActionButton}>🗑️</button>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 6, alignItems: 'center', margin: '6px 0' }}>
                  <span>Farbe:</span>
                  {COLORS.map((c) => (
                    <button key={c} onClick={() => !selected.locked && setSelected((s) => ({ ...s, color: c }))} title={c} style={{ width: 18, height: 18, borderRadius: 999, border: '1px solid #cbd5e1', background: colorDot(c).background }} />
                  ))}
                  <span style={{ marginLeft: 'auto', fontSize: 12, color: '#6b7280' }}>
                    {saving ? 'Speichern…' : savedAt ? `Gespeichert ${savedAt.toLocaleTimeString()}` : ''}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontWeight: 600 }}>Tags</span>
                  <TagChips value={selected.tags || []} onChange={(tags) => setSelected((s) => ({ ...s, tags }))} />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '6px 0' }}>
                  <span style={{ fontWeight: 600 }}>Editor</span>
                  <MicButton onAppend={(t) => setSelected((s) => ({ ...s, content: (s.content || '') + ` ${t}` }))} />
                </div>

                <ReactQuill
                  value={selected.content || ''}
                  onChange={(html) => setSelected((s) => ({ ...s, content: html }))}
                  readOnly={selected.locked}
                  modules={quillModules}
                  theme="snow"
                />
                {selected.locked && (
                  <div style={{ marginTop: 6, color: '#b91c1c' }}>Diese Notiz ist gesperrt.</div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
