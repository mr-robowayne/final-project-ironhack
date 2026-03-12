// src/RechnungenView.js
import React, { useEffect, useMemo, useRef, useState } from 'react';
import './faelle.css';
import FallEröffnung from './faelle.js';
import api, { apiFetch, saveInvoice as saveInvoiceApi } from './api';

/* ────────────────────────────────────────────────────────────────────────── */
/* API-Helpers                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

/* ────────────────────────────────────────────────────────────────────────── */
/* Utils                                                                     */
/* ────────────────────────────────────────────────────────────────────────── */
const fmtDate = (d) => {
  if (!d) return '';
  const dt = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleDateString('de-CH');
};
const daysBetween = (a, b = new Date()) => {
  const d1 = new Date(a); const d2 = new Date(b);
  return Math.floor((d2 - d1) / (1000 * 60 * 60 * 24));
};
const chf = (v) =>
  new Intl.NumberFormat('de-CH', { style: 'currency', currency: 'CHF' })
    .format(Number.isFinite(+v) ? +v : 0);

const normalizeRow = (dto) => {
  const payload = dto?.payload || {};
  const invoice = payload.invoice || {};
  const caseObj = invoice.case || payload.case || {};
  const patient = payload.patient || {};
  const recipient = payload.recipient || {};
  const insurer = payload.insurer || null;
  const totals = payload.totals || {};

  const createdAt = invoice.created_at || dto.pdf_generated_at || dto.created_at || null;
  const total = dto.total_amount ?? totals.total_chf ?? totals.net_chf ?? 0;

  const patientName = [patient.first_name || patient.vorname, patient.last_name || patient.nachname]
    .filter(Boolean).join(' ').trim();

  const billingMode = (invoice.billing_mode || '').toUpperCase() || (insurer ? 'TP' : 'TG');
  const payerName = billingMode === 'TP'
    ? (insurer?.name || recipient?.name || 'Versicherer')
    : (patientName || recipient?.name || 'Patient');

  const recipientName =
    recipient?.name ||
    insurer?.name ||
    (billingMode === 'TP' ? (insurer?.name || 'Versicherer') : patientName) ||
    '';

  const recipientAddress = (() => {
    if (recipient?.address) return recipient.address;
    const street = [recipient?.street, recipient?.houseNo].filter(Boolean).join(' ');
    const city = [recipient?.zip, recipient?.city].filter(Boolean).join(' ');
    return [street, city].filter(Boolean).join(', ');
  })();

  return {
    raw: dto,
    id: dto.id,
    invoiceId: invoice.id || dto.id,
    createdAt,
    ageDays: createdAt ? daysBetween(createdAt) : null,
    patientId: dto.patient_id || patient.id || null,
    patientName,
    payerName,
    recipientName,
    recipientAddress,
    caseType: caseObj.type || '',
    total,
    currency: dto.currency || invoice.currency || 'CHF',
    status: dto.status || invoice.status || 'draft',
    hasPDF: Boolean(dto.has_pdf),
    pdfUrl: dto.pdf_url || null,
    pdfViewUrl: dto.pdf_view_url || null,
    payload
  };
};

/* ────────────────────────────────────────────────────────────────────────── */
/* Konstanten                                                                */
/* ────────────────────────────────────────────────────────────────────────── */
const FALLARTEN = ['', 'KVG', 'UVG', 'IV', 'Selbstzahler'];
const EMPF_T = [
  { value: '',         label: 'Alle' },
  { value: 'patient',  label: 'Patient' },
  { value: 'insurer',  label: 'Versicherer' },
  { value: 'other',    label: 'Andere' },
];
const STATUS_LIST = ['', 'neu', 'sent', 'ack', 'rejected', 'paid', 'send_error'];

/* ────────────────────────────────────────────────────────────────────────── */
/* Komponente                                                                */
/* ────────────────────────────────────────────────────────────────────────── */
export default function RechnungenView({ tenantMeta = null }) {

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  // Filter
  const [q, setQ] = useState('');
  const [fallart, setFallart] = useState('');
  const [empfTyp, setEmpfTyp] = useState('');
  const [status, setStatus] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [ageMin, setAgeMin] = useState('');
  const [ageMax, setAgeMax] = useState('');

  // Bulk-Modus
  const [bulk, setBulk] = useState(false);
  const [selected, setSelected] = useState({});

  // Expand/Viewer/Edit/Create
  const [expandedId, setExpandedId] = useState(null);
  const [viewer, setViewer] = useState(null); // {type, title, url|text, validation?}
  const [editRow, setEditRow] = useState(null);
  const [openCreate, setOpenCreate] = useState(false);

  // Blob-URLs aufräumen
  const objUrls = useRef([]);
  const availabilityKeys = useRef({ pdf: 'hasPDF', xml: null });
  const fileLabels = { pdf: 'PDF', json: 'JSON', xml: 'XML' };

  const markFileAvailability = (rowId, kind, available) => {
    const key = availabilityKeys.current[kind];
    if (!key) return;
    setRows((prev) => prev.map((row) => (row.id === rowId ? { ...row, [key]: available } : row)));
  };
  const handleMissingFile = (row, kind) => {
    markFileAvailability(row.id, kind, false);
    alert(`${fileLabels[kind] || kind.toUpperCase()} ist für diese Rechnung nicht vorhanden.`);
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/invoices');
      if (!res.ok) throw new Error(res.data?.message || `HTTP ${res.status}`);
      const arr = Array.isArray(res.data) ? res.data : [];
      setRows(arr.map(normalizeRow));
    } catch (e) {
      console.error(e);
      alert('Konnte Rechnungen nicht laden.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    return () => {
      objUrls.current.forEach((url) => {
        try { URL.revokeObjectURL(url); } catch {}
      });
      objUrls.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (status && r.status !== status) return false;
      if (fallart && (r.caseType || '').toLowerCase() !== fallart.toLowerCase()) return false;

      if (empfTyp) {
        const payload = r.payload || {};
        const rec = payload.recipient || {};
        const insurer = payload.insurer || null;
        const invoice = payload.invoice || {};
        const billingMode = (invoice.billing_mode || '').toUpperCase();
        const ty = rec.type || (insurer ? 'insurer' : (billingMode === 'TP' ? 'insurer' : 'patient'));
        if (empfTyp === 'other') {
          if (ty === 'patient' || ty === 'insurer') return false;
        } else if (ty !== empfTyp) {
          return false;
        }
      }

      if (dateFrom) {
        const ca = new Date(r.createdAt);
        if (ca < new Date(dateFrom)) return false;
      }
      if (dateTo) {
        const ca = new Date(r.createdAt);
        if (ca > new Date(`${dateTo}T23:59:59`)) return false;
      }

      if (ageMin !== '' && r.ageDays != null && r.ageDays < Number(ageMin)) return false;
      if (ageMax !== '' && r.ageDays != null && r.ageDays > Number(ageMax)) return false;

      if (ql) {
        const hay = [
          r.invoiceId, r.patientName, r.payerName, r.recipientName,
          r.recipientAddress, r.caseType, r.status,
        ].join(' ').toLowerCase();
        if (!hay.includes(ql)) return false;
      }
      return true;
    });
  }, [rows, q, fallart, empfTyp, status, dateFrom, dateTo, ageMin, ageMax]);

  const allSelected = filtered.length > 0 && filtered.every((r) => selected[r.id]);
  const toggleSelectAll = () => {
    if (!bulk) return;
    const next = { ...selected };
    if (allSelected) filtered.forEach((r) => { delete next[r.id]; });
    else filtered.forEach((r) => { next[r.id] = true; });
    setSelected(next);
  };
  const toggleSelect = (id) => bulk && setSelected((prev) => ({ ...prev, [id]: !prev[id] }));

  /* ───────── Datei-Viewer (mit Auth) ───────── */
    const openViewer = async (row, type) => {
      try {
        if (type === 'pdf') {
          const target = row.pdfUrl || `/api/invoices/${encodeURIComponent(row.id)}/pdf`;
          const res = await apiFetch(target, { method: 'GET' });
        if (res.status === 404) { handleMissingFile(row, type); return; }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        objUrls.current.push(url);
        markFileAvailability(row.id, type, true);
        setViewer({ type, title: `PDF – ${row.invoiceId}`, url });
        return;
      }
      if (type === 'json') {
        if (!row.payload) { handleMissingFile(row, type); return; }
        const text = JSON.stringify(row.payload, null, 2);
        setViewer({ type, title: `JSON – ${row.invoiceId}`, text, warnings: row.payload?.warnings || [] });
        return;
      }
      if (type === 'xml') {
        // Meta (inkl. XSD-Status) holen
        let validation = null;
        try {
          const metaRes = await apiFetch(`/api/faelle/${encodeURIComponent(row.id)}/xml?meta=1`, { method: 'GET' });
          if (metaRes.ok) {
            const meta = await metaRes.json().catch(() => ({}));
            validation = meta?.xsd_validation || null;
          }
        } catch (e) {
          console.warn('XML meta failed', e);
        }

        // XML-Datei laden
        const res = await apiFetch(`/api/faelle/${encodeURIComponent(row.id)}/xml`, { method: 'GET' });
        if (res.status === 404) { handleMissingFile(row, type); return; }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        markFileAvailability(row.id, 'xml', true);
        setViewer({ type, title: `XML (GeneralInvoice 5.0) – ${row.invoiceId}`, text, validation, warnings: row.raw?.payload?.warnings || [] });
        return;
      }
      alert('Dieser Dateityp wird im neuen Rechnungsmodul noch nicht unterstützt.');
    } catch (e) {
      console.error(e);
      alert('Konnte Datei nicht laden.');
    }
  };
  const closeViewer = () => {
    if (viewer?.url) {
      try {
        URL.revokeObjectURL(viewer.url);
      } catch {}
      objUrls.current = objUrls.current.filter((u) => u !== viewer.url);
    }
    setViewer(null);
  };
  const downloadFile = async (row, kind) => {
    if (kind !== 'pdf') {
      alert('Nur PDF-Downloads sind verfügbar.');
      return;
    }
    try {
      const target = row.pdfUrl || `/api/invoices/${encodeURIComponent(row.id)}/pdf`;
      const res = await apiFetch(target, { method: 'GET' });
      if (res.status === 404) { handleMissingFile(row, kind); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${kind.toUpperCase()}_${row.invoiceId}.pdf`;
      markFileAvailability(row.id, kind, true);
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
    } catch (e) {
      console.error(e);
      alert('Download fehlgeschlagen.');
    }
  };

  /* ───────── CSV/XML Export (Bulk) ───────── */
  const exportCSV = async () => {
    const sel = rows.filter((r) => selected[r.id]);
    if (sel.length === 0) { alert('Bitte Rechnungen auswählen.'); return; }
    const cols = ['ID','Rechnungs-ID','Erstellt','Alter (Tage)','Patient','Zahler','Empfänger','Empfänger-Adresse','Fallart','Betrag','Status'];
    const lines = [cols.join(';')];
    sel.forEach((r) => {
      const amount = (Number.isFinite(+r.total) ? +r.total : 0).toFixed(2).replace('.', ',');
      const vals = [r.id, r.invoiceId, fmtDate(r.createdAt), r.ageDays ?? '', r.patientName, r.payerName, r.recipientName, r.recipientAddress, r.caseType, amount, r.status];
      lines.push(vals.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';'));
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `Rechnungen_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
  };
  const exportJSONZip = async () => {
    const sel = rows.filter((r) => selected[r.id]);
    if (sel.length === 0) { alert('Bitte Rechnungen auswählen.'); return; }

    let JSZip;
    try { const mod = await import('jszip'); JSZip = mod.default || mod; }
    catch {
      alert('ZIP-Erstellung ist nicht verfügbar (JSZip konnte nicht geladen werden).');
      return;
    }
    try {
      const zip = new JSZip();
      for (const r of sel) {
        const payload = r.payload || {};
        const json = JSON.stringify(payload, null, 2);
        zip.file(`invoice_${r.invoiceId || r.id}.json`, json);
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = `Invoices_${new Date().toISOString().slice(0,10)}.zip`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
    } catch (e) {
      console.error(e);
      alert('ZIP-Export fehlgeschlagen.');
    }
  };
  const markSelectedPaid = async () => {
    const sel = rows.filter((r) => selected[r.id]);
    if (sel.length === 0) { alert('Bitte Rechnungen auswählen.'); return; }
    if (!window.confirm(`${sel.length} Rechnung(en) als bezahlt markieren?`)) return;
    let success = 0;
    let failed = 0;
    for (const row of sel) {
      if (!row.payload) { failed++; continue; }
      try {
        const payload = JSON.parse(JSON.stringify(row.payload));
        if (!payload.invoice) payload.invoice = {};
        payload.invoice.status = 'paid';
        payload.invoice.paid_at = new Date().toISOString();
        const res = await saveInvoiceApi(payload);
        if (!res.ok) throw new Error(res.data?.message || 'Update fehlgeschlagen');
        success++;
      } catch (err) {
        console.error(err);
        failed++;
      }
    }
    if (success) await fetchData();
    if (success || failed) {
      const parts = [];
      if (success) parts.push(`${success} aktualisiert`);
      if (failed) parts.push(`${failed} fehlgeschlagen`);
      alert(`Status: ${parts.join(', ')}`);
    }
  };

  /* ───────── Automatischer Import: CAMT / EDI ───────── */
  const onImport = async (files) => {
    if (!files?.length) return;
    alert('Der automatische Import (CAMT/EDI) wird im neuen Rechnungsmodul noch nicht unterstützt.');
  };

  /* ───────── Zeilenaktionen ───────── */
  const RowActions = ({ r }) => {
    const hasResource = (kind) => {
      const key = availabilityKeys.current[kind];
      if (!key) return true;
      return r[key] !== false;
    };
    const missingHint = (kind, label) => (hasResource(kind) ? undefined : `${label} liegt noch nicht vor.`);
    const mellowStyle = (kind) => (hasResource(kind) ? undefined : { opacity: 0.6 });
    return (
      <div style={{ padding: '10px 12px 16px', background: '#fbfdff', borderTop: '1px solid #e5e7eb' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button
            type="button"
            className="btn-add"
            onClick={() => openViewer(r, 'pdf')}
            title={missingHint('pdf', 'PDF')}
            style={mellowStyle('pdf')}
          >
            PDF ansehen
          </button>
          <button
            type="button"
            className="btn-add"
            onClick={() => downloadFile(r, 'pdf')}
            title={missingHint('pdf', 'PDF')}
            style={mellowStyle('pdf')}
          >
            PDF Download
          </button>
          <button
            type="button"
            className="btn-add"
            onClick={() => openViewer(r, 'json')}
            disabled={!r.payload}
            style={!r.payload ? { opacity: 0.6, cursor: 'not-allowed' } : undefined}
          >
            JSON ansehen
          </button>
          <button
            type="button"
            className="btn-add"
            onClick={() => openViewer(r, 'xml')}
            title="GeneralInvoice 5.0 XML anzeigen (mit XSD-Status)"
          >
            XML ansehen
          </button>
          <button type="button" className="btn-add" onClick={() => setEditRow(r)}>Bearbeiten</button>
        </div>
      </div>
    );
  };

  return (
    <div className="container" style={{ padding: 16 }}>
      <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom: 8 }}>
        <h2 className="h2" style={{ margin: 0, flex: 1 }}>Rechnungen</h2>
        {/* Optional: neuen Fall erstellen (Achtung: FallEröffnung benötigt i.d.R. selectedPatient) */}
        <button className="btn-add" type="button" onClick={() => setOpenCreate(true)}>+ Neuer Fall</button>
      </div>
      <div style={{ marginBottom: 10, padding: '10px 12px', borderRadius: 10, background: '#eef2ff', color: '#312e81', border: '1px solid #c7d2fe' }}>
        XML-Export ist GeneralInvoice 5.0. XSD-Validierung läuft serverseitig (xmllint) gegen das Schema aus <code>Tardoc/generalInvoiceRequest_500.xsd</code>. Warnungen werden beim Öffnen der XML angezeigt.
      </div>

      {/* Filter-Header */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 12, margin: '12px 0' }}>
        <div className="card">
          <div className="section-header">Suche</div>
          <input
            placeholder="ID, Patient, Empfänger, Status …"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        <div className="card">
          <div className="section-header">Typen</div>
          <div style={{ display: 'grid', gap: 8 }}>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUS_LIST.map((s) => <option key={s} value={s}>{s ? `Status: ${s}` : 'Status: Alle'}</option>)}
            </select>
            <select value={fallart} onChange={(e) => setFallart(e.target.value)}>
              {FALLARTEN.map((f) => <option key={f} value={f}>{f || 'Fallart: Alle'}</option>)}
            </select>
            <select value={empfTyp} onChange={(e) => setEmpfTyp(e.target.value)}>
              {EMPF_T.map((t) => <option key={t.value} value={t.value}>{`Empfänger: ${t.label}`}</option>)}
            </select>
          </div>
        </div>

        <div className="card">
          <div className="section-header">Zeitraum</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <label className="text-xs text-gray-500">Von</label>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-gray-500">Bis</label>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
          </div>
        </div>

        <div className="card">
          <div className="section-header">Alter (Tage)</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <label className="text-xs text-gray-500">Min</label>
              <input type="number" min="0" value={ageMin} onChange={(e) => setAgeMin(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-gray-500">Max</label>
              <input type="number" min="0" value={ageMax} onChange={(e) => setAgeMax(e.target.value)} />
            </div>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <label className="btn-add" style={{ cursor: 'pointer' }}>
          Dateien importieren (CAMT / EDI / ZIP)
          <input
            type="file"
            multiple
            accept=".xml,.camt,.txt,.zip"
            style={{ display: 'none' }}
            onChange={(e) => onImport(e.target.files)}
          />
        </label>
        <button className="btn-add" type="button" onClick={fetchData}>Aktualisieren</button>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={bulk}
              onChange={(e) => { setBulk(e.target.checked); setSelected({}); }}
            />
            Bulk-Modus
          </label>
          <div style={{ color: '#6b7280' }}>{loading ? 'Lade…' : `${filtered.length} / ${rows.length}`}</div>
        </div>
      </div>

      {/* Bulk-Aktionen */}
      {bulk && (
        <div className="bulk-actions" style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <button className="btn-save" onClick={exportCSV} type="button">CSV exportieren (selektierte)</button>
          <button className="btn-save" onClick={exportJSONZip} type="button">JSON als ZIP (selektierte)</button>
          <button className="btn-save" onClick={markSelectedPaid} type="button">Als bezahlt markieren</button>
        </div>
      )}

      {/* Tabelle */}
      <div className="tarmed-table-container">
        <table className="tarmed-table">
          <thead>
            <tr>
              {bulk && (
                <th style={{ width: 34 }}>
                  <input type="checkbox" checked={filtered.length > 0 && filtered.every((r) => selected[r.id])} onChange={toggleSelectAll} />
                </th>
              )}
              <th>Erstellt</th>
              <th>Alter (T)</th>
              <th>Rechnungs-ID</th>
              <th>Patient</th>
              <th>Zahler</th>
              <th>Empfänger</th>
              <th>Adresse</th>
              <th>Fallart</th>
              <th style={{ textAlign: 'right' }}>Betrag</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <React.Fragment key={r.id}>
                <tr
                  onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
                  style={{ cursor: 'pointer', background: expandedId === r.id ? '#f8fbff' : 'transparent' }}
                  title="Details ein-/ausklappen"
                >
                  {bulk && (
                    <td onClick={(e) => { e.stopPropagation(); toggleSelect(r.id); }}>
                      <input type="checkbox" checked={!!selected[r.id]} onChange={() => {}} />
                    </td>
                  )}
                  <td>{fmtDate(r.createdAt)}</td>
                  <td>{r.ageDays ?? ''}</td>
                  <td className="font-mono">{r.invoiceId}</td>
                  <td>{r.patientName}</td>
                  <td>{r.payerName}</td>
                  <td>{r.recipientName}</td>
                  <td>{r.recipientAddress}</td>
                  <td>{r.caseType}</td>
                  <td style={{ textAlign: 'right' }}>{chf(r.total)}</td>
                  <td>{r.status}</td>
                </tr>
                {expandedId === r.id && (
                  <tr>
                    <td colSpan={bulk ? 11 : 10}>
                      <RowActions r={r} />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={bulk ? 11 : 10} style={{ textAlign: 'center', color: '#777', padding: 16 }}>Keine Rechnungen gefunden.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Viewer Modal */}
      {viewer && (
        <div className="popup-overlay" onClick={closeViewer}>
          <div className="popup-container" style={{ maxWidth: '96vw', width: '96vw', height: '90vh' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <strong>{viewer.title}</strong>
              <button className="btn-cancel" onClick={closeViewer}>Schliessen</button>
            </div>
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, height: 'calc(100% - 40px)', overflow: 'hidden', background: '#fff' }}>
              {viewer.type === 'pdf' && (
                <iframe title="PDF" src={viewer.url} style={{ width: '100%', height: '100%', border: 'none' }} />
              )}
              {(viewer.type === 'xml' || viewer.type === 'json') && (
                <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                  {(viewer.warnings && viewer.warnings.length > 0) && (
                    <div style={{ padding: '8px 12px', background: '#fff7ed', color: '#9a3412', borderBottom: '1px solid #fed7aa' }}>
                      <strong>Warnungen:</strong>
                      <ul style={{ margin: '4px 0 0 16px', padding: 0, fontSize: 12 }}>
                        {viewer.warnings.map((w, i) => <li key={i}>{w}</li>)}
                      </ul>
                    </div>
                  )}
                  {viewer.validation && (
                    <div style={{ padding: '8px 12px', background: viewer.validation.ok ? '#ecfdf3' : '#fef2f2', color: viewer.validation.ok ? '#166534' : '#991b1b' }}>
                      {viewer.validation.ok
                        ? 'XSD-Validierung: OK'
                        : `XSD-Validierung fehlgeschlagen: ${viewer.validation.error || 'Unbekannter Fehler'}`}
                      {!viewer.validation.available && ' (xmllint/XSD nicht verfügbar)'}
                    </div>
                  )}
                  <pre style={{ margin: 0, padding: 12, flex: 1, overflow: 'auto', background: '#0b1020', color: '#d2e0ff', fontSize: 12 }}>
                    {viewer.text}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Edit/Erstellen – gleiche Maske (FallEröffnung) */}
      {editRow && (
        <div className="popup-overlay" onClick={() => setEditRow(null)}>
          <div className="popup-container" style={{ maxWidth: '96vw', width: '96vw', height: '96vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <FallEröffnung
              mode="edit"
              claimId={editRow.id}
              onClose={() => setEditRow(null)}
              onSaved={() => { setEditRow(null); fetchData(); }}
              tenantMeta={tenantMeta}
            />
          </div>
        </div>
      )}

      {openCreate && (
        <div className="popup-overlay" onClick={() => setOpenCreate(false)}>
          <div className="popup-container" style={{ maxWidth: '96vw', width: '96vw', height: '96vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <FallEröffnung
              mode="create"
              onClose={() => setOpenCreate(false)}
              onSaved={() => { setOpenCreate(false); fetchData(); }}
              tenantMeta={tenantMeta}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Kleine Card-Hilfe (falls CSS das nicht schon hat)                         */
/* ────────────────────────────────────────────────────────────────────────── */
const cardStyle = document.createElement('style');
cardStyle.innerHTML = `
  .card { border:1px solid #e5e7eb; border-radius:12px; padding:12px; background:#fff; }
  .card .section-header { color:#1f4fa3; font-weight:600; margin-bottom:8px; }
`;
document.head.appendChild(cardStyle);
