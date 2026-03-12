// src/main_kalender.js
import './ModernCalendar.css';
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Calendar, momentLocalizer } from 'react-big-calendar';
import moment from 'moment';
import 'moment/locale/de';
import 'react-big-calendar/lib/css/react-big-calendar.css';

moment.locale('de');
const localizer = momentLocalizer(moment);

// ---------- Utils ----------
const toNum = (v) => (v == null || v === '' ? null : Number(v));
const normId = (v) => (v == null ? null : String(v));
const clampMins = (m) => Math.max(5, Math.min(24 * 60, Number(m || 30)));
const toLocalInputValue = (d) => {
  const pad = (n) => String(n).padStart(2, '0');
  const dt = new Date(d);
  const yyyy = dt.getFullYear();
  const mm = pad(dt.getMonth() + 1);
  const dd = pad(dt.getDate());
  const hh = pad(dt.getHours());
  const mi = pad(dt.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
};
const parseLocalInput = (s) => (s ? new Date(s) : null);

// Farbpalette stabil je Kalender
const palette = [
  '#FF2D55', '#007AFF', '#34C759', '#FF9500', '#AF52DE',
  '#5AC8FA', '#FFCC00', '#FF3B30', '#5856D6', '#30B0C7',
];

// Event normalisieren
const normalizeEvent = (row) => {
  const startIso = row.starts_at || row.start || row.start_at;
  const dur = Number(row.duration_minutes || row.duration || 30);
  let endIso = row.ends_at || row.end || row.end_at;

  let start = startIso ? new Date(startIso) : null;
  let end = endIso ? new Date(endIso) : null;

  if (!start && (row.termin_datum && row.startzeit)) {
    start = new Date(`${row.termin_datum}T${row.startzeit}`);
  }
  if (!end) {
    if (row.termin_datum && row.endzeit) {
      end = new Date(`${row.termin_datum}T${row.endzeit}`);
    } else if (start) {
      end = new Date(start.getTime() + clampMins(dur) * 60000);
    } else {
      const now = new Date();
      start = now;
      end = new Date(now.getTime() + 30 * 60000);
    }
  }

  const calId =
    row.calendar_id ??
    row.calendarId ??
    row.calendar?.id ??
    row.kalender_id ??
    row.kalenderId ??
    null;

  const patientName =
    row.patient_name ||
    [row.patient?.vorname, row.patient?.nachname].filter(Boolean).join(' ') ||
    row.patient?.name ||
    '';

  const baseTitle = row.reason || row.termin_name || row.title || 'Termin';
  const title = patientName ? `${patientName} – ${baseTitle}` : baseTitle;

  return {
    ...row,
    id: row.id,
    calendar_id: calId,
    start,
    end,
    title,
    reason: row.reason || '',
    notes: row.notes || row.beschreibung || '',
    status: row.status || '',
    patient_id: row.patient_id ?? row.patient?.id ?? null,
  };
};

// ---------- API ----------
async function apiGet(path, params = {}) {
  const q = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ''))
  );
  const res = await fetch(`/api${path}${q.toString() ? `?${q}` : ''}`, {
    method: 'GET',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  return { ok: res.ok, status: res.status, data };
}

async function apiSend(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  return { ok: res.ok, status: res.status, data };
}

async function getSessionInfo() {
  const { ok, data } = await apiGet('/session/me');
  if (!ok) throw new Error(data?.message || 'Session nicht verfügbar');
  return data;
}
async function getMyCalendars() {
  const { ok, data } = await apiGet('/calendars');
  if (!ok) throw new Error(data?.message || 'Kalender konnten nicht geladen werden');
  return Array.isArray(data?.items) ? data.items : (Array.isArray(data) ? data : []);
}

// server.js: GET /api/appointments/by-calendars?ids=1,2&from=...&to=...
async function getAppointmentsByCalendarIds(calendarIds = [], { start, end }) {
  const params = { ids: calendarIds.join(','), from: start?.toISOString(), to: end?.toISOString() };
  const { ok, data } = await apiGet('/appointments/by-calendars', params);
  if (!ok) throw new Error(data?.message || 'Termine konnten nicht geladen werden');
  return Array.isArray(data?.items) ? data.items : (Array.isArray(data) ? data : []);
}

// strikte Create/Update Payload: exakt starts_at/ends_at etc.
async function createAppointmentStrict(payload) {
  return apiSend('POST', '/appointments', payload);
}
async function updateAppointmentStrict(id, payload) {
  return apiSend('PUT', `/appointments/${id}`, payload);
}
async function deleteAppointment(id) { return apiSend('DELETE', `/appointments/${id}`); }

async function listAccessibleUsers() {
  const { ok, data } = await apiGet('/users/accessible');
  return ok && Array.isArray(data?.items) ? data.items : (Array.isArray(data) ? data : []);
}

// server.js: /api/patients/search?q=...
async function fetchPatients(q) {
  if (!q || q.trim().length < 2) return [];
  const { ok, data } = await apiGet('/patients/search', { q });
  if (!ok) return [];
  const items = Array.isArray(data?.items) ? data.items : (Array.isArray(data) ? data : []);
  return items.map((p) => ({
    id: p.id,
    name: p.name || [p.vorname, p.nachname].filter(Boolean).join(' ') || `Patient #${p.id}`,
    details: p.geburtsdatum || p.birthdate || '',
  }));
}

// ---------- Komponente ----------
const CalendarView = () => {
  const [events, setEvents] = useState([]);
  const [eventsByCal, setEventsByCal] = useState(new Map());
  const [selectedCalendarIds, setSelectedCalendarIds] = useState(new Set());
  const [myCalendars, setMyCalendars] = useState([]);

  const [loading, setLoading] = useState(false);

  // modal
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState('view'); // 'view' | 'create' | 'edit'
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [selectedEventId, setSelectedEventId] = useState(null);

  // form
  const [patientQuery, setPatientQuery] = useState('');
  const [patientOptions, setPatientOptions] = useState([]);
  const [patientId, setPatientId] = useState(''); // optional
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [startStr, setStartStr] = useState('');
  const [endStr, setEndStr] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [draftCalendarId, setDraftCalendarId] = useState('');
  const [assignUserId, setAssignUserId] = useState(''); // zusätzlicher Eintrag

  const [users, setUsers] = useState([]);
  const [selfUserId, setSelfUserId] = useState(null);

  const [view, setView] = useState('month');
  const [currentDate, setCurrentDate] = useState(new Date());
  const calendarRef = useRef(null);
  const [showCalendarPicker, setShowCalendarPicker] = useState(false);

  // letzter nur gemerkter Slot (öffnet kein Modal)
  const lastSlotRef = useRef(null);

  // Range für Lade-API
  const currentRange = useMemo(() => {
    const start =
      view === 'month'
        ? moment(currentDate).startOf('month').toDate()
        : view === 'week'
        ? moment(currentDate).startOf('week').toDate()
        : moment(currentDate).startOf('day').toDate(); // day/agenda
    const end =
      view === 'month'
        ? moment(currentDate).endOf('month').toDate()
        : view === 'week'
        ? moment(currentDate).endOf('week').toDate()
        : (view === 'agenda'
            ? moment(currentDate).add(30, 'days').endOf('day').toDate()
            : moment(currentDate).endOf('day').toDate());
    return { start, end };
  }, [view, currentDate]);

  // Farben: stabil über echte Kalenderliste
  const eventPropGetter = useCallback(
    (event) => {
      const calId = normId(event.calendar_id);
      const idxInList = myCalendars.findIndex((c) => normId(c.id) === calId);
      const idx = idxInList >= 0 ? idxInList : 0;
      const color = palette[idx % palette.length];
      const isSelected = selectedEventId === event.id;
      return {
        style: {
          backgroundColor: color,
          borderColor: isSelected ? '#0a84ff' : color,
          boxShadow: isSelected ? '0 0 0 2px rgba(10,132,255,.35)' : undefined,
          filter: 'saturate(0.95) brightness(0.98)',
        },
        className: isSelected ? 'event-selected' : '',
      };
    },
    [myCalendars, selectedEventId]
  );

  // ---------- API helpers ----------
  const refreshCalendars = useCallback(async () => {
    try {
      const cals = await getMyCalendars();
      const norm = Array.isArray(cals) ? cals.map((c) => ({ ...c, id: normId(c.id) })) : [];
      setMyCalendars(norm);
      return norm;
    } catch (e) {
      console.warn('Kalender konnten nicht neu geladen werden:', e?.message || e);
      setMyCalendars([]);
      return [];
    }
  }, []);

  const loadEvents = useCallback(async () => {
    const ids = Array.from(selectedCalendarIds);
    if (!ids.length) { setEvents([]); return; }
    setLoading(true);
    try {
      const rows = await getAppointmentsByCalendarIds(ids, currentRange);
      const normalized = rows.map(normalizeEvent);
      const byCal = new Map();
      for (const ev of normalized) {
        const key = normId(ev.calendar_id);
        if (!byCal.has(key)) byCal.set(key, []);
        byCal.get(key).push(ev);
      }
      setEventsByCal(byCal);
      setEvents(normalized);
    } catch (err) {
      console.error(err);
      alert(err?.message || 'Termine konnten nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, [selectedCalendarIds, currentRange]);

  // ---------- Init ----------
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const sess = await getSessionInfo();
        if (!alive) return;
        const userId = sess?.user?.id;
        setSelfUserId(userId || null);

        const cals = await refreshCalendars();
        if (!alive) return;

        const myUserCal =
          cals.find((c) => c.type === 'user' && Number(c.owner_user_id) === Number(userId)) || null;
        const defaultTenantCal =
          cals.find((c) => c.type === 'tenant' && (c.is_default || c.metadata?.is_default)) || null;

        if (myUserCal) {
          setSelectedCalendarIds(new Set([normId(myUserCal.id)]));
          setDraftCalendarId(normId(myUserCal.id));
        } else if (defaultTenantCal) {
          setSelectedCalendarIds(new Set([normId(defaultTenantCal.id)]));
          setDraftCalendarId(normId(defaultTenantCal.id));
        } else if (cals[0]) {
          setSelectedCalendarIds(new Set([normId(cals[0].id)]));
          setDraftCalendarId(normId(cals[0].id));
        } else {
          setSelectedCalendarIds(new Set());
          setDraftCalendarId('');
        }

        const u = await listAccessibleUsers().catch(() => []);
        setUsers(u);
      } catch (e) {
        console.warn('Init fehlgeschlagen:', e?.message || e);
        setSelectedCalendarIds(new Set());
      }
    })();
    return () => { alive = false; };
  }, [refreshCalendars]);

  useEffect(() => { loadEvents(); }, [loadEvents]);

  // ---------- Kalender hinzufügen / entfernen ----------
  const addCalendarId = async (id) => {
    const sId = normId(id);
    if (!sId) return;
    setSelectedCalendarIds((prev) => prev.has(sId) ? prev : new Set([...prev, sId]));
    setShowCalendarPicker(false);
    await loadEvents();
  };

  const removeCalendarId = (id) => {
    const sId = normId(id);
    setSelectedCalendarIds((prev) => {
      if (!prev.has(sId)) return prev;
      const next = new Set([...prev]); next.delete(sId);
      setEventsByCal((old) => { const m = new Map(old); m.delete(sId); return m; });
      const merged = [];
      for (const cid of next) merged.push(...(eventsByCal.get(cid) || []));
      setEvents(merged);
      return next;
    });
  };

  // ---------- Termin-Interaktion ----------
  const handleSelectEvent = (ev) => {
    setSelectedEvent(ev);
    setSelectedEventId(ev.id);
    setModalMode('view');
    setShowModal(true);
  };

  // Slot-Klick: kein Modal, nur merken
  const handleSelectSlot = ({ start, end }) => {
    lastSlotRef.current = { start, end };
  };

  const handleDelete = async () => {
    if (!selectedEvent) return;
    if (!window.confirm('Diesen Termin wirklich löschen?')) return;
    const res = await deleteAppointment(selectedEvent.id);
    if (!res.ok) { alert(res.data?.message || 'Löschen fehlgeschlagen'); return; }
    await loadEvents();
    setShowModal(false);
  };

  const validateTimes = () => {
    const start = parseLocalInput(startStr);
    const end = parseLocalInput(endStr);
    if (!start || !end) throw new Error('Start/Ende ungültig');
    if (end <= start) throw new Error('Ende muss nach Start liegen');
    const dur = Math.max(5, Math.round((end.getTime() - start.getTime()) / 60000));
    return { start, end, dur };
  };

  // Zusätzlichen Eintrag im User-Kalender (assignUserId) anlegen – inkl. Patientenzuordnung
  const createAlsoForAssignedUserIfAny = async (basePayload) => {
    const userId = toNum(assignUserId);
    if (!userId) return;
    const targetCal = myCalendars.find(
      (c) => c.type === 'user' && Number(c.owner_user_id) === userId
    );
    if (!targetCal) return; // kein User-Kalender vorhanden
    // Vermeide Duplikat im selben Kalender
    if (Number(basePayload.calendar_id) === Number(targetCal.id)) return;
    const payload = {
      ...basePayload,
      calendar_id: Number(targetCal.id),
    };
    const res2 = await createAppointmentStrict(payload);
    if (!res2.ok) throw new Error(res2?.data?.message || 'Zusätzlicher Benutzer-Eintrag fehlgeschlagen');
  };

  const handleCreate = async () => {
    try {
      const { start, end, dur } = validateTimes();
      const calendar_id = toNum(draftCalendarId);
      if (!calendar_id) throw new Error('Bitte Kalender wählen');

      // EXAKTE Payload für dein Backend
      // Falls kein Patient gewählt wurde, aber Freitext (patientQuery) vorhanden ist,
      // übernehmen wir den Text in die Terminbeschreibung, damit er beim Bearbeiten sichtbar bleibt.
      const freeTextPatient = (!toNum(patientId) && patientQuery && patientQuery.trim().length) ? patientQuery.trim() : '';

      // Build payload and only send patient_id when wirklich gewählt
      const basePayload = {
        calendar_id,
        starts_at: start.toISOString(),
        ends_at: end.toISOString(),
        duration_minutes: dur,
        reason: (reason && reason.trim().length ? reason.trim() : (freeTextPatient || null)),
        beschreibung: (notes && notes.trim().length ? notes.trim() : (freeTextPatient ? `Patient: ${freeTextPatient}` : null)),
      };
      if (toNum(patientId)) {
        basePayload.patient_id = toNum(patientId);
      }

      // 1) Haupttermin
      const res = await createAppointmentStrict(basePayload);
      if (!res.ok) throw new Error(res?.data?.message || res?.data?.error || 'Serverfehler beim Erstellen');

      // 2) Optional: weiterer Termin im zugewiesenen User-Kalender
      if (toNum(assignUserId)) {
        await createAlsoForAssignedUserIfAny(basePayload);
      }

      await loadEvents();
      setShowModal(false);
    } catch (err) {
      alert(err?.message || 'Fehler beim Erstellen');
      console.error('Create error:', err);
    }
  };

  const handleUpdate = async () => {
    try {
      if (!selectedEvent) return;
      const { start, end, dur } = validateTimes();
      const freeTextPatient = (!toNum(patientId) && patientQuery && patientQuery.trim().length) ? patientQuery.trim() : '';
      const payload = {
        starts_at: start.toISOString(),
        ends_at: end.toISOString(),
        duration_minutes: dur,
        reason: (reason && reason.trim().length ? reason.trim() : (freeTextPatient || null)),
        beschreibung: (notes && notes.trim().length ? notes.trim() : (freeTextPatient ? `Patient: ${freeTextPatient}` : null)),
        calendar_id: toNum(draftCalendarId) || selectedEvent.calendar_id || null,
      };
      if (toNum(patientId)) {
        payload.patient_id = toNum(patientId);
      } else {
        // Falls vorher ein Patient gesetzt war und nun entfernt wurde, explizit null senden
        if (selectedEvent.patient_id) payload.patient_id = null;
      }
      const res = await updateAppointmentStrict(selectedEvent.id, payload);
      if (!res.ok) throw new Error(res?.data?.message || res?.data?.error || 'Serverfehler beim Aktualisieren');

      // Gegenstück im Benutzerkalender verwalten
      await reconcileAssignedUserCounterpart({ baseStarts: start, duration: dur });
      await loadEvents();
      setShowModal(false);
    } catch (err) {
      alert(err?.message || 'Fehler beim Aktualisieren');
      console.error('Update error:', err);
    }
  };

  // Hilfsfunktion: Finde vorhandenen Gegenstück-Termin (User-Kalender) anhand Zeit und Patient
  const findCounterpart = (userId, starts) => {
    const uCal = myCalendars.find(c => c.type === 'user' && Number(c.owner_user_id) === Number(userId));
    if (!uCal) return null;
    const eventsIn = eventsByCal.get(normId(uCal.id)) || [];
    const ms = new Date(starts).getTime();
    const pid = toNum(patientId) || null;
    return eventsIn.find(ev => {
      const sameStart = ev.start && new Date(ev.start).getTime() === ms;
      const samePid = (toNum(ev.patient_id) || null) === pid;
      return sameStart && samePid;
    }) || null;
  };

  // Gegenstück nach Update anlegen/ändern/löschen
  const reconcileAssignedUserCounterpart = async ({ baseStarts, duration }) => {
    const targetUserId = toNum(assignUserId) || null;
    const basePayload = {
      calendar_id: toNum(draftCalendarId) || null,
      patient_id: toNum(patientId) || null,
      starts_at: baseStarts.toISOString(),
      duration_minutes: duration,
      reason: reason || null,
      beschreibung: notes || null,
    };

    // Finde existierenden Gegenstück (vorher evtl. anderer User)
    const anyUserCalEvents = myCalendars
      .filter(c => c.type === 'user')
      .flatMap(c => (eventsByCal.get(normId(c.id)) || []));
    const ms = baseStarts.getTime();
    const pid = toNum(patientId) || null;
    const existing = anyUserCalEvents.find(ev => (ev.start && new Date(ev.start).getTime() === ms) && ((toNum(ev.patient_id) || null) === pid));

    if (!targetUserId) {
      if (existing) {
        await deleteAppointment(existing.id);
      }
      return;
    }

    // Zielkalender (User) bestimmen
    const targetCal = myCalendars.find(c => c.type === 'user' && Number(c.owner_user_id) === Number(targetUserId));
    if (!targetCal) return; // kein Ziel vorhanden

    if (existing) {
      // Wenn vorhandener Gegenstück nicht im Zielkalender ist -> löschen + neu anlegen
      if (Number(existing.calendar_id) !== Number(targetCal.id)) {
        await deleteAppointment(existing.id);
        await createAppointmentStrict({ ...basePayload, calendar_id: Number(targetCal.id) });
      } else {
        // Im gleichen Userkalender: Update
        await updateAppointmentStrict(existing.id, { ...basePayload, calendar_id: Number(targetCal.id) });
      }
    } else {
      // Kein Gegenstück vorhanden: neu anlegen
      await createAppointmentStrict({ ...basePayload, calendar_id: Number(targetCal.id) });
    }
  };

  // ---------- Patientensuche ----------
  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const list = await fetchPatients(patientQuery);
        setPatientOptions(list);
      } catch { setPatientOptions([]); }
    }, 300);
    return () => clearTimeout(t);
  }, [patientQuery]);

  // ---------- Toolbar Navigation ----------
  const goPrev = () => {
    if (view === 'day' || view === 'agenda') setCurrentDate((d) => moment(d).add(-1, 'days').toDate());
    else if (view === 'week') setCurrentDate((d) => moment(d).add(-1, 'weeks').toDate());
    else setCurrentDate((d) => moment(d).add(-1, 'months').toDate());
  };
  const goNext = () => {
    if (view === 'day' || view === 'agenda') setCurrentDate((d) => moment(d).add(1, 'days').toDate());
    else if (view === 'week') setCurrentDate((d) => moment(d).add(1, 'weeks').toDate());
    else setCurrentDate((d) => moment(d).add(1, 'months').toDate());
  };

  // ---------- FAB: Start/Ende passend vorbelegen ----------
  const onFabCreate = () => {
    const now = new Date();
    let start = now;
    let end = new Date(now.getTime() + clampMins(durationMinutes) * 60000);

    if (view === 'day') {
      if (lastSlotRef.current?.start && lastSlotRef.current?.end) {
        start = lastSlotRef.current.start;
        end = lastSlotRef.current.end;
      } else {
        const base = moment(currentDate).startOf('day').toDate();
        start = new Date(base.getTime() + (now.getHours() * 60 + now.getMinutes()) * 60000);
        end = new Date(start.getTime() + clampMins(durationMinutes) * 60000);
      }
    } else if (view === 'week' || view === 'month') {
      const base = moment().startOf('day').toDate(); // heutiges Datum
      start = new Date(base.getTime() + (now.getHours() * 60 + now.getMinutes()) * 60000);
      end = new Date(start.getTime() + clampMins(durationMinutes) * 60000);
    }

    setSelectedEvent(null);
    setSelectedEventId(null);
    setModalMode('create');
    setReason('');
    setNotes('');
    setStartStr(toLocalInputValue(start));
    setEndStr(toLocalInputValue(end));

    const firstSelected =
      Array.from(selectedCalendarIds)[0] ||
      draftCalendarId ||
      (myCalendars[0]?.id ? normId(myCalendars[0].id) : '');
    setDraftCalendarId(firstSelected);
    setAssignUserId('');
    setPatientQuery('');
    setPatientOptions([]);
    setPatientId('');
    setShowModal(true);
  };

  // ---------- Render ----------
  return (
    <div className="calendar-container">
      {/* Linke Sidebar */}
      <div className="left-rail">
        <div className="rail-stack">
          <button
            title="Kalender hinzufügen"
            aria-label="Kalender hinzufügen"
            onClick={async () => {
              const next = !showCalendarPicker;
              if (next) await refreshCalendars();
              setShowCalendarPicker(next);
            }}
            className="add-calendar-button"
          >
            +
          </button>

          {showCalendarPicker && (
            <div className="calendar-picker-popover">
              {(myCalendars || [])
                .filter((c) => !selectedCalendarIds.has(normId(c.id)))
                .map((c, i) => (
                  <button
                    key={normId(c.id)}
                    onClick={() => addCalendarId(c.id)}
                    title={c.name}
                    className="calendar-picker-item"
                  >
                    <span className="calendar-picker-item-avatar" style={{ color: palette[i % palette.length] }}>
                      {(c.name || 'C').slice(0, 2).toUpperCase()}
                    </span>
                    <span className="calendar-picker-item-label">{c.name}</span>
                  </button>
                ))}
              {(!myCalendars ||
                myCalendars.filter((c) => !selectedCalendarIds.has(normId(c.id))).length === 0) && (
                <div className="calendar-picker-empty">Keine weiteren Kalender</div>
              )}
            </div>
          )}

          <div className="selected-cal-grid">
            {Array.from(selectedCalendarIds).map((id) => {
              const idxInList = myCalendars.findIndex((c) => normId(c.id) === normId(id));
              const color = palette[(idxInList >= 0 ? idxInList : 0) % palette.length];
              const cal = myCalendars.find((c) => normId(c.id) === id);
              const initials = (cal?.name || 'Cal').split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
              return (
                <div key={id} className="cal-avatar-wrap">
                  <div className="cal-avatar" style={{ background: color }} title={cal?.name}>
                    {initials}
                  </div>
                  {/* Hover-Overlay in gleicher Form, leicht dunkel, X in der Mitte */}
                  <button
                    className="cal-avatar-overlay"
                    onClick={() => removeCalendarId(id)}
                    aria-label="Kalender entfernen"
                    title="Entfernen"
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Rechte Seite */}
      <div className="calendar-stage">
        {/* Eigene Toolbar: alter RGB-Verlauf, nur „Agenda“ lila */}
        <div className="my-toolbar old-rgb">
          <div className="my-toolbar-left">
            <button onClick={goPrev} className="tb-nav">‹</button>
            <button onClick={() => setCurrentDate(new Date())} className="tb-ghost">Heute</button>
            <button onClick={goNext} className="tb-nav">›</button>
          </div>
          <div className="my-toolbar-center">
            <span>{moment(currentDate).format('dddd, DD. MMMM YYYY')}</span>
          </div>
          <div className="my-toolbar-right">
            <button className={`tb-pill ${view === 'day' ? 'active' : ''}`} onClick={() => setView('day')}>Tag</button>
            <button className={`tb-pill ${view === 'week' ? 'active' : ''}`} onClick={() => setView('week')}>Woche</button>
            <button className={`tb-pill ${view === 'month' ? 'active' : ''}`} onClick={() => setView('month')}>Monat</button>
            <button className={`tb-pill agenda-only ${view === 'agenda' ? 'active' : ''}`} onClick={() => setView('agenda')}>Agenda</button>
          </div>
        </div>

        <div className="calendar-shell">
          {/* Plus: unten rechts */}
          <button
            className="fab-bottom-right"
            title="Neuen Termin erstellen"
            aria-label="Neuen Termin erstellen"
            onClick={onFabCreate}
          >
            +
          </button>

          <Calendar
            ref={calendarRef}
            localizer={localizer}
            events={events}
            startAccessor="start"
            endAccessor="end"
            selectable
            style={{ height: '72vh' }}
            onSelectEvent={handleSelectEvent}
            onSelectSlot={handleSelectSlot}   // nur merken, nicht öffnen
            view={view}
            onView={setView}
            date={currentDate}
            onNavigate={setCurrentDate}
            eventPropGetter={eventPropGetter}
            toolbar={false}
          />
        </div>

        {loading && <div className="loading-hint">Lade Termine…</div>}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="modal" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            {modalMode === 'view' && selectedEvent && (
              <>
                <h3>Termin</h3>
                <div className="kv"><span>Termin für</span><span>{selectedEvent.title}</span></div>
                <div className="kv"><span>Patient-ID</span><span>{selectedEvent.patient_id ?? '—'}</span></div>
                <div className="kv"><span>Kalender</span><span>
                  {myCalendars.find((c) => normId(c.id) === normId(selectedEvent.calendar_id))?.name || selectedEvent.calendar_id}
                </span></div>
                <div className="kv"><span>Beschreibung</span><span>{selectedEvent.reason || '—'}</span></div>
                <div className="kv"><span>Notizen</span><span>{selectedEvent.notes || '—'}</span></div>
                <div className="kv"><span>Status</span><span>{selectedEvent.status || '—'}</span></div>
                <div className="kv"><span>Beginn</span><span>{moment(selectedEvent.start).format('DD.MM.YYYY HH:mm')}</span></div>
                <div className="kv"><span>Ende</span><span>{moment(selectedEvent.end).format('DD.MM.YYYY HH:mm')}</span></div>
                <div className="kv"><span>Dauer</span><span>{Math.round((selectedEvent.end - selectedEvent.start) / 60000)} Min</span></div>

                <div className="modal-actions-row">
                  <button className="btn-danger" onClick={handleDelete}>Löschen</button>
                  <button
                    className="btn-primary"
                    onClick={() => {
                      setModalMode('edit');
                      setReason(selectedEvent.reason || '');
                      setNotes(selectedEvent.notes || '');
                      setStartStr(toLocalInputValue(selectedEvent.start));
                      setEndStr(toLocalInputValue(selectedEvent.end));
                      // Kalender/Patient/User vorbelegen
                      setDraftCalendarId(normId(selectedEvent.calendar_id));
                      const hasPid = !!selectedEvent.patient_id;
                      setPatientId(hasPid ? String(selectedEvent.patient_id) : '');
                      // Wenn kein Patient verknüpft ist, Freitext aus reason/notes in das Suchfeld spiegeln
                      setPatientQuery(!hasPid ? (selectedEvent.reason || (selectedEvent.notes || '').replace(/^Patient:\s*/i,'')) : '');
                      // Bestehenden User-Gegenstück versuchen zu finden
                      try {
                        const ms = new Date(selectedEvent.start).getTime();
                        const pid = selectedEvent.patient_id ? Number(selectedEvent.patient_id) : null;
                        let foundAssign = '';
                        for (const cal of myCalendars.filter(c=>c.type==='user')) {
                          const evs = (eventsByCal.get(normId(cal.id)) || []);
                          const ex = evs.find(ev => (ev.start && new Date(ev.start).getTime()===ms) && ((toNum(ev.patient_id)||null)===pid));
                          if (ex) { foundAssign = String(cal.owner_user_id||''); break; }
                        }
                        setAssignUserId(foundAssign);
                      } catch {}
                    }}
                  >
                    Bearbeiten
                  </button>
                  <button className="btn-ghost" onClick={() => setShowModal(false)}>Schließen</button>
                </div>
              </>
            )}

            {modalMode !== 'view' && (
              <>
                <h3>{modalMode === 'create' ? 'Neuen Termin' : 'Termin'} anlegen</h3>

                <label>Kalender</label>
                <select value={draftCalendarId} onChange={(e) => setDraftCalendarId(e.target.value)}>
                  {myCalendars.map((c) => (
                    <option key={normId(c.id)} value={normId(c.id)}>{c.name}</option>
                  ))}
                </select>

                <label>Benutzer zuweisen (optional, zusätzlicher Eintrag)</label>
                <select value={assignUserId} onChange={(e) => setAssignUserId(e.target.value)}>
                  <option value="">— Keinen zusätzlichen Benutzer —</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
                  ))}
                </select>

                <label>Patient (optional – Suche)</label>
                <div className="patient-autocomplete">
                  <input
                    type="text"
                    value={patientQuery}
                    onChange={(e) => { setPatientQuery(e.target.value); setPatientId(''); }}
                    placeholder="Name, ID oder Geburtsdatum suchen…"
                  />
                  {!!patientOptions.length && patientQuery && (
                    <div className="ac-pop">
                      {patientOptions.map((p) => (
                        <button
                          key={p.id}
                          className="ac-item"
                          onClick={() => {
                            setPatientId(String(p.id));
                            setPatientQuery(`${p.name}`);
                            setPatientOptions([]);
                          }}
                          title={`ID: ${p.id}`}
                        >
                          <span className="ac-title">{p.name}</span>
                          {p.details && <span className="ac-sub">{p.details}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <label>Terminbeschreibung</label>
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="z.B. Verlaufskontrolle"
                />

                <label>Notizen (optional)</label>
                <textarea
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Kurze Notiz…"
                />

                <label>Start</label>
                <input type="datetime-local" value={startStr} onChange={(e) => setStartStr(e.target.value)} />

                <label>Ende</label>
                <input type="datetime-local" value={endStr} onChange={(e) => setEndStr(e.target.value)} />

                <div className="modal-actions-row">
                  {modalMode === 'create'
                    ? <button className="btn-primary" onClick={handleCreate}>Anlegen</button>
                    : <button className="btn-primary" onClick={handleUpdate}>Speichern</button>}
                  <button className="btn-ghost" onClick={() => setShowModal(false)}>Abbrechen</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default CalendarView;
