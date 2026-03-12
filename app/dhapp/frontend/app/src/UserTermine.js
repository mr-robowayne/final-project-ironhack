// src/TerminPopup.js
import React, { useState, useEffect, useMemo } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCalendarAlt } from "@fortawesome/free-solid-svg-icons";
import CalendarPopup from "./CalendarPopup";
import "./UserTermine.css";
import { getTenantId } from "./api";

/** Basis-URL */
function getApiBase(API_BASE) {
  return (API_BASE || process.env.REACT_APP_API_BASE || `${window.location.protocol}//${window.location.host}`).replace(/\/+$/, "");
}

/** Server erwartet ISO-Strings; hier daraus die SQL-Felder ableiten (nur für Anzeige) */
function toYMD(date) {
  // YYYY-MM-DD
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}
function toHM(date) {
  // HH:MM
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  return d.toTimeString().slice(0, 5);
}

/** Serverantwort normalisieren:
 *  - unterstützt {start,end,termin_name,beschreibung,patient_name} (aktuelles Backend)
 *  - und {termin_datum,startzeit,endzeit,...} (falls du mal direkt solche Objekte gibst)
 */
function normalizeEvent(ev) {
  // 1) Neues Format (explizite ISO-Zeiten)
  if (ev.start && ev.end) {
    return {
      id: ev.id,
      termin_datum: toYMD(ev.start),
      startzeit: toHM(ev.start),
      endzeit: toHM(ev.end),
      termin_name: ev.termin_name || ev.reason || "",
      beschreibung: ev.beschreibung || "",
      patient_id: ev.patient_id,
      patient_name: ev.patient_name || "",
    };
  }

  // 2) Kalender-Format aus dem Backend (starts_at/duration_minutes)
  if (ev.starts_at || ev.start_time || ev.start_at) {
    const startIso = ev.starts_at || ev.start_time || ev.start_at;
    const start = new Date(startIso);
    const durMin = Number(ev.duration_minutes || ev.duration || 30);
    const end = ev.end_time || ev.end_at
      ? new Date(ev.end_time || ev.end_at)
      : new Date(start.getTime() + (Number.isFinite(durMin) ? durMin : 30) * 60000);
    return {
      id: ev.id,
      termin_datum: toYMD(start),
      startzeit: toHM(start),
      endzeit: toHM(end),
      termin_name: ev.termin_name || ev.reason || "",
      beschreibung: ev.beschreibung || "",
      patient_id: ev.patient_id,
      patient_name: ev.patient_name || "",
    };
  }

  // 3) Altes Formular-Format (direkte Felder)
  return {
    id: ev.id,
    termin_datum: ev.termin_datum || "",
    startzeit: ev.startzeit || "",
    endzeit: ev.endzeit || "",
    termin_name: ev.termin_name || ev.reason || "",
    beschreibung: ev.beschreibung || "",
    patient_id: ev.patient_id,
    patient_name: ev.patient_name || "",
  };
}

async function saveAppointment({ API, patientId, terminName, beschreibung, date, time, dauer }) {
  const startTime = new Date(`${date}T${time}`);
  if (Number.isNaN(startTime.getTime())) throw new Error("Ungültige Startzeit/Datum");
  const endTime = new Date(startTime.getTime() + Number(dauer) * 60 * 60 * 1000);
  const body = {
    patient_id: patientId,
    termin_name: terminName,
    beschreibung,
    termin_datum: date, // YYYY-MM-DD
    start_time: startTime.toISOString(),
    end_time: endTime.toISOString(),
  };
  const tenant = getTenantId();
  const res = await fetch(`${API}/api/appointments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(tenant ? { "X-Tenant-ID": tenant } : {}),
    },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || "Fehler beim Speichern des Termins");
  try { return JSON.parse(text); } catch { return text; }
}

const TerminPopup = ({ show, patient, onClose, onSave, API_BASE, onMinimize, initialState }) => {
  const API = useMemo(() => getApiBase(API_BASE), [API_BASE]);

  const [appointment, setAppointment] = useState({
    date: "",
    time: "",
    duration: "",
    type: "",
    description: "",
  });
  useEffect(() => {
    if (initialState && typeof initialState === 'object') {
      setAppointment((prev) => ({ ...prev, ...initialState }));
    }
  }, [initialState]);
  const [appointments, setAppointments] = useState([]);
  const [hoveredId, setHoveredId] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [showCalendar, setShowCalendar] = useState(false);
  const [loading, setLoading] = useState(false);

  /** Termine laden: Backend liefert alle, wir filtern clientseitig */
  const loadAppointments = async (p) => {
    if (!p) return;
    setLoading(true);
    try {
      const tenant = getTenantId();
      // Use server-side filtering by patient_id to avoid 400 errors from calendar-only endpoint
      const res = await fetch(`${API}/api/appointments?patient_id=${encodeURIComponent(p.id)}`, {
        credentials: 'include',
        headers: tenant ? { 'X-Tenant-ID': tenant } : {}
      });
      if (!res.ok) throw new Error("Fehler beim Laden der Termine");
      const data = await res.json();

      // Normalisieren und patient-spezifisch filtern
      const fullName = `${p.vorname || ""} ${p.nachname || ""}`.trim();
      const normalized = (Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : [])).map(normalizeEvent);
      const filtered = normalized.filter((ev) => {
        // Wenn patient_id mitkommt, verlässlich danach filtern
        if (ev.patient_id && Number(ev.patient_id) === Number(p.id)) return true;
        // Fallback: patient_name vergleichen
        return ev.patient_name && ev.patient_name.trim() === fullName;
      });

      setAppointments(filtered);
    } catch (e) {
      console.error(e);
      setAppointments([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (show && patient) loadAppointments(patient);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, patient?.id]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setAppointment((prev) => ({ ...prev, [name]: value }));
  };

  const calculateEndTime = () => {
    if (!appointment.time || !appointment.duration) return "";
    const [h, m] = appointment.time.split(":").map(Number);
    const endHour = (h + parseInt(appointment.duration, 10)) % 24;
    return `${String(endHour).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    };
  
  const handleSave = async () => {
    if (!appointment.type || !appointment.date || !appointment.time || !appointment.duration) {
      alert("Bitte Terminart, Datum, Uhrzeit und Dauer angeben.");
      return;
    }
    try {
      const result = await saveAppointment({
        API,
        patientId: patient.id,
        terminName: appointment.type,
        beschreibung: appointment.description,
        date: appointment.date,
        time: appointment.time,
        dauer: Number(appointment.duration),
      });
      await loadAppointments(patient);
      setAppointment({ date: "", time: "", duration: "", type: "", description: "" });
      if (onSave) onSave(result);
    } catch (e) {
      console.error(e);
      alert("Speichern fehlgeschlagen.");
    }
  };

  const handleDelete = async (id) => {
    if (!id) return;
    if (!window.confirm("Termin wirklich löschen?")) return;
    try {
      const tenant = getTenantId();
      const response = await fetch(`${API}/api/appointments/${id}`, {
        method: "DELETE",
        credentials: 'include',
        headers: tenant ? { 'X-Tenant-ID': tenant } : {}
      });
      if (!response.ok) {
        const txt = await response.text();
        console.error(txt);
        alert("Fehler beim Löschen des Termins.");
        return;
      }
      await loadAppointments(patient);
    } catch (error) {
      console.error(error);
      alert("Netzwerkfehler beim Löschen des Termins.");
    }
  };

  if (!show || !patient) return null;

  return (
    <>
      <div className="popup-overlay">
        <div className="popup-container">
          <h2 className="h2" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'relative' }}>
            <span style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)' }}>Terminplaner für {patient.vorname} {patient.nachname}</span>
            {onMinimize && (
              <button type="button" className="btn-cancel" onClick={() => onMinimize(appointment)} title="Als Tab ablegen" style={{ background: '#e0e7ff', color: '#3730a3', borderColor: '#c7d2fe' }}>Als Tab</button>
            )}
          </h2>

          <button
            onClick={() => setShowCalendar(true)}
            style={{
              marginBottom: "10px",
              backgroundColor: "#007bff",
              color: "white",
              border: "none",
              borderRadius: "4px",
              padding: "8px 12px",
              cursor: "pointer",
              float: "right",
            }}
            type="button"
          >
            <FontAwesomeIcon icon={faCalendarAlt} /> Kalender öffnen
          </button>
          <br />
          <hr />

          {/* Terminliste */}
          <div className="planned-appointments">
            <h3>Geplante Termine</h3>
            <br />
            {loading ? (
              <p>Lade…</p>
            ) : appointments.length === 0 ? (
              <p>Keine Termine geplant.</p>
            ) : (
              <ul>
                {appointments.map((termin) => {
                  const isHovered = hoveredId === termin.id;
                  const isSelected = selectedId === termin.id;
                  return (
                    <li
                      key={termin.id}
                      style={{
                        marginBottom: "10px",
                        position: "relative",
                        padding: "8px",
                        borderRadius: "5px",
                        backgroundColor: isHovered || isSelected ? "rgba(0, 123, 255, 0.1)" : "transparent",
                        cursor: "pointer",
                      }}
                      onMouseEnter={() => setHoveredId(termin.id)}
                      onMouseLeave={() => setHoveredId(null)}
                      onClick={() => setSelectedId(selectedId === termin.id ? null : termin.id)}
                    >
                      <strong>Datum:</strong> {termin.termin_datum || "–"} {" | "}
                      <strong>Uhrzeit:</strong>{" "}
                      {termin.startzeit && termin.endzeit ? `${termin.startzeit} - ${termin.endzeit}` : "–"} {" | "}
                      <strong>Terminart:</strong> {termin.termin_name || "–"} {" | "}
                      <strong>Beschreibung:</strong> {termin.beschreibung || "–"}
                      {isSelected && (
                        <div style={{ position: "absolute", top: "5px", right: "5px" }}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(termin.id);
                            }}
                            style={{ border: "1px solid red", color: "red", padding: "5px 10px", borderRadius: "4px" }}
                            type="button"
                          >
                            Löschen
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Terminformular */}
          <hr />
          <h2>Neuen Termin planen</h2>
          <form onSubmit={(e) => e.preventDefault()}>
            <div className="form-group">
              <label>Terminart</label>
              <select name="type" value={appointment.type} onChange={handleChange} required>
                <option value="">Bitte wählen...</option>
                <option value="sprechstunde">Sprechstunde</option>
                <option value="kontrolle">Kontrolle</option>
                <option value="impfung">Impfung</option>
                <option value="nachsorge">Nachsorge</option>
              </select>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Datum</label>
                <input type="date" name="date" value={appointment.date} onChange={handleChange} required />
              </div>
              <div className="form-group">
                <label>Uhrzeit</label>
                <input type="time" name="time" value={appointment.time} onChange={handleChange} required />
              </div>
            </div>

            <div className="form-group">
              <label>Dauer (in Stunden)</label>
              <select name="duration" value={appointment.duration} onChange={handleChange} required>
                <option value="">Bitte wählen...</option>
                {[1, 2, 3, 4].map((h) => (
                  <option key={h} value={h}>
                    {h} Stunde{h > 1 ? "n" : ""}
                  </option>
                ))}
              </select>
            </div>

            {appointment.time && appointment.duration && (
              <div className="form-group">
                <label>Endzeit</label>
                <div className="end-time">{calculateEndTime()}</div>
              </div>
            )}

            <div className="form-group">
              <label>Beschreibung</label>
              <textarea name="description" value={appointment.description} onChange={handleChange} />
            </div>

            <div className="form-actions">
              <button type="button" className="btn-save" onClick={handleSave}>
                Termin speichern
              </button>
              <button type="button" className="btn-cancel" onClick={onClose}>
                Abbrechen
              </button>
            </div>
          </form>
        </div>
      </div>

      {showCalendar && <CalendarPopup onClose={() => setShowCalendar(false)} />}
    </>
  );
};

export default TerminPopup;
