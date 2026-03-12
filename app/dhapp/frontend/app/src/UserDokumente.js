// src/UserDokumente.js
import React, { useEffect, useRef, useState } from "react";
import "./UserDokumente.css";
import { listFiles, uploadFile, downloadFile, deleteFile, resolvePatient } from './api/patientFiles';

/**
 * Props:
 *  - patient: { id, vorname, nachname }
 *  - onClose: () => void
 *  - API_BASE?: string
 *  - onUnauthorized?: () => void
 *  - onMinimize?: () => void
 *  - minimizeButtonClassName?: string   // z.B. "btn-save" oder "btn-cancel"
 *  - minimizeButtonContent?: ReactNode  // Icon/Text des Buttons
 *
 * APIs (unverändert):
 *   GET    /api/patient-files/:id
 *   POST   /api/upload-patient-file/:id             (FormData { file })
 *   GET    /api/download-patient-file/:id?name=...  (Preview/Download)
 *   DELETE /api/delete-patient-file/:id?name=...
 */

const DokumentePopup = ({
  patient,
  onClose,
  onMinimize,
  minimizeButtonClassName = "btn-save",
  minimizeButtonContent = "▢ Als Tab",
}) => {
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [viewer, setViewer] = useState(null); // { type, title, url?, text? }
  const objUrls = useRef([]);

  // ---------- Helpers ----------
  const fileTypeOf = (name = "") => {
    const n = name.toLowerCase();
    if (/\.(jpg|jpeg|png|gif|bmp|webp)$/i.test(n)) return "image";
    if (n.endsWith(".pdf")) return "pdf";
    if (n.endsWith(".txt")) return "text";
    if (n.endsWith(".docx")) return "docx";
    if (/\.(doc|xls|xlsx|ppt|pptx|odt|ods|odp)$/i.test(n)) return "office";
    if (/\.(mp4|webm|ogg)$/i.test(n)) return "video";
    if (/\.(mp3|wav|m4a|aac|oga)$/i.test(n)) return "audio";
    return "other";
  };

  const iconFor = (name) => {
    switch (fileTypeOf(name)) {
      case "image": return "🖼️";
      case "pdf":   return "📄";
      case "text":  return "📜";
      case "docx":  return "📝";
      case "office":return "📦";
      case "video": return "🎞️";
      case "audio": return "🎵";
      default:      return "📁";
    }
  };

  useEffect(() => {
    if (!patient?.id) return;
    (async () => {
      try {
        setBusy(true);
        setError('');
        await resolvePatient(patient.id).catch(() => {});
        const data = await listFiles(patient.id);
        setFiles(Array.isArray(data) ? data : (Array.isArray(data?.files) ? data.files : []));
      } catch (_) {
        setError('Dokumente konnten nicht geladen werden.');
      } finally {
        setBusy(false);
      }
    })();
  }, [patient?.id]);

  const normalizeFiles = (resp) => (
    Array.isArray(resp) ? resp : (Array.isArray(resp?.files) ? resp.files : [])
  );

  const onDrop = async (evt) => {
    evt.preventDefault();
    setIsDragOver(false);
    const file = evt.dataTransfer?.files?.[0];
    if (!file || !patient?.id) return;
    try {
      setBusy(true);
      setError('');
      await uploadFile(patient.id, file);
      const refreshed = await listFiles(patient.id);
      setFiles(normalizeFiles(refreshed));
    } catch (_) {
      setError('Upload fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  const onDragEnter = (e) => { e.preventDefault(); setIsDragOver(true); };
  const onDragOver = (e) => { e.preventDefault(); if (!isDragOver) setIsDragOver(true); };
  const onDragLeave = (e) => { e.preventDefault(); setIsDragOver(false); };

  const onBrowse = async (evt) => {
    const file = evt.target.files?.[0];
    if (!file || !patient?.id) return;
    try {
      setBusy(true);
      setError('');
      await uploadFile(patient.id, file);
      const refreshed = await listFiles(patient.id);
      setFiles(normalizeFiles(refreshed));
    } catch (_) {
      setError('Upload fehlgeschlagen.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const onDownload = async (name) => {
    if (!patient?.id) return;
    try {
      setBusy(true);
      setError('');
      const blob = await downloadFile(patient.id, name);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (_) {
      setError('Download nicht möglich (404?).');
    } finally {
      setBusy(false);
    }
  };

  const onPreview = async (name) => {
    if (!patient?.id) return;
    try {
      setBusy(true);
      setError('');
      const blob = await downloadFile(patient.id, name);
      const type = fileTypeOf(name);
      if (type === 'text') {
        const text = await blob.text();
        setViewer({ type: 'text', title: name, text });
      } else {
        const url = URL.createObjectURL(blob);
        objUrls.current.push(url);
        setViewer({ type, title: name, url, blobType: blob.type });
      }
    } catch (_) {
      setError('Vorschau nicht möglich.');
    } finally {
      setBusy(false);
    }
  };

  const closeViewer = () => {
    if (viewer?.url) {
      try { URL.revokeObjectURL(viewer.url); } catch {}
      objUrls.current = objUrls.current.filter((u) => u !== viewer.url);
    }
    setViewer(null);
  };

  const onDelete = async (name) => {
    if (!patient?.id) return;
    const ok = window.confirm('Möchten Sie dieses Dokument wirklich löschen?');
    if (!ok) return;
    try {
      setBusy(true);
      setError('');
      await deleteFile(patient.id, name);
      setFiles((prev) => prev.filter(f => f.name !== name));
    } catch (_) {
      setError('Löschen nicht möglich (Server unterstützt das evtl. nicht).');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="file-modal-overlay popup-overlay" role="dialog" aria-modal="true">
      <div className="file-modal apple-chrome popup-container">
        <h2 className="h2" style={{ margin: 0 }}>
          📁 Dokumente{patient?.vorname || patient?.nachname ? ` von ${patient?.vorname || ''} ${patient?.nachname || ''}` : ''}
        </h2>
        <div className="title-actions" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          {onMinimize && (
            <button className={minimizeButtonClassName} onClick={() => onMinimize?.()} title="Als Tab" type="button">{minimizeButtonContent}</button>
          )}
          <button className="btn-cancel" onClick={() => onClose?.()} title="Schließen" type="button">❌</button>
        </div>

        <section
          className={`docs-container${isDragOver ? ' dragover' : ''}`}
          onDrop={onDrop}
          onDragEnter={onDragEnter}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          aria-label="Benutzerdokumente"
        >
          <header className="docs-header">
            <h2>User-Dokumente</h2>
            <div className="docs-actions">
             
              <input
                ref={inputRef}
                type="file"
                onChange={onBrowse}
                aria-label="Datei auswählen"
                style={{ display: 'none' }}
              />
            </div>
          </header>

          <div
            className={`docs-dropzone${isDragOver ? ' dragover' : ''}`}
            role="button"
            tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click(); }}
            aria-label="Datei ziehen und hier ablegen oder klicken zum Auswählen"
            title="Datei ziehen und hier ablegen oder klicken"
          >
            {isDragOver ? 'Datei hier ablegen…' : 'Datei hierher ziehen oder klicken'}
          </div>

          {error && <div role="alert" className="docs-error">{error}</div>}
          {busy && <div className="docs-busy" aria-live="polite">Bitte warten…</div>}

          <div className="docs-list" role="list">
            {files.map((f) => (
              <article key={f.name} role="listitem" className="doc-card">
                <div className="doc-main">
                  <span className="doc-name" title={f.name}>{f.name}</span>
                  {f.size != null && <span className="doc-meta">{(Number(f.size)/1024).toFixed(1)} KB</span>}
                </div>
                <div className="doc-actions">
                  <button type="button" onClick={() => onPreview(f.name)} aria-label="Öffnen/Vorschau">Öffnen</button>
                  <button type="button" onClick={() => onDownload(f.name)} aria-label="Herunterladen">Laden</button>
                  <button type="button" onClick={() => onDelete(f.name)} aria-label="Löschen">Löschen</button>
                </div>
              </article>
            ))}
          {files.length === 0 && !busy && !error && (
            <div className="docs-empty">Keine Dokumente vorhanden.</div>
          )}
        </div>

        {viewer && (
          <div className="popup-overlay" onClick={closeViewer}>
            <div className="popup-container" style={{ maxWidth: '96vw', width: '92vw', height: '90vh' }} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <strong>{viewer.title}</strong>
                <button className="btn-cancel" onClick={closeViewer}>Schliessen</button>
              </div>
              <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, height: 'calc(100% - 40px)', overflow: 'hidden', background: '#fff' }}>
                {viewer.type === 'pdf' && viewer.url && (
                  <iframe title="PDF" src={viewer.url} style={{ width: '100%', height: '100%', border: 'none' }} />
                )}
                {viewer.type === 'image' && viewer.url && (
                  <div style={{ width: '100%', height: '100%', overflow: 'auto', background: '#111' }}>
                    <img src={viewer.url} alt={viewer.title} style={{ maxWidth: '100%', maxHeight: '100%', display: 'block', margin: '0 auto' }} />
                  </div>
                )}
                {viewer.type === 'text' && (
                  <pre style={{ margin: 0, padding: 12, height: '100%', overflow: 'auto', background: '#f8fafc', whiteSpace: 'pre-wrap' }}>
                    {viewer.text}
                  </pre>
                )}
                {viewer.type === 'video' && viewer.url && (
                  <video src={viewer.url} controls style={{ width: '100%', height: '100%' }} />
                )}
                {viewer.type === 'audio' && viewer.url && (
                  <div style={{ padding: 16 }}>
                    <audio src={viewer.url} controls style={{ width: '100%' }} />
                  </div>
                )}
                {viewer.type === 'office' && viewer.url && (
                  <iframe title="Dokument" src={viewer.url} style={{ width: '100%', height: '100%', border: 'none' }} />
                )}
                {viewer.type === 'other' && viewer.url && (
                  <div style={{ padding: 16 }}>
                    <p>Dieser Dateityp wird als Download bereitgestellt.</p>
                    <a className="btn-save" href={viewer.url} download={viewer.title}>Download</a>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <style>{`
            .docs-container { border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px; background: #fff; display: flex; flex-direction: column; gap: 8px; max-height: 520px; }
            .docs-container.dragover { border-style: dashed; background: #f8fafc; }
            .docs-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
            .docs-actions button { padding: 6px 10px; border-radius: 8px; border: 1px solid #d1d5db; background: #f9fafb; cursor: pointer; }
            .docs-error { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; border-radius: 8px; padding: 8px; }
            .docs-busy { color: #6b7280; font-size: 0.95rem; }
            .docs-dropzone { border: 2px dashed #cbd5e1; border-radius: 8px; padding: 10px; text-align: center; color: #64748b; cursor: pointer; }
            .docs-dropzone.dragover { background: #eef2ff; border-color: #93c5fd; color: #1d4ed8; }
            .docs-list { overflow: auto; display: flex; flex-direction: column; gap: 8px; padding-right: 2px; min-height: 160px; }
            .doc-card { border: 1px solid #e5e7eb; border-radius: 10px; padding: 10px; display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 56px; background: #fafafa; }
            .doc-main { display: flex; align-items: center; gap: 12px; min-width: 0; flex: 1 1 auto; }
            .doc-name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: inline-block; max-width: 48ch; }
            .doc-meta { color: #6b7280; font-size: 0.85rem; flex: 0 0 auto; }
            .doc-actions { display: flex; gap: 6px; flex: 0 0 auto; }
            .doc-actions button { padding: 6px 10px; border-radius: 8px; border: 1px solid #d1d5db; background: #ffffff; cursor: pointer; }
            .doc-actions button:hover { background: #f3f4f6; }
            .docs-empty { color: #6b7280; text-align: center; padding: 16px 0; }
          `}</style>
        </section>
      </div>
    </div>
  );
};

export default DokumentePopup;
