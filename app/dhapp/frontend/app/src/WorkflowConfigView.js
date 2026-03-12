import React, { useEffect, useState } from 'react';
import api from './api';

export default function WorkflowConfigView({ onClose }) {
  const [items, setItems] = useState([]);
  const [editor, setEditor] = useState({ id: null, name: '', description: '', triggerType: 'MANUAL', isActive: true, definitionJson: [] });
  const [rawSteps, setRawSteps] = useState('[\n  { "type": "CREATE_TASK", "parameters": { "title": "Auto Task", "priority": "NORMAL", "dueOffsetDays": 0 } }\n]');

  const load = async () => {
    try { const { data } = await api.get('/api/workflows'); setItems(data?.items || []); } catch {}
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    try {
      const definitionJson = JSON.parse(rawSteps);
      if (editor.id) await api.patch(`/api/workflows/${encodeURIComponent(editor.id)}`, { ...editor, definitionJson });
      else await api.post('/api/workflows', { ...editor, definitionJson });
      setEditor({ id: null, name: '', description: '', triggerType: 'MANUAL', isActive: true, definitionJson: [] });
      await load();
    } catch (e) {
      alert(e?.message || 'Speichern fehlgeschlagen (JSON gültig?)');
    }
  };

  return (
    <div className="popup-overlay">
      <div className="popup-container wide-popup">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 className="h2" style={{ margin: 0 }}>🔁 Workflow‑Konfiguration</h2>
          <button className="btn-cancel" onClick={() => onClose?.()} title="Schließen" type="button">❌</button>
        </div>
        <hr />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <h3>Bestehende Workflows</h3>
            {items.length === 0 && <div style={{ color: '#6b7280' }}>Keine Workflows</div>}
            {items.map(w => (
              <div key={w.id} style={{ borderBottom: '1px dashed #e5e7eb', padding: '6px 0' }}>
                <strong>{w.name}</strong> · {w.trigger_type} · {w.is_active ? 'aktiv' : 'inaktiv'}
                <div>
                  <button className="btn-save" onClick={() => { setEditor({ id: w.id, name: w.name, description: w.description||'', triggerType: w.trigger_type, isActive: w.is_active }); setRawSteps(JSON.stringify(w.definition_json || [], null, 2)); }}>Bearbeiten</button>
                </div>
              </div>
            ))}
          </div>
          <div>
            <h3>{editor.id ? 'Workflow bearbeiten' : 'Neuer Workflow'}</h3>
            <input type="text" placeholder="Name" value={editor.name} onChange={(e) => setEditor({ ...editor, name: e.target.value })} style={{ width: '100%', marginBottom: 6 }} />
            <input type="text" placeholder="Beschreibung" value={editor.description} onChange={(e) => setEditor({ ...editor, description: e.target.value })} style={{ width: '100%', marginBottom: 6 }} />
            <select value={editor.triggerType} onChange={(e) => setEditor({ ...editor, triggerType: e.target.value })}>
              {['NEW_PATIENT','NEW_LAB_RESULT','DISCHARGE','MANUAL'].map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <label style={{ marginLeft: 8 }}>
              <input type="checkbox" checked={editor.isActive} onChange={(e) => setEditor({ ...editor, isActive: e.target.checked })} /> aktiv
            </label>
            <div style={{ marginTop: 6 }}>
              <textarea value={rawSteps} onChange={(e) => setRawSteps(e.target.value)} style={{ width: '100%', minHeight: 220 }} />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 6 }}>
              <button className="btn-save" onClick={save}>Speichern</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

