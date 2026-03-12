import React, { useEffect, useState } from 'react';
import { listFiles, downloadFile } from './api/patientFiles';

function isImage(name='') {
  return /\.(png|jpg|jpeg|gif|webp)$/i.test(name);
}

export default function PatientMediaGallery({ patient, onClose }) {
  const [files, setFiles] = useState([]);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null);

  const load = async () => {
    try { const list = await listFiles(patient.id); setFiles(Array.isArray(list) ? list : []); } catch (e) { setError(e?.message || 'Dateien konnten nicht geladen werden'); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [patient?.id]);

  const openPreview = async (name) => {
    try {
      const blob = await downloadFile(patient.id, name);
      const url = URL.createObjectURL(blob);
      setPreview({ name, url });
    } catch (e) {
      alert('Vorschau nicht möglich');
    }
  };

  return (
    <div className="popup-overlay">
      <div className="popup-container wide-popup">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 className="h2" style={{ margin: 0 }}>🖼️ Medien: {patient?.vorname} {patient?.nachname}</h2>
          <button className="btn-cancel" onClick={() => onClose?.()} title="Schließen" type="button">❌</button>
        </div>
        <hr />
        {error && <div style={{ color: 'crimson' }}>{error}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8 }}>
          {files.filter(f => isImage(f.name)).map(f => (
            <div key={f.name} style={{ border: '1px solid #e5e7eb', borderRadius: 6, overflow: 'hidden', cursor: 'pointer' }} onClick={() => openPreview(f.name)}>
              <div style={{ paddingTop: '56%', position: 'relative', background: '#f3f4f6' }}>
                <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280' }}>{f.name}</span>
              </div>
            </div>
          ))}
        </div>
        {!!files.filter(f => !isImage(f.name)).length && (
          <div style={{ marginTop: 12 }}>
            <h3>Andere Dateien</h3>
            {files.filter(f => !isImage(f.name)).map(f => (
              <div key={f.name}>
                {f.name}
              </div>
            ))}
          </div>
        )}
        {preview && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => { URL.revokeObjectURL(preview.url); setPreview(null); }}>
            <img alt={preview.name} src={preview.url} style={{ maxWidth: '90vw', maxHeight: '90vh', background: '#fff', padding: 8, borderRadius: 8 }} />
          </div>
        )}
      </div>
    </div>
  );
}

