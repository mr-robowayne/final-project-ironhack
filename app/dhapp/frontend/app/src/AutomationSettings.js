import React, { useEffect, useState } from 'react';
import api from './api';

export default function AutomationSettings({ onClose }) {
  const [enabled, setEnabled] = useState(true);
  const [offsetsCsv, setOffsetsCsv] = useState('1440,120');
  const [labResult, setLabResult] = useState(true);
  const [discharge, setDischarge] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const { data } = await api.get('/api/settings/automation');
        const s = data?.settings || {};
        const defs = Array.isArray(s?.reminders?.defaults) ? s.reminders.defaults : [];
        setEnabled(Boolean(s?.reminders?.enabled ?? true));
        setOffsetsCsv(defs.map(d => Number(d?.offsetMinutes) || 0).filter(n => n>0).join(','));
        setLabResult(Boolean(s?.autoTasks?.labResult ?? true));
        setDischarge(Boolean(s?.autoTasks?.discharge ?? true));
      } catch (e) {
        setError(e?.message || 'Einstellungen konnten nicht geladen werden');
      }
    };
    load();
  }, []);

  const save = async () => {
    try {
      setSaving(true); setError('');
      const nums = String(offsetsCsv || '')
        .split(',')
        .map(s => Number(s.trim()))
        .filter(n => Number.isFinite(n) && n>0);
      const payload = {
        reminders: { enabled, defaults: nums.map(n => ({ offsetMinutes: n, channel: 'INTERNAL' })) },
        autoTasks: { labResult, discharge }
      };
      const { data } = await api.patch('/api/settings/automation', payload);
      if (!data?.settings) throw new Error('Unerwartete Antwort');
      onClose?.();
    } catch (e) {
      setError(e?.message || 'Speichern fehlgeschlagen');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="popup-overlay">
      <div className="popup-container wide-popup">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 className="h2" style={{ margin: 0 }}>⚙️ Praxis-Automation</h2>
          <button className="btn-cancel" onClick={() => onClose?.()} title="Schließen" type="button">❌</button>
        </div>
        <hr />
        {error && <div style={{ color: 'crimson', marginBottom: 8 }}>{error}</div>}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12, alignItems: 'center' }}>
          <label>Terminerinnerungen aktiv</label>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />

          <label>Offsets (Minuten, CSV)</label>
          <input type="text" value={offsetsCsv} onChange={(e) => setOffsetsCsv(e.target.value)} placeholder="z.B. 1440,120" />

          <label>Auto-Tasks: Laborbefund</label>
          <input type="checkbox" checked={labResult} onChange={(e) => setLabResult(e.target.checked)} />

          <label>Auto-Tasks: Entlassung</label>
          <input type="checkbox" checked={discharge} onChange={(e) => setDischarge(e.target.checked)} />
        </div>

        <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn-save" disabled={saving} onClick={save}>{saving ? 'Speichern…' : 'Speichern'}</button>
          <button className="btn-cancel" onClick={() => onClose?.()}>Abbrechen</button>
        </div>
      </div>
    </div>
  );
}

