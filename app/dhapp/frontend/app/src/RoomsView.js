import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api, { listAccessibleUsers, resolvePatient } from './api';
import PatientSearchInput from './PatientSearchInput';
import { hasPermission } from './rbac';

// Simple helpers
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const toIsoRange = (day) => {
  const d = new Date(day);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0);
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59);
  return { from: start.toISOString(), to: end.toISOString(), start, end };
};

const DEFAULT_GRID = { width: 24, height: 16, sizePx: 20 };
const OBJECT_LIBRARY = [
  { key: 'BED', label: 'Bett', w: 2, h: 4, color: '#dbeafe' },
  { key: 'OP_TABLE', label: 'OP-Tisch', w: 3, h: 6, color: '#fde68a' },
  { key: 'MONITOR', label: 'Monitor', w: 1, h: 1, color: '#e9d5ff' },
  { key: 'MACHINE', label: 'Gerät', w: 2, h: 2, color: '#fda4af' },
  { key: 'CABINET', label: 'Schrank', w: 2, h: 1, color: '#c7d2fe' },
  { key: 'CHAIR', label: 'Stuhl', w: 1, h: 1, color: '#f0abfc' },
  { key: 'DESK', label: 'Tisch', w: 2, h: 1, color: '#a7f3d0' },
  { key: 'WALL', label: 'Wand', w: 1, h: 6, color: '#94a3b8' },
  { key: 'OTHER', label: 'Sonstiges', w: 1, h: 1, color: '#e5e7eb' },
];

function useSession() {
  const [session, setSession] = useState(null);
  useEffect(() => {
    let mounted = true;
    api.get('/api/session').then(({ data }) => { if (mounted) setSession(data || null); }).catch(() => {});
    return () => { mounted = false; };
  }, []);
  const role = String(session?.user?.role || session?.user?.rolle || '').toLowerCase();
  const canEditRooms = hasPermission(session?.user, 'appointments.write') || ['admin', 'doctor', 'arzt', 'ärztin'].includes(role);
  return { session, role, canEditRooms };
}

function BookingDialog({ open, onClose, room, initial, onSaved }) {
  const [start, setStart] = useState(initial?.start_time ? new Date(initial.start_time) : new Date());
  const [end, setEnd] = useState(initial?.end_time ? new Date(initial.end_time) : new Date(Date.now() + 30*60000));
  const [patient, setPatient] = useState(null);
  const [note, setNote] = useState(initial?.note || '');
  const [doctorId, setDoctorId] = useState(initial?.doctor_id || '');
  const [staffIds, setStaffIds] = useState(initial?.staff_ids || []);
  const [procedureType, setProcedureType] = useState(initial?.procedure_type || '');
  const [status, setStatus] = useState(initial?.status || 'GEPLANT');
  const [color, setColor] = useState(initial?.color || '');
  const [users, setUsers] = useState([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    listAccessibleUsers().then(setUsers).catch(()=>{});
  }, []);

  // Load existing patient (for editing) once
  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!initial?.patient_id) return;
      try {
        const res = await resolvePatient({ id: initial.patient_id });
        const p = res?.data || null;
        if (active && p) setPatient(p);
      } catch {/* ignore */}
    };
    load();
    return () => { active = false; };
  }, [initial?.patient_id]);

  if (!open) return null;
  const onSubmit = async (e) => {
    e.preventDefault(); setSaving(true); setErr('');
    try {
      const payload = {
        room_id: room?.id,
        start_time: start.toISOString(), end_time: end.toISOString(),
        patient_id: patient?.id || null,
        note: note || null,
        doctor_id: doctorId ? Number(doctorId) : null,
        staff_ids: Array.isArray(staffIds) ? staffIds.map(Number) : [],
        procedure_type: procedureType || null,
        status, color: color || null
      };
      if (initial?.id) {
        await api.patch(`/api/rooms/bookings/${encodeURIComponent(initial.id)}`, payload);
      } else {
        await api.post('/api/rooms/bookings', payload);
      }
      onSaved && onSaved();
      onClose && onClose();
    } catch (e2) {
      setErr(e2?.response?.data?.message || e2?.message || 'Speichern fehlgeschlagen');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="popup-overlay">
      <div className="popup-container" style={{ maxWidth: 640 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <h3 style={{ margin: 0 }}>{initial?.id ? 'Buchung bearbeiten' : 'Neue Buchung'}</h3>
          <button className="btn-cancel" onClick={() => onClose && onClose()}>❌</button>
        </div>
        {err && <div style={{ color:'crimson', marginTop:8 }}>{err}</div>}
        <form onSubmit={onSubmit} style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginTop:12 }}>
          <div>
            <label>Start</label>
            <input type="datetime-local" value={start.toISOString().slice(0,16)} onChange={(e) => setStart(new Date(e.target.value))} required />
          </div>
          <div>
            <label>Ende</label>
            <input type="datetime-local" value={end.toISOString().slice(0,16)} onChange={(e) => setEnd(new Date(e.target.value))} required />
          </div>
          <div>
            <label>Patient</label>
            <PatientSearchInput value={patient} onChange={setPatient} placeholder="Patient suchen…" />
          </div>
          <div>
            <label>Arzt</label>
            <select value={doctorId || ''} onChange={(e) => setDoctorId(e.target.value)}>
              <option value="">–</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.displayName || u.name || `#${u.id}`}</option>)}
            </select>
          </div>
          <div>
            <label>Team</label>
            <select multiple value={staffIds.map(String)} onChange={(e) => setStaffIds(Array.from(e.target.selectedOptions).map(o => Number(o.value)))} size={4}>
              {users.map(u => <option key={u.id} value={u.id}>{u.displayName || u.name || `#${u.id}`}</option>)}
            </select>
          </div>
          <div>
            <label>Prozedur</label>
            <input type="text" value={procedureType} onChange={(e) => setProcedureType(e.target.value)} placeholder="z.B. OP, Untersuchung" />
          </div>
          <div>
            <label>Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              {['GEPLANT','LAUFEND','ABGESCHLOSSEN','ABGESAGT'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label>Farbe</label>
            <input type="color" value={color || '#3b82f6'} onChange={(e) => setColor(e.target.value)} />
          </div>
          <div style={{ gridColumn: '1 / span 2' }}>
            <label>Notizen</label>
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
          </div>
          <div style={{ gridColumn: '1 / span 2', display:'flex', justifyContent:'flex-end', gap:8 }}>
            <button type="button" className="btn-cancel" onClick={() => onClose && onClose()}>Abbrechen</button>
            <button type="submit" className="btn-save" disabled={saving}>{saving ? 'Speichere…' : 'Speichern'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function RoomsView({ onClose, inline = false }) {
  const { canEditRooms } = useSession();
  const [rooms, setRooms] = useState([]);
  const [roomFilter, setRoomFilter] = useState('');
  const [roomTypeFilter, setRoomTypeFilter] = useState('');
  const [selectedRoomId, setSelectedRoomId] = useState(null);
  const [error, setError] = useState('');
  const [activeOnly, setActiveOnly] = useState(true);

  // Planner state
  const [layout, setLayout] = useState([]);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [gridSize, setGridSize] = useState(DEFAULT_GRID.sizePx);
  const [snap, setSnap] = useState(true);
  const [gridOn, setGridOn] = useState(true);
  const [savedTick, setSavedTick] = useState(0);
  const [selectedObjId, setSelectedObjId] = useState(null);
  const [history, setHistory] = useState([]);
  const [future, setFuture] = useState([]);

  // Booking state
  const [day, setDay] = useState(() => new Date().toISOString().slice(0,10));
  const [bookings, setBookings] = useState([]);
  const [showBookingDialog, setShowBookingDialog] = useState(false);
  const [editingBooking, setEditingBooking] = useState(null);
  // Library state for custom items
  const [library, setLibrary] = useState(OBJECT_LIBRARY);

  const canvasRef = useRef(null);
  const canvasWrapRef = useRef(null);
  const dragRef = useRef(null);
  const lastSaveRef = useRef(0);

  const loadRooms = useCallback(async () => {
    try {
      const { data } = await api.get(`/api/rooms?active=${activeOnly ? 'true' : 'false'}&with_status=true`);
      const items = Array.isArray(data?.items) ? data.items : [];
      setRooms(items);
      if (items.length) {
        if (!selectedRoomId) setSelectedRoomId(items[0].id);
        else if (!items.find(r => r.id === selectedRoomId)) setSelectedRoomId(items[0].id);
      }
      return items;
    } catch (e) {
      setError(e?.message || 'Räume konnten nicht geladen werden');
      return [];
    }
  }, [selectedRoomId, activeOnly]);

  const selectedRoom = useMemo(() => rooms.find(r => r.id === selectedRoomId) || null, [rooms, selectedRoomId]);

  const loadLayout = useCallback(async () => {
    if (!selectedRoom) return;
    try {
      const { data } = await api.get(`/api/rooms/${encodeURIComponent(selectedRoom.id)}/layout`);
      setLayout(Array.isArray(data?.items) ? data.items : []);
      setHistory([]); setFuture([]);
    } catch (e) {
      console.warn('Layout load failed', e);
    }
  }, [selectedRoom]);

  const loadBookings = useCallback(async () => {
    if (!selectedRoom || !day) return;
    const { from, to } = toIsoRange(day);
    try {
      const { data } = await api.get(`/api/rooms/bookings?roomId=${encodeURIComponent(selectedRoom.id)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
      setBookings(Array.isArray(data?.items) ? data.items : []);
    } catch (e) { console.warn('Bookings load failed', e); }
  }, [selectedRoom, day]);

  useEffect(() => { loadRooms(); }, [loadRooms]);
  useEffect(() => { loadLayout(); }, [loadLayout]);
  useEffect(() => { loadBookings(); }, [loadBookings]);

  // Planner interactions
  const grid = useMemo(() => ({
    width: selectedRoom?.width || DEFAULT_GRID.width,
    height: selectedRoom?.height || DEFAULT_GRID.height,
    size: gridSize
  }), [selectedRoom, gridSize]);

  const pushHistory = (next) => {
    setHistory((h) => [...h, next]);
    setFuture([]);
  };
  const undo = () => {
    setHistory((h) => {
      if (!h.length) return h;
      const last = h[h.length - 1];
      setFuture((f) => [layout, ...f]);
      setLayout(last);
      return h.slice(0, -1);
    });
  };
  const redo = () => {
    setFuture((f) => {
      if (!f.length) return f;
      const [first, ...rest] = f;
      pushHistory(layout);
      setLayout(first);
      return rest;
    });
  };

  const saveObject = useMemo(() => {
    let t = null;
    return (obj) => {
      if (t) clearTimeout(t);
      t = setTimeout(async () => {
        try {
          const payload = {
            x: Math.round(obj.x),
            y: Math.round(obj.y),
            width: Math.max(1, Math.round(obj.width)),
            height: Math.max(1, Math.round(obj.height)),
            rotation: Math.round(obj.rotation || 0)
          };
          await api.put(`/api/room-layout-objects/${encodeURIComponent(obj.id)}`, payload);
          setSavedTick((n) => n + 1);
        } catch (e) {
          console.warn('Autosave failed', e);
        }
      }, 250);
    };
  }, [setSavedTick]);

  const rotateSelected = async (delta) => {
    const obj = layout.find(o => o.id === selectedObjId);
    if (!obj) return;
    const next = ((obj.rotation || 0) + delta + 360) % 360;
    const updated = { ...obj, rotation: next };
    pushHistory(layout.map(o => ({ ...o })));
    setLayout((prev) => prev.map(o => o.id === obj.id ? updated : o));
    try { await api.put(`/api/room-layout-objects/${encodeURIComponent(obj.id)}`, { rotation: next }); setSavedTick(n => n+1); } catch (_) {}
  };
  const deleteSelected = async () => {
    const obj = layout.find(o => o.id === selectedObjId);
    if (!obj) return;
    if (!window.confirm('Objekt wirklich entfernen?')) return;
    try { await api.delete(`/api/room-layout-objects/${encodeURIComponent(obj.id)}`); setSelectedObjId(null); loadLayout(); } catch (e) { alert(e?.response?.data?.message || e?.message || 'Löschen fehlgeschlagen'); }
  };

  const onLibraryDragStart = (e, item) => {
    e.dataTransfer.setData('application/x-room-object', JSON.stringify(item));
  };
  const onCanvasDrop = async (e) => {
    e.preventDefault(); if (!selectedRoom) return;
    if (!canEditRooms) return;
    const data = e.dataTransfer.getData('application/x-room-object');
    if (!data) return;
    const item = JSON.parse(data);
    const rect = canvasRef.current.getBoundingClientRect();
    const px = (e.clientX - rect.left - pan.x) / zoom;
    const py = (e.clientY - rect.top - pan.y) / zoom;
    const gx = clamp(Math.round(px / grid.size) - Math.floor(item.w/2), 0, Math.max(0, (grid.width - item.w)));
    const gy = clamp(Math.round(py / grid.size) - Math.floor(item.h/2), 0, Math.max(0, (grid.height - item.h)));
    try {
      await api.post(`/api/rooms/${encodeURIComponent(selectedRoom.id)}/layout`, {
        type: item.key, x: gx, y: gy, width: item.w, height: item.h
      });
      loadLayout();
    } catch (e2) {
      alert(e2?.response?.data?.message || e2?.message || 'Objekt konnte nicht erstellt werden');
    }
  };
  const onCanvasDragOver = (e) => { e.preventDefault(); };

  const onObjectMouseDown = (e, obj) => {
    if (!canEditRooms) return;
    setSelectedObjId(obj.id);
    const startX = e.clientX; const startY = e.clientY;
    const orig = { x: obj.x, y: obj.y };
    // Save current layout for undo before modifying
    pushHistory(layout.map(o => ({ ...o })));
    dragRef.current = { id: obj.id, startX, startY, orig };
    e.stopPropagation();
  };
  const onCanvasMouseMove = (e) => {
    if (!dragRef.current) return;
    const { id, startX, startY, orig } = dragRef.current;
    const dx = (e.clientX - startX) / zoom; const dy = (e.clientY - startY) / zoom;
    const gx = snap ? Math.round((orig.x + dx / grid.size)) : (orig.x + dx / grid.size);
    const gy = snap ? Math.round((orig.y + dy / grid.size)) : (orig.y + dy / grid.size);
    setLayout((prev) => prev.map(o => o.id === id ? { ...o, x: clamp(gx, 0, grid.width - o.width), y: clamp(gy, 0, grid.height - o.height) } : o));
  };
  const onCanvasMouseUp = () => {
    if (!dragRef.current) return;
    const { id } = dragRef.current;
    const obj = layout.find(o => o.id === id);
    dragRef.current = null;
    if (obj) { saveObject(obj); }
  };
  const onCanvasWheel = (e) => {
    if (e.ctrlKey) {
      e.preventDefault();
      setZoom((z) => clamp(z + (e.deltaY < 0 ? 0.1 : -0.1), 0.4, 2));
    }
  };
  const onCanvasBackgroundMouseDown = (e) => {
    // start panning
    const sx = e.clientX - pan.x; const sy = e.clientY - pan.y;
    const move = (ev) => setPan({ x: ev.clientX - sx, y: ev.clientY - sy });
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  // Templates
  const createFromTemplate = async (key) => {
    if (!canEditRooms) return;
    const templates = {
      STANDARD_OP: {
        name: 'OP', type: 'OP', width: 28, height: 18,
        objects: [
          { type: 'OP_TABLE', x: 12, y: 7, width: 4, height: 6 },
          { type: 'MONITOR', x: 8, y: 4, width: 1, height: 1 },
          { type: 'MACHINE', x: 20, y: 4, width: 2, height: 2 },
          { type: 'CABINET', x: 2, y: 2, width: 3, height: 1 },
        ]
      },
      STANDARD_AUFWACH: {
        name: 'Aufwachraum', type: 'AUFWACHRAUM', width: 28, height: 16,
        objects: [
          { type: 'BED', x: 3, y: 3, width: 2, height: 4 },
          { type: 'BED', x: 8, y: 3, width: 2, height: 4 },
          { type: 'BED', x: 13, y: 3, width: 2, height: 4 },
          { type: 'MONITOR', x: 5, y: 2, width: 1, height: 1 },
        ]
      },
      STANDARD_SPRECH: {
        name: 'Sprechzimmer', type: 'SPRECHZIMMER', width: 24, height: 14,
        objects: [
          { type: 'DESK', x: 4, y: 2, width: 2, height: 1 },
          { type: 'CHAIR', x: 7, y: 2, width: 1, height: 1 },
          { type: 'CABINET', x: 2, y: 10, width: 3, height: 1 },
        ]
      }
    };
    const tpl = templates[key]; if (!tpl) return;
    const name = prompt('Name für neuen Raum (Template)', tpl.name) || tpl.name;
    try {
      const { data } = await api.post('/api/rooms', { name, type: tpl.type, width: tpl.width, height: tpl.height, active: true });
      for (const o of tpl.objects) {
        try { await api.post(`/api/rooms/${encodeURIComponent(data.id)}/layout`, o); } catch (_) {}
      }
      const items = await loadRooms();
      setSelectedRoomId(data?.id || (items[0]?.id || null));
      setTimeout(() => { try { fitToView(); } catch(_) {} }, 0);
    } catch (e) { alert(e?.response?.data?.message || e?.message || 'Template konnte nicht erstellt werden'); }
  };

  // Booking timeline (simple day view)
  const tlStart = useMemo(() => new Date(new Date(day).setHours(6,0,0,0)), [day]);
  const tlEnd = useMemo(() => new Date(new Date(day).setHours(20,0,0,0)), [day]);
  const minutesTotal = (tlEnd - tlStart) / 60000;
  const pxPerMin = 2; // 2px per minute -> 28 min ~ 56px

  // Fit to view: compute zoom and pan to show whole room area (left aligned, width-fitted)
  const fitToView = useCallback(() => {
    const wrap = canvasWrapRef.current;
    if (!wrap) return;
    const innerW = (selectedRoom?.width || DEFAULT_GRID.width) * grid.size;
    const innerH = (selectedRoom?.height || DEFAULT_GRID.height) * grid.size;
    const pad = 24;
    const zw = (wrap.clientWidth - pad) / innerW;
    const z = clamp(zw, 0.3, 2);
    setZoom(z);
    const cx = 8;
    const cy = Math.max(8, (wrap.clientHeight - innerH * z) / 2);
    setPan({ x: cx, y: cy });
  }, [canvasWrapRef, grid.size, selectedRoom]);

  useEffect(() => { fitToView(); }, [fitToView]);

  

  const onBookingDragStart = (e, b) => {
    const rect = e.currentTarget.parentElement.getBoundingClientRect();
    const topOffset = e.clientY - rect.top;
    dragRef.current = { bookingId: b.id, offsetY: topOffset };
  };
  const onTimelineMouseMove = (e) => {
    if (!dragRef.current?.bookingId) return;
    const cont = e.currentTarget;
    const rect = cont.getBoundingClientRect();
    const y = clamp(e.clientY - rect.top - dragRef.current.offsetY, 0, rect.height - 10);
    const minutes = Math.round(y / pxPerMin);
    const startDate = new Date(tlStart.getTime() + minutes * 60000);
    setBookings((prev) => prev.map((x) => x.id === dragRef.current.bookingId ? { ...x, start_time: startDate.toISOString(), end_time: new Date(startDate.getTime() + (new Date(x.end_time) - new Date(x.start_time))).toISOString() } : x));
  };
  const onTimelineMouseUp = async () => {
    if (!dragRef.current?.bookingId) return;
    const id = dragRef.current.bookingId; dragRef.current = null;
    const b = bookings.find(x => x.id === id);
    if (!b) return;
    try {
      await api.patch(`/api/rooms/bookings/${encodeURIComponent(id)}`, { start_time: b.start_time, end_time: b.end_time });
      setSavedTick((n) => n + 1); loadBookings();
    } catch (e) { alert(e?.response?.data?.message || e?.message || 'Änderung konnte nicht gespeichert werden'); }
  };

  const filteredRooms = useMemo(() => rooms.filter(r => {
    const byName = !roomFilter || String(r.name).toLowerCase().includes(roomFilter.toLowerCase());
    const byType = !roomTypeFilter || String(r.type).toLowerCase() === String(roomTypeFilter).toLowerCase();
    return byName && byType;
  }), [rooms, roomFilter, roomTypeFilter]);

  const CONTENT_VH = 84;
  const content = (
    <div className="responsive-patient-wrapper" style={{ padding: 0, display:'grid', gridTemplateColumns: '200px minmax(0, 1fr) 220px', gap: 12, height: `${CONTENT_VH}vh`, overflow: 'hidden', boxSizing: 'border-box' }}>
      {/* Left: rooms + library */}
      <div style={{ borderRight: '1px solid #e5e7eb', paddingRight: 8, overflow: 'auto' }}>
        <div style={{ display:'flex', flexDirection:'column', gap: 6 }}>
          <input
            type="text"
            placeholder="Raum suchen…"
            value={roomFilter}
            onChange={(e) => setRoomFilter(e.target.value)}
            style={{ width: '100%' }}
          />
          <select
            value={roomTypeFilter}
            onChange={(e) => setRoomTypeFilter(e.target.value)}
            style={{ width: '100%' }}
          >
            <option value="">Alle Typen</option>
            {Array.from(new Set(rooms.map(r => r.type))).map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <label style={{ display:'flex', alignItems:'center', gap: 6 }}>
            <input type="checkbox" checked={activeOnly} onChange={() => setActiveOnly(v => !v)} />
            <span>Nur aktive</span>
          </label>
        </div>
        <div style={{ marginTop: 8 }}>
          {filteredRooms.map(r => (
            <div key={r.id} tabIndex={0} onKeyDown={(e)=>{ if(e.key==='Enter'){ setSelectedRoomId(r.id); } }} onClick={() => setSelectedRoomId(r.id)} style={{ padding:'6px 8px', cursor:'pointer', borderRadius: 6, background: selectedRoomId === r.id ? '#eef2ff' : 'transparent', border: '1px solid #e5e7eb', marginBottom: 6 }}>
              <div style={{ display:'flex', justifyContent:'space-between' }}>
                <strong>{r.name}</strong>
                <span title={r.occupied ? 'belegt' : 'frei'} style={{ color: r.occupied ? '#dc2626' : '#16a34a' }}>
                  {r.occupied ? '• belegt' : '• frei'}
                </span>
              </div>
              <div style={{ color:'#6b7280' }}>{r.type}</div>
            </div>
          ))}
        </div>
        {canEditRooms && (
          <div style={{ marginTop: 10 }}>
            <button className="btn-save" onClick={async () => {
              const name = prompt('Name des neuen Raumes?');
              if (!name) return;
              const type = prompt('Typ (z.B. OP, AUFWACHRAUM, SPRECHZIMMER, LAGER, WARTEZIMMER, BÜRO, SONSTIGES)', 'SPRECHZIMMER') || 'SPRECHZIMMER';
              const width = Number(prompt('Breite (Grid)', '24') || 24);
              const height = Number(prompt('Höhe (Grid)', '16') || 16);
              try {
                const { data } = await api.post('/api/rooms', { name, type, width, height, active: true });
                setRoomFilter(''); setRoomTypeFilter('');
                const items = await loadRooms();
                setSelectedRoomId(data?.id || (items[0]?.id || null));
                setTimeout(() => { try { fitToView(); } catch(_) {} }, 0);
              } catch (e) { alert(e?.response?.data?.message || e?.message || 'Erstellen fehlgeschlagen'); }
            }}>Raum anlegen</button>
            <div style={{ marginTop: 8 }}>
              <div style={{ fontWeight:600, marginBottom: 4 }}>Templates</div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                <button className="btn-cancel" onClick={() => createFromTemplate('STANDARD_OP')}>Standard‑OP</button>
                <button className="btn-cancel" onClick={() => createFromTemplate('STANDARD_AUFWACH')}>Aufwachraum</button>
                <button className="btn-cancel" onClick={() => createFromTemplate('STANDARD_SPRECH')}>Sprechzimmer</button>
              </div>
              <div style={{ marginTop: 8 }}>
                <div style={{ fontWeight:600, marginBottom: 4 }}>Neues Bibliotheks‑Objekt</div>
                <LibraryObjectCreator onCreate={(obj) => setLibrary((prev) => [...prev, obj])} />
              </div>
            </div>
          </div>
        )}
        <hr />
        <div style={{ fontWeight:600, marginBottom:6 }}>Objektbibliothek</div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(2, 1fr)', gap:6 }}>
          {(library || OBJECT_LIBRARY).map(item => (
            <div key={`${item.key}:${item.label}`} draggable={canEditRooms} onDragStart={(e) => onLibraryDragStart(e, item)} title={canEditRooms ? `Ziehen zum Platzieren (${item.label})` : 'Keine Berechtigung zum Bearbeiten'} style={{ opacity: canEditRooms ? 1 : 0.6, border:'1px dashed #cbd5e1', borderRadius:6, padding:'8px', background:'#f8fafc', textAlign:'center', cursor: canEditRooms ? 'grab' : 'not-allowed' }}>
              <div style={{ width: 16*item.w, height: 16*item.h, background:item.color, margin:'0 auto 6px', border:'1px solid #94a3b8' }} />
              <small>{item.label}</small>
            </div>
          ))}
        </div>
      </div>

      {/* Center: canvas */}
      <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
        <div style={{ display:'flex', gap: 8, alignItems:'center', marginBottom: 8 }}>
          <strong>{selectedRoom?.name || '–'}</strong>
          <span style={{ color:'#6b7280' }}>{selectedRoom?.type}</span>
          <div style={{ marginLeft:'auto', display:'flex', gap: 6 }}>
            <label><input type="checkbox" checked={gridOn} onChange={() => setGridOn(v => !v)} /> Grid</label>
            <label><input type="checkbox" checked={snap} onChange={() => setSnap(v => !v)} /> Snap</label>
            <button className="btn-cancel" onClick={() => setZoom(1)}>100%</button>
            <button className="btn-cancel" onClick={() => setZoom(z => clamp(z-0.1, 0.4, 2))}>-</button>
            <button className="btn-cancel" onClick={() => setZoom(z => clamp(z+0.1, 0.4, 2))}>+</button>
            <button className="btn-cancel" onClick={fitToView}>Fit</button>
            <button className="btn-cancel" onClick={undo} disabled={!history.length}>Undo</button>
            <button className="btn-cancel" onClick={redo} disabled={!future.length}>Redo</button>
            {savedTick > 0 && <span style={{ color:'#16a34a' }}>✓ gespeichert</span>}
          </div>
        </div>
        <div
          ref={(el) => { canvasRef.current = el; canvasWrapRef.current = el; }}
          onDrop={onCanvasDrop}
          onDragOver={onCanvasDragOver}
          onMouseMove={onCanvasMouseMove}
          onMouseUp={onCanvasMouseUp}
          onWheel={onCanvasWheel}
          onMouseDown={onCanvasBackgroundMouseDown}
          style={{
            border:'1px solid #e5e7eb', borderRadius:8, height: 'calc(100% - 44px)', overflow:'auto', position:'relative',
            backgroundImage: gridOn ? `linear-gradient(#f1f5f9 1px, transparent 1px), linear-gradient(90deg, #f1f5f9 1px, transparent 1px)` : 'none',
            backgroundSize: grid.size+'px '+grid.size+'px', backgroundPosition:'0 0'
          }}
        >
          <div style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin:'0 0', width: grid.width*grid.size, height: grid.height*grid.size, position:'relative' }}>
            {/* Room boundary */}
            <div style={{ position:'absolute', left:0, top:0, width: '100%', height:'100%', boxShadow:'inset 0 0 0 2px #94a3b8', borderRadius: 6 }} />
            {/* Objects */}
            {layout.map(obj => (
              <div
                key={obj.id}
                onMouseDown={(e) => onObjectMouseDown(e, obj)}
                onClick={(e) => { e.stopPropagation(); setSelectedObjId(obj.id); }}
                title={`${obj.type} (${obj.width}x${obj.height})`}
                style={{
                  position:'absolute',
                  left: obj.x*grid.size,
                  top: obj.y*grid.size,
                  width: obj.width*grid.size,
                  height: obj.height*grid.size,
                  background: '#e2e8f0',
                  border: selectedObjId === obj.id ? '2px solid #3b82f6' : '1px solid #94a3b8',
                  transform: `rotate(${obj.rotation||0}deg)`,
                  display:'flex', alignItems:'center', justifyContent:'center', fontSize: 10,
                  userSelect:'none', cursor: canEditRooms ? 'move' : 'default'
                }}
              >
                {obj.type}
              </div>
            ))}
          </div>
        </div>
        {selectedObjId && (
          <div style={{ display:'flex', gap:8, marginTop:8, justifyContent:'flex-end' }}>
            <button className="btn-cancel" onClick={() => rotateSelected(-90)}>⟲ Rotieren</button>
            <button className="btn-cancel" onClick={() => rotateSelected(90)}>⟳ Rotieren</button>
            <button className="btn-cancel" onClick={deleteSelected}>Löschen</button>
          </div>
        )}
      </div>

      {/* Right: details + occupancy */}
      <div style={{ borderLeft:'1px solid #e5e7eb', paddingLeft: 8, height:'100%', overflow:'auto' }}>
        <div style={{ marginBottom: 8 }}>
          <h4 style={{ margin: '4px 0' }}>Raumdetails</h4>
          {selectedRoom ? (
            <RoomDetails room={selectedRoom} onSaved={async () => { await loadRooms(); }} canEdit={canEditRooms} />
          ) : <div style={{ color:'#6b7280' }}>Kein Raum ausgewählt</div>}
        </div>
        <hr />
        <div>
          <h4 style={{ margin:'4px 0' }}>Belegung</h4>
          <div style={{ display:'flex', flexDirection:'column', gap:6, marginBottom:8 }}>
            <input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
            <button className="btn-save" type="button" onClick={loadBookings}>Aktualisieren</button>
            <button
              className="btn-save"
              type="button"
              onClick={() => { setEditingBooking(null); setShowBookingDialog(true); }}
              disabled={!selectedRoom}
            >
              Neue Buchung
            </button>
          </div>
          <div style={{ position:'relative', height: minutesTotal*pxPerMin, border:'1px solid #e5e7eb', borderRadius:8 }}
               onMouseMove={onTimelineMouseMove}
               onMouseUp={onTimelineMouseUp}
          >
            {[...Array(15)].map((_,i) => (
              <div key={i} style={{ position:'absolute', left:0, right:0, top: i*(minutesTotal/15)*pxPerMin, height:1, background:'#e5e7eb' }} />
            ))}
            {bookings.map((b) => {
              const s = new Date(b.start_time); const e = new Date(b.end_time);
              const top = clamp(((s - tlStart)/60000) * pxPerMin, 0, minutesTotal*pxPerMin-8);
              const height = Math.max(10, ((e - s)/60000) * pxPerMin);
              return (
                <div key={b.id} onMouseDown={(ev) => onBookingDragStart(ev, b)} onDoubleClick={() => { setEditingBooking(b); setShowBookingDialog(true); }}
                     style={{ position:'absolute', left: 8, right: 8, top, height, background: b.color || '#93c5fd', border:'1px solid #3b82f6', borderRadius:6, padding:'4px 6px', cursor:'grab' }}>
                  <div style={{ display:'flex', justifyContent:'space-between' }}>
                    <strong>{new Date(b.start_time).toLocaleTimeString('de-CH', { hour: '2-digit', minute:'2-digit' })}</strong>
                    <span>{b.vorname || ''} {b.nachname || ''}</span>
                  </div>
                  <div style={{ fontSize:12 }}>{b.note || b.procedure_type || ''}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );

  return inline ? (
    <>
      <h2 className="h2" style={{ marginTop: 0 }}>Raum‑Planung</h2>
      {error && <div style={{ color:'crimson' }}>{error}</div>}
      {content}
      <BookingDialog open={showBookingDialog} onClose={() => setShowBookingDialog(false)} room={selectedRoom} initial={editingBooking} onSaved={loadBookings} />
    </>
  ) : (
    <div className="popup-overlay">
      <div className="popup-container wide-popup">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 className="h2" style={{ margin: 0 }}>Raum-Planung</h2>
          <button className="btn-cancel" onClick={() => onClose?.()} title="Schließen" type="button">❌</button>
        </div>
        <hr />
        {error && <div style={{ color:'crimson' }}>{error}</div>}
        {content}
        <BookingDialog open={showBookingDialog} onClose={() => setShowBookingDialog(false)} room={selectedRoom} initial={editingBooking} onSaved={loadBookings} />
      </div>
    </div>
  );
}

function RoomDetails({ room, onSaved, canEdit }) {
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState({ name: room.name, type: room.type, floor: room.floor || '', building: room.building || '', width: room.width || DEFAULT_GRID.width, height: room.height || DEFAULT_GRID.height, color: room.color || '' });
  useEffect(() => { setForm({ name: room.name, type: room.type, floor: room.floor || '', building: room.building || '', width: room.width || DEFAULT_GRID.width, height: room.height || DEFAULT_GRID.height, color: room.color || '' }); }, [room]);
  const save = async () => {
    try {
      await api.patch(`/api/rooms/${encodeURIComponent(room.id)}`, { ...form, width: Number(form.width), height: Number(form.height) });
      setEdit(false); onSaved && onSaved();
    } catch (e) { alert(e?.response?.data?.message || e?.message || 'Speichern fehlgeschlagen'); }
  };
  if (!canEdit) {
    return (
      <div style={{ fontSize:14, color:'#334155' }}>
        <div><strong>Name:</strong> {room.name}</div>
        <div><strong>Typ:</strong> {room.type}</div>
        <div><strong>Etage:</strong> {room.floor || '–'}</div>
        <div><strong>Gebäude:</strong> {room.building || '–'}</div>
        <div><strong>Größe:</strong> {room.width || DEFAULT_GRID.width} × {room.height || DEFAULT_GRID.height}</div>
      </div>
    );
  }
  return edit ? (
    <div style={{ display:'grid', gap:8 }}>
      <label>Name <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
      <label>Typ <input type="text" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} /></label>
      <label>Etage <input type="text" value={form.floor} onChange={(e) => setForm({ ...form, floor: e.target.value })} /></label>
      <label>Gebäude <input type="text" value={form.building} onChange={(e) => setForm({ ...form, building: e.target.value })} /></label>
      <div style={{ display:'flex', gap:8 }}>
        <label>Breite <input type="number" value={form.width} onChange={(e) => setForm({ ...form, width: e.target.value })} /></label>
        <label>Höhe <input type="number" value={form.height} onChange={(e) => setForm({ ...form, height: e.target.value })} /></label>
      </div>
      <div style={{ display:'flex', gap:8, alignItems:'center' }}>
        <label>Farbe</label>
        <input type="color" value={form.color || '#ffffff'} onChange={(e) => setForm({ ...form, color: e.target.value })} />
      </div>
      <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
        <button className="btn-cancel" onClick={() => setEdit(false)}>Abbrechen</button>
        <button className="btn-save" onClick={save}>Speichern</button>
      </div>
    </div>
  ) : (
    <div style={{ fontSize:14, color:'#334155' }}>
      <div><strong>Name:</strong> {room.name}</div>
      <div><strong>Typ:</strong> {room.type}</div>
      <div><strong>Etage:</strong> {room.floor || '–'}</div>
      <div><strong>Gebäude:</strong> {room.building || '–'}</div>
      <div><strong>Größe:</strong> {room.width || DEFAULT_GRID.width} × {room.height || DEFAULT_GRID.height}</div>
      <div style={{ marginTop:8 }}>
        <button className="btn-save" onClick={() => setEdit(true)}>Bearbeiten</button>
      </div>
    </div>
  );
}

function LibraryObjectCreator({ onCreate }) {
  const [label, setLabel] = useState('Gerät');
  const [type, setType] = useState('MACHINE');
  const [w, setW] = useState(2);
  const [h, setH] = useState(2);
  const [color, setColor] = useState('#fda4af');
  const create = () => {
    const key = String(type || 'OTHER').toUpperCase();
    const obj = { key, label: label || key, w: Math.max(1, Number(w)||1), h: Math.max(1, Number(h)||1), color: color || '#e5e7eb' };
    onCreate && onCreate(obj);
  };
  return (
    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6, alignItems:'center' }}>
      <input type="text" placeholder="Bezeichnung" value={label} onChange={(e)=>setLabel(e.target.value)} />
      <select value={type} onChange={(e)=>setType(e.target.value)}>
        {['BED','OP_TABLE','MONITOR','MACHINE','CABINET','CHAIR','DESK','WALL','OTHER'].map(t => <option key={t} value={t}>{t}</option>)}
      </select>
      <input type="number" min={1} value={w} onChange={(e)=>setW(e.target.value)} title="Breite" />
      <input type="number" min={1} value={h} onChange={(e)=>setH(e.target.value)} title="Höhe" />
      <input type="color" value={color} onChange={(e)=>setColor(e.target.value)} />
      <button className="btn-save" onClick={create}>Hinzufügen</button>
    </div>
  );
}
