import React, { useEffect, useState } from 'react';
import { searchPatients } from './api';

// Generic patient search field by name with dropdown selection.
// Props:
// - value: current patient object or null
// - onChange(patient | null)
// - placeholder: optional input placeholder
export default function PatientSearchInput({ value, onChange, placeholder = 'Patient suchen…' }) {
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let t;
    const run = async () => {
      const q = query.trim();
      if (q.length < 2) { setOptions([]); return; }
      try {
        const list = await searchPatients(q);
        setOptions(Array.isArray(list) ? list.slice(0, 10) : []);
      } catch {
        setOptions([]);
      }
    };
    t = setTimeout(run, 250);
    return () => { if (t) clearTimeout(t); };
  }, [query]);

  const handleSelect = (p) => {
    if (onChange) onChange(p || null);
    setQuery('');
    setOptions([]);
    setOpen(false);
  };

  return (
    <div style={{ position: 'relative' }}>
      <input
        type="text"
        placeholder={placeholder}
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => { if (options.length) setOpen(true); }}
        style={{ width: '100%' }}
      />
      {open && options.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, maxHeight: 180, overflowY: 'auto', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, zIndex: 20 }}>
          {options.map((p) => (
            <div
              key={p.id}
              onClick={() => handleSelect(p)}
              style={{ padding: 6, cursor: 'pointer' }}
            >
              #{p.id} · {[p.vorname, p.nachname].filter(Boolean).join(' ') || p.name || ''}
            </div>
          ))}
        </div>
      )}
      {value && (
        <div style={{ marginTop: 4, fontSize: 12, color: '#111827' }}>
          Ausgewählt: #{value.id} · {[value.vorname, value.nachname].filter(Boolean).join(' ') || value.name || ''}
          <button
            type="button"
            onClick={() => handleSelect(null)}
            style={{ marginLeft: 8, background: 'transparent', border: 0, cursor: 'pointer', color: '#ef4444' }}
          >
            Entfernen
          </button>
        </div>
      )}
    </div>
  );
}

