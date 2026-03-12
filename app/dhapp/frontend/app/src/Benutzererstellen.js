// src/Benutzererstellen.js
import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import "./UserTermine.css";
import api, { fetchInsurances as apiFetchInsurances } from "./api";
import {
  formatAhvLive,
  validateAhv,
  formatSwissPhone,
  validateSwissPhone,
  isValidName,
  isValidEmailRFC5322,
  isValidPLZ,
  isValidBirthdateNotFuture,
  sanitizeFormData,
  debounce
} from "./utils/validation";

// Local fallback (used only if API is not available)
const FALLBACK_KRANKENKASSEN = [
  { name: "CSS Kranken-Versicherung AG", adresse: "Tribschengasse 21, 6005 Luzern" },
  { name: "Helsana Versicherungen AG", adresse: "Zürcherstrasse 130, 8600 Dübendorf" },
  { name: "Swica Gesundheitsorganisation", adresse: "Römerstrasse 37, 8400 Winterthur" },
  { name: "Concordia", adresse: "Bundesplatz 15, 6002 Luzern" },
  { name: "Sanitas", adresse: "Jägergasse 3, 8021 Zürich" },
  { name: "Atupri", adresse: "Gutenbergstrasse 18, 3011 Bern" },
  { name: "KPT", adresse: "Wankdorfallee 3, 3014 Bern" },
  { name: "EGK", adresse: "Brislachstrasse 2, 4242 Laufen" },
  { name: "Assura", adresse: "Avenue C.-F. Ramuz 70, 1009 Pully" },
  { name: "Sympany", adresse: "Peter Merian-Weg 4, 4002 Basel" },
];

const GESCHLECHTER = [
  { value: "m", label: "Männlich" },
  { value: "w", label: "Weiblich" },
  { value: "d", label: "Divers" }
];

const GUARDIAN_REQUIRED_FIELDS = [
  { name: "guardian_first_name", label: "Vorname" },
  { name: "guardian_last_name", label: "Nachname" },
  { name: "guardian_relationship", label: "Beziehung" },
  { name: "guardian_phone", label: "Telefonnummer" },
  { name: "guardian_adresse", label: "Adresse (Strasse)" },
  { name: "guardian_plz", label: "PLZ" },
  { name: "guardian_ort", label: "Ort" }
];

const calculateAge = (dob) => {
  if (!dob) return "";
  const birthDate = new Date(dob);
  if (Number.isNaN(birthDate.getTime())) return "";
  const today = new Date();
  let computedAge = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  const dayDiff = today.getDate() - birthDate.getDate();
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
    computedAge -= 1;
  }
  return computedAge;
};

const applyGuardianAddressSync = (state) => {
  if (!state.guardian_same_address) return state;
  return {
    ...state,
    guardian_adresse: state.adresse,
    guardian_plz: state.plz,
    guardian_ort: state.ort
  };
};

// moved validation and formatting helpers to utils/validation.js

const BenutzerPopup = ({ show, onClose, onSave }) => {
  const [formData, setFormData] = useState({
    vorname: "", nachname: "", geburtsdatum: "", geschlecht: "",
    treated_sex: "",
    krankenkasse_name: "", krankenkasse_adresse: "",
    ahv_nummer: "", adresse: "", plz: "", hausnummer: "",
    ort: "", versichertennummer: "",
    telefonnummer: "", email: "", krankengeschichte: "",
    medikationsplan: "", allergien: "", impfstatus: "",
    guardian_first_name: "", guardian_last_name: "", guardian_relationship: "",
    guardian_phone: "", guardian_email: "", guardian_same_address: false,
    guardian_adresse: "", guardian_plz: "", guardian_ort: ""
  });
  const [isMinor, setIsMinor] = useState(false);
  const [age, setAge] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [kassenFilter, setKassenFilter] = useState("");
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [kassen, setKassen] = useState([]); // full insurance objects from API
  const [kassenLoading, setKassenLoading] = useState(false);
  const [kassenError, setKassenError] = useState("");
  const kasseInputRef = useRef(null);

  const filteredKassen = useMemo(() => {
    const list = kassen && kassen.length ? kassen : FALLBACK_KRANKENKASSEN;
    if (!kassenFilter) return list;
    const q = kassenFilter.toLowerCase();
    return list.filter(k => (k.name || "").toLowerCase().includes(q) || (k.short_name || "").toLowerCase().includes(q));
  }, [kassenFilter, kassen]);

  const handleKasseSelect = (kasse) => {
    // Accept both API insurance objects and fallback shape
    const name = kasse.name || "";
    const adresse = kasse.adresse || [kasse.address, kasse.zip, kasse.city].filter(Boolean).join(", ");
    const insurance_id = kasse.id || "";
    setFormData(prev => ({ ...prev, krankenkasse_name: name, krankenkasse_adresse: adresse, insurance_id }));
    setKassenFilter(""); setDropdownOpen(false);
    setErrors(prev => ({ ...prev, krankenkasse_name: "" }));
  };

  useEffect(() => {
    function handleClickOutside(e) {
      if (kasseInputRef.current && !kasseInputRef.current.contains(e.target)) setDropdownOpen(false);
    }
    if (dropdownOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [dropdownOpen]);

  // Load Krankenkassen once (debounced protection even if called multiple times)
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setKassenLoading(true);
        setKassenError("");
        const data = await apiFetchInsurances({ active: true, q: '', limit: 1000 });
        // Keep full objects so we can pass insurance_id and show details later
        const normalized = Array.isArray(data) ? data.map(i => ({
          id: i.id,
          name: i.name || i.short_name || "",
          short_name: i.short_name || "",
          address: i.address || "",
          zip: i.zip || "",
          city: i.city || "",
          canton: i.canton || "",
          bfs_code: i.bfs_code || "",
          ean: i.ean || "",
          kvnr: i.kvnr || "",
          // Convenience combined string for display
          adresse: [i.address, i.zip, i.city].filter(Boolean).join(", ")
        })) : [];
        if (!cancelled) setKassen(normalized);
      } catch (err) {
        if (!cancelled) {
          setKassenError("Krankenkassenliste aus dem System nicht verfügbar. Fallback wird verwendet.");
          setKassen([]); // fallback used in filteredKassen
        }
      } finally {
        if (!cancelled) setKassenLoading(false);
      }
    };
    // Debounce in case this hook re-runs rapidly due to hot reloads
    const debounced = debounce(load, 300);
    debounced();
    return () => { cancelled = true; };
  }, []);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    const nextValue = type === "checkbox" ? checked : value;

    if (name === "geburtsdatum") {
      const computedAge = value ? calculateAge(value) : "";
      setAge(computedAge);
      setIsMinor(Boolean(computedAge !== "" && computedAge < 18));
    }

    if (name === "telefonnummer") {
      const formatted = formatSwissPhone(value);
      setFormData((prev) => applyGuardianAddressSync({ ...prev, [name]: formatted }));
      setErrors((prev) => ({ ...prev, [name]: "" }));
      return;
    }

    if (name === "ahv_nummer") {
      const formatted = formatAhvLive(value);
      setFormData((prev) => applyGuardianAddressSync({ ...prev, [name]: formatted }));
      setErrors((prev) => ({ ...prev, [name]: "" }));
      return;
    }

    setFormData((prev) => applyGuardianAddressSync({ ...prev, [name]: nextValue }));
    setErrors((prev) => ({ ...prev, [name]: "" }));
  };

  const validate = useCallback(() => {
    const e = {};
    if (!formData.vorname.trim()) e.vorname = "Vorname ist erforderlich.";
    else if (!isValidName(formData.vorname)) e.vorname = "Bitte nur Buchstaben (mind. 2 Zeichen).";
    if (!formData.nachname.trim()) e.nachname = "Nachname ist erforderlich.";
    else if (!isValidName(formData.nachname)) e.nachname = "Bitte nur Buchstaben (mind. 2 Zeichen).";
    if (!formData.geburtsdatum) e.geburtsdatum = "Geburtsdatum ist erforderlich.";
    else if (!isValidBirthdateNotFuture(formData.geburtsdatum)) e.geburtsdatum = "Geburtsdatum darf nicht in der Zukunft liegen.";
    if (!formData.geschlecht) e.geschlecht = "Geschlecht ist erforderlich.";
    const isDiverse = ['divers', 'd', 'diverse', 'other'].includes(String(formData.geschlecht || '').trim().toLowerCase());
    if (isDiverse && !String(formData.treated_sex || '').trim()) e.treated_sex = "Behandeltes Geschlecht (Abrechnung) ist erforderlich.";
    if (!formData.adresse.trim()) e.adresse = "Adresse ist erforderlich.";
    if (!formData.plz.trim()) e.plz = "PLZ ist erforderlich.";
    else if (!isValidPLZ(formData.plz)) e.plz = "Ungültige PLZ (4-stellig).";
    if (!formData.hausnummer.trim()) e.hausnummer = "Hausnummer ist erforderlich.";
    if (!formData.ort.trim()) e.ort = "Ort ist erforderlich.";

    const birthValid = formData.geburtsdatum && isValidBirthdateNotFuture(formData.geburtsdatum);
    const computedAge = birthValid ? calculateAge(formData.geburtsdatum) : "";
    const minor = birthValid && computedAge !== "" && computedAge < 18;

    if (!minor) {
      if (!formData.krankenkasse_name.trim()) e.krankenkasse_name = "Krankenkasse auswählen.";
      if (!formData.versichertennummer.trim()) e.versichertennummer = "Versichertennummer ist erforderlich.";
    }

    if (!formData.email.trim()) e.email = "E-Mail ist erforderlich.";
    else if (!isValidEmailRFC5322(formData.email)) e.email = "Ungültige E-Mail-Adresse.";
    if (formData.ahv_nummer && !validateAhv(formData.ahv_nummer)) e.ahv_nummer = "AHV-Nummer ungültig.";
    if (formData.telefonnummer && !validateSwissPhone(formData.telefonnummer)) e.telefonnummer = "Telefon ungültig.";

    if (minor) {
      GUARDIAN_REQUIRED_FIELDS.forEach((field) => {
        if (!formData[field.name]?.trim()) {
          e[field.name] = `${field.label} der verantwortlichen Person ist erforderlich.`;
        }
      });
    }

    setErrors(e);
    return Object.keys(e).length === 0;
  }, [formData]);

  const savePatient = useCallback(async (payload) => {
    const result = await api.post('/api/patients', payload);
    if (!result.ok) {
      const errMsg = result.data?.message || result.data?.error || "Fehler beim Speichern des Patienten";
      throw new Error(errMsg);
    }
    return result.data?.patient || result.data;
  }, []);

  const handleSave = async () => {
    if (saving) return;
    if (!validate()) return;
    setSaving(true);
    try {
      // Sanitize and avoid sending stray whitespace
      const payload = sanitizeFormData(formData);
      const patient = await savePatient(payload);
      if (typeof onSave === "function") onSave(patient);
      alert("Patient erfolgreich gespeichert!");
      setFormData({
        vorname: "", nachname: "", geburtsdatum: "", geschlecht: "",
        treated_sex: "",
        krankenkasse_name: "", krankenkasse_adresse: "",
        ahv_nummer: "", adresse: "", plz: "", hausnummer: "",
        ort: "", versichertennummer: "",
        telefonnummer: "", email: "", krankengeschichte: "",
        medikationsplan: "", allergien: "", impfstatus: "",
        guardian_first_name: "", guardian_last_name: "", guardian_relationship: "",
        guardian_phone: "", guardian_email: "", guardian_same_address: false,
        guardian_adresse: "", guardian_plz: "", guardian_ort: ""
      });
      setErrors({});
      setIsMinor(false);
      setAge("");
    } catch (err) {
      // Do not log sensitive form payloads; provide user-friendly messages only
      let message = "Speichern fehlgeschlagen.";
      const raw = String(err?.message || "").toLowerCase();
      if (raw.includes("network") || raw.includes("failed to fetch")) message = "Verbindung unterbrochen. Bitte prüfen Sie Ihre Internetverbindung.";
      else if (raw.includes("unauthorized") || raw.includes("autoris")) message = "Nicht autorisiert – bitte neu einloggen.";
      else if (raw.includes("bad request") || raw.includes("invalid") || raw.includes("ungültig")) message = "Ungültige Eingabe. Bitte prüfen Sie die Angaben.";
      else if (raw) message = err.message;
      alert(message);
    } finally {
      setSaving(false);
    }
  };

  if (!show) return null;

  return (
    <div className="popup-overlay">
      <div className="popup-container">
        <h2 className="h2">Neuen Patienten erstellen</h2>
        <form onSubmit={(e) => e.preventDefault()} style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
          <section>
            <h3 style={{ marginBottom: 12 }}>Personendaten</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: "12px" }}>
              <label className="form-field">
                <span>Vorname *</span>
                <input name="vorname" value={formData.vorname} onChange={handleChange} />
                {errors.vorname && <small className="error">{errors.vorname}</small>}
              </label>
              <label className="form-field">
                <span>Nachname *</span>
                <input name="nachname" value={formData.nachname} onChange={handleChange} />
                {errors.nachname && <small className="error">{errors.nachname}</small>}
              </label>
              <label className="form-field">
                <span>Geburtsdatum *</span>
                <input type="date" name="geburtsdatum" value={formData.geburtsdatum} onChange={handleChange} />
                {errors.geburtsdatum && <small className="error">{errors.geburtsdatum}</small>}
                {formData.geburtsdatum && (
                  <small style={{ display: "block", marginTop: 4, color: "#475569" }}>
                    {age === "" ? "Alter wird berechnet…" : `Alter: ${age} Jahre`}
                    {age !== "" && age < 18 ? " · Minderjährig: Verantwortliche Person wird benötigt." : ""}
                  </small>
                )}
              </label>
              <label className="form-field">
                <span>Geschlecht *</span>
                <select name="geschlecht" value={formData.geschlecht} onChange={handleChange}>
                  <option value="">Bitte wählen</option>
                  {GESCHLECHTER.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
                </select>
                {errors.geschlecht && <small className="error">{errors.geschlecht}</small>}
              </label>
              {['divers', 'd', 'diverse', 'other'].includes(String(formData.geschlecht || '').trim().toLowerCase()) && (
                <label className="form-field">
                  <span>Behandeltes Geschlecht (Abrechnung) *</span>
                  <select name="treated_sex" value={formData.treated_sex} onChange={handleChange}>
                    <option value="">Bitte wählen</option>
                    <option value="female">Weiblich</option>
                    <option value="male">Männlich</option>
                  </select>
                  {errors.treated_sex && <small className="error">{errors.treated_sex}</small>}
                </label>
              )}
              <label className="form-field">
                <span>AHV-Nummer</span>
                <input name="ahv_nummer" value={formData.ahv_nummer} onChange={handleChange} placeholder="756.1234.5678.97" />
                {errors.ahv_nummer && <small className="error">{errors.ahv_nummer}</small>}
              </label>
            </div>
          </section>

          <section>
            <h3 style={{ marginBottom: 12 }}>Kontakt</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: "12px" }}>
              <label className="form-field">
                <span>Strasse *</span>
                <input name="adresse" value={formData.adresse} onChange={handleChange} />
                {errors.adresse && <small className="error">{errors.adresse}</small>}
              </label>
              <label className="form-field">
                <span>Hausnummer *</span>
                <input name="hausnummer" value={formData.hausnummer} onChange={handleChange} />
                {errors.hausnummer && <small className="error">{errors.hausnummer}</small>}
              </label>
              <label className="form-field">
                <span>PLZ *</span>
                <input name="plz" value={formData.plz} onChange={handleChange} />
                {errors.plz && <small className="error">{errors.plz}</small>}
              </label>
              <label className="form-field">
                <span>Ort *</span>
                <input name="ort" value={formData.ort} onChange={handleChange} />
                {errors.ort && <small className="error">{errors.ort}</small>}
              </label>
              <label className="form-field">
                <span>Telefon</span>
                <input name="telefonnummer" value={formData.telefonnummer} onChange={handleChange} placeholder="079 123 45 67" />
                {errors.telefonnummer && <small className="error">{errors.telefonnummer}</small>}
              </label>
              <label className="form-field">
                <span>E-Mail *</span>
                <input name="email" value={formData.email} onChange={handleChange} />
                {errors.email && <small className="error">{errors.email}</small>}
              </label>
            </div>
          </section>

          {isMinor && (
            <section>
              <h3 style={{ marginBottom: 8 }}>Verantwortliche Person / gesetzlicher Vertreter</h3>
              <p style={{ margin: "0 0 12px", color: "#475569", fontSize: 13 }}>
                Pflichtfelder sind markiert (*). Die verantwortliche Person wird auch später als Rechnungsempfänger verwendet.
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: "12px" }}>
                <label className="form-field">
                  <span>Vorname *</span>
                  <input name="guardian_first_name" value={formData.guardian_first_name} onChange={handleChange} />
                  {errors.guardian_first_name && <small className="error">{errors.guardian_first_name}</small>}
                </label>
                <label className="form-field">
                  <span>Nachname *</span>
                  <input name="guardian_last_name" value={formData.guardian_last_name} onChange={handleChange} />
                  {errors.guardian_last_name && <small className="error">{errors.guardian_last_name}</small>}
                </label>
                <label className="form-field">
                  <span>Beziehung (Mutter/Vater/Beistand/andere) *</span>
                  <input name="guardian_relationship" value={formData.guardian_relationship} onChange={handleChange} />
                  {errors.guardian_relationship && <small className="error">{errors.guardian_relationship}</small>}
                </label>
                <label className="form-field">
                  <span>Telefonnummer *</span>
                  <input name="guardian_phone" value={formData.guardian_phone} onChange={handleChange} placeholder="079 123 45 67" />
                  {errors.guardian_phone && <small className="error">{errors.guardian_phone}</small>}
                </label>
                <label className="form-field">
                  <span>E-Mail (optional)</span>
                  <input name="guardian_email" value={formData.guardian_email} onChange={handleChange} />
                </label>
                <label className="form-field" style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center" }}>
                  <input
                    type="checkbox"
                    name="guardian_same_address"
                    checked={formData.guardian_same_address}
                    onChange={handleChange}
                  />
                  <span style={{ marginLeft: 8 }}>Adresse gleich wie Patient</span>
                </label>
                <label className="form-field">
                  <span>Adresse (Strasse) *</span>
                  <input
                    name="guardian_adresse"
                    value={formData.guardian_adresse}
                    onChange={handleChange}
                    disabled={formData.guardian_same_address}
                  />
                  {errors.guardian_adresse && <small className="error">{errors.guardian_adresse}</small>}
                </label>
                <label className="form-field">
                  <span>PLZ *</span>
                  <input
                    name="guardian_plz"
                    value={formData.guardian_plz}
                    onChange={handleChange}
                    disabled={formData.guardian_same_address}
                  />
                  {errors.guardian_plz && <small className="error">{errors.guardian_plz}</small>}
                </label>
                <label className="form-field">
                  <span>Ort *</span>
                  <input
                    name="guardian_ort"
                    value={formData.guardian_ort}
                    onChange={handleChange}
                    disabled={formData.guardian_same_address}
                  />
                  {errors.guardian_ort && <small className="error">{errors.guardian_ort}</small>}
                </label>
              </div>
            </section>
          )}

          <section>
            <h3 style={{ marginBottom: 12 }}>Versicherung</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: "12px" }}>
              <label className="form-field">
                <span>Versichertennummer *</span>
                <input name="versichertennummer" value={formData.versichertennummer} onChange={handleChange} />
                {errors.versichertennummer && <small className="error">{errors.versichertennummer}</small>}
              </label>
              <div className="form-field" ref={kasseInputRef} style={{ position: "relative" }}>
                <span>Krankenkasse *</span>
                <input
                  name="krankenkasse_name"
                  value={formData.krankenkasse_name}
                  onChange={(e) => { setKassenFilter(e.target.value); handleChange(e); setDropdownOpen(true); }}
                  placeholder="Kasse wählen oder suchen"
                  onFocus={() => setDropdownOpen(true)}
                />
                {errors.krankenkasse_name && <small className="error">{errors.krankenkasse_name}</small>}
                {kassenError && <small className="error">{kassenError}</small>}
                {dropdownOpen && filteredKassen.length > 0 && (
                  <ul style={{
                    listStyle: "none",
                    position: "absolute",
                    top: "100%",
                    left: 0,
                    right: 0,
                    maxHeight: 180,
                    overflowY: "auto",
                    margin: 0,
                    padding: "6px 0",
                    background: "#fff",
                    border: "1px solid #cbd5f5",
                    borderRadius: 8,
                    zIndex: 20
                  }}>
                    {filteredKassen.map((kasse) => (
                      <li
                        key={(kasse.id ?? kasse.name) + ''}
                        onClick={() => handleKasseSelect(kasse)}
                        style={{ padding: "6px 12px", cursor: "pointer" }}
                      >
                        <strong>{kasse.name}</strong>{kasse.short_name ? <>&nbsp;({kasse.short_name})</> : null}<br />
                        <small style={{ color: "#64748b" }}>{kasse.adresse || [kasse.address, kasse.zip, kasse.city].filter(Boolean).join(", ")}</small>
                      </li>
                    ))}
                    {filteredKassen.length === 0 && <li style={{ padding: "6px 12px" }}>Keine Treffer</li>}
                  </ul>
                )}
              </div>
              <label className="form-field">
                <span>Kassenadresse</span>
                <input name="krankenkasse_adresse" value={formData.krankenkasse_adresse} onChange={handleChange} />
              </label>
            </div>
          </section>

          <section>
            <h3 style={{ marginBottom: 12 }}>Medizinische Informationen</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: "12px" }}>
              <label className="form-field">
                <span>Krankengeschichte</span>
                <textarea name="krankengeschichte" value={formData.krankengeschichte} onChange={handleChange} rows={3} />
              </label>
              <label className="form-field">
                <span>Medikationsplan</span>
                <textarea name="medikationsplan" value={formData.medikationsplan} onChange={handleChange} rows={3} />
              </label>
              <label className="form-field">
                <span>Allergien</span>
                <textarea name="allergien" value={formData.allergien} onChange={handleChange} rows={3} />
              </label>
              <label className="form-field">
                <span>Impfstatus</span>
                <textarea name="impfstatus" value={formData.impfstatus} onChange={handleChange} rows={3} />
              </label>
            </div>
          </section>

          <div className="form-actions" style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "4px" }}>
            <button type="button" className="btn-cancel" onClick={onClose}>Abbrechen</button>
            <button type="button" className="btn-save" onClick={handleSave} disabled={saving}>
              {saving ? "Speichere…" : "Speichern"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default BenutzerPopup;
