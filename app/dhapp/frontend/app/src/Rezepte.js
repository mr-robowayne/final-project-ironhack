// src/Rezepte.js
import React, { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPrescriptionBottleAlt } from "@fortawesome/free-solid-svg-icons";
import { getTenantId } from "./api";

const Rezepte = ({ selectedPatient, closepopup_rezepte, API_BASE, onMinimize, initialState }) => {
  const API = (API_BASE || `${window.location.protocol}//${window.location.host}`).replace(/\/+$/, "");

  const [rezeptData, setRezeptData] = useState({
    medikament: "", dosierung: "", haeufigkeit: "", dauer: "", hinweise: "",
  });

  React.useEffect(() => {
    if (initialState && typeof initialState === 'object') {
      setRezeptData((prev) => ({ ...prev, ...initialState }));
    }
  }, [initialState]);

  const handleRezeptChange = (e) => {
    const { name, value } = e.target;
    setRezeptData((prev) => ({ ...prev, [name]: value }));
  };

  const handleRezeptSubmit = async (e) => {
    e.preventDefault();
    try {
      const tenantId = getTenantId();
      const res = await fetch(`${API}/api/rezept`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(tenantId ? { "X-Tenant-ID": tenantId } : {})
        },
        credentials: 'include',
        body: JSON.stringify({
          rezeptData,
          patientData: {
            id: selectedPatient.id,                       // WICHTIG: nach ID speichern
            vorname: selectedPatient.vorname,
            nachname: selectedPatient.nachname,
            geburtsdatum: selectedPatient.geburtsdatum,
            adresse: selectedPatient.adresse,
          }
        }),
      });
      const result = await res.json();
      if (!res.ok || !result.success) {
        alert("❌ Fehler beim Speichern des Rezepts.");
        return;
      }
      alert("✅ Rezept gespeichert:\n" + result.file);
      closepopup_rezepte();
    } catch (error) {
      console.error("Fehler:", error);
      alert("❌ Verbindungsfehler beim Speichern.");
    }
  };

  return (
    <div className="popup-overlay">
      <div className="popup-container">
        <h2 className="h2" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'relative' }}>
          <span style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)' }}>Rezept für {selectedPatient.vorname} {selectedPatient.nachname}</span>
          {onMinimize && (
            <button type="button" className="btn-cancel" onClick={() => onMinimize(rezeptData)} title="Als Tab ablegen" style={{ background: '#e0e7ff', color: '#3730a3', borderColor: '#c7d2fe' }}>Als Tab</button>
          )}
        </h2>
        <br /><hr />
        <form onSubmit={handleRezeptSubmit}>
          <div className="form-group">
            <label>Medikament</label>
            <select name="medikament" value={rezeptData.medikament} onChange={handleRezeptChange} required>
              <option value="">Bitte wählen</option>
              <option value="Ibuprofen 400mg">Ibuprofen 400mg</option>
              <option value="Paracetamol 500mg">Paracetamol 500mg</option>
              <option value="Amoxicillin 1000mg">Amoxicillin 1000mg</option>
              <option value="Pantoprazol 40mg">Pantoprazol 40mg</option>
              <option value="Metamizol 500mg">Metamizol 500mg</option>
            </select>
          </div>

          <div className="form-group">
            <label>Dosierung</label>
            <select name="dosierung" value={rezeptData.dosierung} onChange={handleRezeptChange} required>
              <option value="">Bitte wählen</option>
              <option value="1 Tablette">1 Tablette</option>
              <option value="½ Tablette">½ Tablette</option>
              <option value="2 Tabletten">2 Tabletten</option>
              <option value="5 ml">5 ml</option>
              <option value="10 ml">10 ml</option>
            </select>
          </div>

          <div className="form-group">
            <label>Häufigkeit</label>
            <select name="haeufigkeit" value={rezeptData.haeufigkeit} onChange={handleRezeptChange} required>
              <option value="">Bitte wählen</option>
              <option value="1× täglich">1× täglich</option>
              <option value="2× täglich">2× täglich</option>
              <option value="3× täglich">3× täglich</option>
              <option value="Nach Bedarf">Nach Bedarf</option>
            </select>
          </div>

          <div className="form-group">
            <label>Dauer der Behandlung</label>
            <select name="dauer" value={rezeptData.dauer} onChange={handleRezeptChange}>
              <option value="">Bitte wählen</option>
              <option value="3 Tage">3 Tage</option>
              <option value="5 Tage">5 Tage</option>
              <option value="7 Tage">7 Tage</option>
              <option value="10 Tage">10 Tage</option>
              <option value="Bis auf weiteres">Bis auf weiteres</option>
            </select>
          </div>

          <div className="form-group">
            <label>Hinweise für den Patienten (optional)</label>
            <textarea name="hinweise" value={rezeptData.hinweise} onChange={handleRezeptChange} placeholder="z. B. Nach dem Essen einnehmen" />
          </div>

          <div className="form-group">
            <label>Erstellt am</label>
            <input type="text" value={new Date().toLocaleDateString()} disabled />
          </div>

          <div className="form-actions">
            <button type="submit" className="btn-save">Speichern</button>
            <button type="button" className="btn-cancel" onClick={closepopup_rezepte}>Abbrechen</button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default Rezepte;
