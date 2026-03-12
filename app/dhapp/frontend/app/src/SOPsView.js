import React, { useEffect, useState } from 'react';
import { listSOPs, createSOP, updateSOP, lockSOP } from './api';

export default function SOPsView({ onClose, canEdit }) {
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editor, setEditor] = useState({ id: null, title: '', content: '' });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      setLoading(true); setError('');
      const list = await listSOPs({ search });
      setItems(list);
    } catch (e) {
      setError(e?.message || 'SOPs konnten nicht geladen werden');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const openEditor = (sop) => {
    setEditor({ id: sop?.id || null, title: sop?.title || '', content: sop?.content || '' });
  };
  const resetEditor = () => setEditor({ id: null, title: '', content: '' });

  const save = async () => {
    if (!editor.title.trim()) return;
    try {
      setSaving(true);
      if (editor.id) await updateSOP(editor.id, { title: editor.title, content: editor.content });
      else await createSOP({ title: editor.title, content: editor.content });
      resetEditor();
      await load();
    } catch (e) {
      alert(e?.response?.data?.message || e?.message || 'SOP konnte nicht gespeichert werden');
    } finally {
      setSaving(false);
    }
  };

  const lock = async (id) => {
    try { await lockSOP(id); await load(); } catch (e) { alert(e?.response?.data?.message || e?.message || 'SOP konnte nicht gesperrt werden'); }
  };

  return (
    <div className="popup-overlay">
      <div className="popup-container wide-popup">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 className="h2" style={{ margin: 0 }}>📘 SOPs</h2>
          <button className="btn-cancel" onClick={() => onClose?.()} title="Schließen" type="button">❌</button>
        </div>
        <hr />
        {error && <div style={{ color: 'crimson', marginBottom: 8 }}>{error}</div>}

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
          <input type="text" placeholder="Suche…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <button className="btn-save" onClick={load} disabled={loading}>{loading ? 'Lade…' : 'Aktualisieren'}</button>
          {canEdit && (
            <button className="btn-save" onClick={() => openEditor(null)}>Neu</button>
          )}
        </div>

        {editor && (canEdit ? (
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, marginBottom: 12 }}>
            <h3 style={{ marginTop: 0 }}>{editor.id ? 'SOP bearbeiten' : 'Neue SOP'}</h3>
            <input type="text" placeholder="Titel" value={editor.title} onChange={(e) => setEditor({ ...editor, title: e.target.value })} style={{ width: '100%', marginBottom: 8 }} />
            <textarea placeholder="Inhalt (HTML/Markdown)" value={editor.content} onChange={(e) => setEditor({ ...editor, content: e.target.value })} style={{ width: '100%', minHeight: 180 }} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
              <button className="btn-save" disabled={saving} onClick={save}>{saving ? 'Speichern…' : 'Speichern'}</button>
              <button className="btn-cancel" onClick={resetEditor}>Abbrechen</button>
            </div>
          </div>
        ) : null)}

        <div>
          {items.length === 0 && <div style={{ color: '#6b7280' }}>Keine SOPs</div>}
          {items.map(sop => (
            <div key={sop.id} style={{ padding: '8px 0', borderBottom: '1px dashed #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 600 }}>{sop.title} {sop.locked ? <span style={{ color: '#6b7280' }}>(gesperrt)</span> : null}</div>
                <div style={{ fontSize: 13, color: '#374151' }}>Version {sop.version} · letzte Änderung {new Date(sop.updated_at).toLocaleString('de-CH')}</div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn-save" onClick={() => openEditor(sop)} disabled={!canEdit}>Bearbeiten</button>
                <button className="btn-cancel" onClick={() => lock(sop.id)} disabled={!canEdit || sop.locked}>Sperren</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

