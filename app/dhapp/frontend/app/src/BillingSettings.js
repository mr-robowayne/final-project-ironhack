import React, { useEffect, useMemo, useState } from 'react';
import api from './api';

const TEMPLATE = {
  enforce_point_value: true,
  pointValues: {
    KVG: { default: 0.92 },
    UVG: { default: 0.92 },
    IVG: { default: 0.92 },
    MVG: { default: 0.92 },
    VVG: { default: 0.92 },
    ORG: { default: 0.92 }
  }
};

const pretty = (obj) => JSON.stringify(obj, null, 2);

export default function BillingSettings({ onClose }) {
  const [jsonText, setJsonText] = useState(pretty(TEMPLATE));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);

  const parsed = useMemo(() => {
    try {
      return { ok: true, value: JSON.parse(jsonText || '{}') };
    } catch (e) {
      return { ok: false, error: e?.message || 'Ungültiges JSON' };
    }
  }, [jsonText]);

  useEffect(() => {
    const load = async () => {
      try {
        const { data } = await api.get('/api/settings/billing');
        const s = data?.settings || null;
        if (s) setJsonText(pretty(s));
        setLoaded(true);
      } catch (e) {
        setLoaded(true);
        setError(e?.message || 'Einstellungen konnten nicht geladen werden');
      }
    };
    load();
  }, []);

  const save = async () => {
    if (!parsed.ok) {
      setError(parsed.error || 'Ungültiges JSON');
      return;
    }
    try {
      setSaving(true);
      setError('');
      const payload = parsed.value && typeof parsed.value === 'object' ? parsed.value : {};
      const { data } = await api.patch('/api/settings/billing', payload);
      if (!data?.settings) throw new Error('Unerwartete Antwort');
      onClose?.();
    } catch (e) {
      setError(e?.response?.data?.message || e?.message || 'Speichern fehlgeschlagen');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="popup-overlay">
      <div className="popup-container wide-popup">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 className="h2" style={{ margin: 0 }}>Abrechnung – Punktwert (CHF/TP)</h2>
          <button className="btn-cancel" onClick={() => onClose?.()} title="Schließen" type="button">❌</button>
        </div>
        <hr />
        {error && <div style={{ color: 'crimson', marginBottom: 8 }}>{error}</div>}
        <div style={{ fontSize: 13, color: '#475569', marginBottom: 10 }}>
          Bei <code>enforce_point_value=true</code> überschreibt der Server den Punktwert beim Speichern/Export gemäss Mandanten-Konfiguration.
        </div>
        <textarea
          value={jsonText}
          onChange={(e) => setJsonText(e.target.value)}
          rows={18}
          style={{ width: '100%', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: 12 }}
          spellCheck={false}
          disabled={!loaded || saving}
        />
        {!parsed.ok && <div style={{ color: '#b45309', marginTop: 6 }}>JSON Fehler: {parsed.error}</div>}
        <div style={{ marginTop: 12, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn-cancel" disabled={saving} onClick={() => setJsonText(pretty(TEMPLATE))}>Template</button>
          <button className="btn-save" disabled={saving || !parsed.ok} onClick={save}>{saving ? 'Speichern…' : 'Speichern'}</button>
          <button className="btn-cancel" disabled={saving} onClick={() => onClose?.()}>Abbrechen</button>
        </div>
      </div>
    </div>
  );
}

