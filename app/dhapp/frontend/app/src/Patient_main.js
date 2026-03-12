import React, { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faSearch, faUser, faUserPlus } from "@fortawesome/free-solid-svg-icons";
import {
  fetchPatients as fetchPatientsApi,
  createPatient as createPatientApi,
  fetchInsurances
} from "./api";

function safeLower(v) {
  return (v || "").toString().toLowerCase();
}

const formatGuardianSummary = (patient) => {
  if (!patient) return "";
  const guardian = patient.guardian || {};
  const firstName = patient.guardian_first_name || guardian.first_name || "";
  const lastName = patient.guardian_last_name || guardian.last_name || "";
  const relationship = patient.guardian_relationship || guardian.relationship || "";
  const phone = patient.guardian_phone || guardian.phone || "";
  const email = patient.guardian_email || guardian.email || "";
  const street = patient.guardian_adresse || guardian.address?.street || "";
  const houseNo = patient.guardian_hausnummer || guardian.address?.houseNo || "";
  const zip = patient.guardian_plz || guardian.address?.zip || "";
  const city = patient.guardian_ort || guardian.address?.city || "";
  const nameLine = [relationship, [firstName, lastName].filter(Boolean).join(" ")].filter(Boolean).join(" – ");
  const addressLine = [street, houseNo].filter(Boolean).join(" ");
  const cityLine = [zip, city].filter(Boolean).join(" ");
  const parts = [nameLine, addressLine, cityLine, phone ? `Tel: ${phone}` : "", email].filter(Boolean);
  return parts.join(" • ");
};

const PatientenTable = ({
  onUnauthorized,               // optional: wird bei 401/403 aufgerufen (Logout)
}) => {

  const [searchVisible, setSearchVisible] = useState(false);
  const [showPatientForm, setShowPatientForm] = useState(false);
  const [patients, setPatients] = useState([]);
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [formData, setFormData] = useState({
    vorname: "",
    nachname: "",
    adresse: "",
    telefonnummer: "",
    email: "",
    krankengeschichte: "",
    medikationsplan: "",
    allergien: "",
    impfstatus: "",
    insurance_id: "",
    guardian_first_name: "",
    guardian_last_name: "",
    guardian_relationship: "",
    guardian_phone: "",
    guardian_email: "",
    guardian_same_address: false,
    guardian_adresse: "",
    guardian_plz: "",
    guardian_ort: ""
  });
  const [isMinor, setIsMinor] = useState(false);
  const [guardianErrors, setGuardianErrors] = useState({});
  const [birthDate, setBirthDate] = useState("");
  const [age, setAge] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(false);
  const [insurances, setInsurances] = useState([]);
  const [insuranceFilter, setInsuranceFilter] = useState('');
  const [insLoading, setInsLoading] = useState(false);
  const [billingType, setBillingType] = useState('Selbstzahler');
  const [formError, setFormError] = useState('');
  const errorHelperStyle = { color: '#b00020', fontSize: 12, marginTop: 2 };
  const renderGuardianError = (fieldName) =>
    guardianErrors[fieldName] ? (
      <div style={errorHelperStyle}>{guardianErrors[fieldName]}</div>
    ) : null;

  const handleUnauthorized = () => {
    // optionaler Callback an die App
    if (typeof onUnauthorized === "function") {
      onUnauthorized();
      return;
    }
  };

  useEffect(() => {
    if (!showPatientForm) {
      fetchPatients();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPatientForm]);

  useEffect(() => {
    if (showPatientForm) {
      setInsLoading(true);
      fetchInsurances({ active: true, limit: 30 })
        .then((list) => setInsurances(Array.isArray(list) ? list : []))
        .catch((e) => console.warn('Insurances load failed', e))
        .finally(() => setInsLoading(false));
    }
  }, [showPatientForm]);

  useEffect(() => {
    if (!isMinor) {
      setGuardianErrors({});
    }
  }, [isMinor]);

  const handleInsuranceSearch = async (value) => {
    setInsuranceFilter(value);
    if (!showPatientForm) return;
    if (value && value.trim().length >= 2) {
      try {
        setInsLoading(true);
        const data = await fetchInsurances({ active: true, q: value.trim().toLowerCase(), limit: 200 });
        setInsurances(Array.isArray(data) ? data : []);
      } catch (e) {
        console.warn('Insurances search failed', e);
      } finally {
        setInsLoading(false);
      }
    } else {
      // reset to initial 30
      try {
        setInsLoading(true);
        const data = await fetchInsurances({ active: true, limit: 30 });
        setInsurances(Array.isArray(data) ? data : []);
      } catch (e) {
        console.warn('Insurances reload failed', e);
      } finally {
        setInsLoading(false);
      }
    }
  };

  const calculateAge = (dob) => {
    if (!dob) return "";
    const birthDate = new Date(dob);
    const today = new Date();
    let computedAge = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    const dayDiff = today.getDate() - birthDate.getDate();
    if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
      computedAge -= 1;
    }
    return computedAge;
  };

  const handleBirthDateChange = (e) => {
    const val = e.target.value;
    setBirthDate(val);
    const computedAge = val ? calculateAge(val) : "";
    setAge(computedAge);
    setIsMinor(Boolean(computedAge !== "" && computedAge < 18));
  };

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData((s) => ({ ...s, [name]: type === "checkbox" ? checked : value }));
    if (name.startsWith("guardian_")) {
      setGuardianErrors((prev) => {
        if (!prev[name]) return prev;
        const next = { ...prev };
        delete next[name];
        return next;
      });
    }
  };

  useEffect(() => {
    if (!formData.guardian_same_address) return;
    setFormData((prev) => {
      if (prev.guardian_adresse === prev.adresse) return prev;
      return { ...prev, guardian_adresse: prev.adresse };
    });
  }, [formData.guardian_same_address, formData.adresse]);

  const toggleSearch = () => {
    setSearchVisible((v) => !v);
    setShowPatientForm(false);
  };

  const togglePatientForm = () => {
    setShowPatientForm((v) => !v);
    setSearchVisible(false);
    setSelectedPatient(null);
    setIsEditing(false);
    setFormData({
      vorname: "",
      nachname: "",
      adresse: "",
      telefonnummer: "",
      email: "",
      krankengeschichte: "",
      medikationsplan: "",
      allergien: "",
      impfstatus: "",
      insurance_id: "",
      guardian_first_name: "",
      guardian_last_name: "",
      guardian_relationship: "",
      guardian_phone: "",
      guardian_email: "",
      guardian_same_address: false,
      guardian_adresse: "",
      guardian_plz: "",
      guardian_ort: ""
    });
    setBirthDate("");
    setAge("");
    setBillingType('Selbstzahler');
    setIsMinor(false);
    setFormError('');
    setGuardianErrors({});
  };

  const fetchPatients = async () => {
    setLoading(true);
    try {
      const data = await fetchPatientsApi();
      setPatients(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Fehler beim Abrufen der Patienten:", error);
      if (/nicht angemeldet/i.test(error?.message || '')) {
        handleUnauthorized();
      }
    } finally {
      setLoading(false);
    }
  };

  const handlePatientClick = (patient) => {
    setSelectedPatient(patient);
    setFormData({
      vorname: patient.vorname || "",
      nachname: patient.nachname || "",
      adresse: patient.adresse || "",
      telefonnummer: patient.telefonnummer || "",
      email: patient.email || "",
      krankengeschichte: patient.krankengeschichte || "",
      medikationsplan: patient.medikationsplan || "",
      allergien: patient.allergien || "",
      impfstatus: patient.impfstatus || "",
      insurance_id: patient.insurance_id || "",
      guardian_first_name: patient.guardian_first_name || "",
      guardian_last_name: patient.guardian_last_name || "",
      guardian_relationship: patient.guardian_relationship || "",
      guardian_phone: patient.guardian_phone || "",
      guardian_email: patient.guardian_email || "",
      guardian_same_address: Boolean(patient.guardian_same_address),
      guardian_adresse: patient.guardian_adresse || "",
      guardian_plz: patient.guardian_plz || "",
      guardian_ort: patient.guardian_ort || ""
    });
    setBirthDate(patient.geburtsdatum || "");
    const computedAge = calculateAge(patient.geburtsdatum);
    setAge(computedAge);
    setIsMinor(Boolean(computedAge !== "" && computedAge < 18));
    setIsEditing(false);
    setShowPatientForm(true);
    setFormError('');
  };

  const handleBillingTypeChange = (e) => {
    setBillingType(e.target.value);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    try {
      if (selectedPatient) {
        alert("Bearbeiten von Patienten ist serverseitig noch nicht verfügbar.");
        return;
      }

      const requiresInsurance = ['KVG','UVG','IV'].includes(String(billingType).toUpperCase());
      if (requiresInsurance && !formData.insurance_id) {
        setFormError('Bitte eine Krankenkasse auswählen / Veuillez sélectionner une assurance');
        return;
      }
      if (isMinor) {
        const requiredGuardianFields = [
          { name: 'guardian_first_name', label: 'Vorname' },
          { name: 'guardian_last_name', label: 'Nachname' },
          { name: 'guardian_relationship', label: 'Beziehung' },
          { name: 'guardian_phone', label: 'Telefonnummer' },
          { name: 'guardian_adresse', label: 'Adresse' },
          { name: 'guardian_plz', label: 'PLZ' },
          { name: 'guardian_ort', label: 'Ort' }
        ];
        const validationErrors = {};
        requiredGuardianFields.forEach((field) => {
          if (!formData[field.name] || !formData[field.name].trim()) {
            validationErrors[field.name] = `${field.label} erforderlich`;
          }
        });
        if (Object.keys(validationErrors).length) {
          setGuardianErrors(validationErrors);
          return;
        }
      } else {
        setGuardianErrors({});
      }
      await createPatientApi({ ...formData, geburtsdatum: birthDate, alter: age });

      alert("Neuer Patient hinzugefügt");
      setFormData({
        vorname: "",
        nachname: "",
        adresse: "",
        telefonnummer: "",
        email: "",
        krankengeschichte: "",
        medikationsplan: "",
        allergien: "",
        impfstatus: "",
        insurance_id: "",
        guardian_first_name: "",
        guardian_last_name: "",
        guardian_relationship: "",
        guardian_phone: "",
        guardian_email: "",
        guardian_same_address: false,
        guardian_adresse: "",
        guardian_plz: "",
        guardian_ort: ""
      });
      setBirthDate("");
      setAge("");
      setBillingType('Selbstzahler');
      setIsMinor(false);
      setFormError('');
      setGuardianErrors({});
      fetchPatients();
      setIsEditing(false);
      if (!selectedPatient) setShowPatientForm(false);
    } catch (error) {
      console.error("Fehler beim Speichern:", error);
      alert(`Fehler: ${error.message || "Unbekannter Fehler"}`);
    }
  };

  const handleSearchChange = (e) => setSearchTerm(e.target.value);

      const filteredPatients = patients.filter((patient) => {
    const v = safeLower(patient.vorname);
    const n = safeLower(patient.nachname);
    const s = safeLower(searchTerm);
    const full = safeLower(patient.name);
    return v.includes(s) || n.includes(s) || full.includes(s);
  });

  return (
    <>
      <div className="buttons-container">
        <button
          className="floating-button"
          onClick={togglePatientForm}
          aria-label="Neuen Patienten hinzufügen"
          title="Neuen Patienten hinzufügen"
        >
          <FontAwesomeIcon icon={faUserPlus} style={{ fontSize: "1.5rem" }} />
        </button>

        <button className="btn" onClick={toggleSearch}>
          <FontAwesomeIcon icon={faSearch} className="floating-text" /> &nbsp; Patienten suchen
        </button>
      </div>

      <div className="patients-table">
        {searchVisible && (
          <div className="search-bar">
            <input
              type="text"
              placeholder="Suche nach Patienten"
              value={searchTerm}
              onChange={handleSearchChange}
            />
          </div>
        )}

        {loading ? (
          <div style={{ padding: 12 }}>Lade Patienten…</div>
        ) : (
        <table className="azure-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Adresse</th>
              <th>Telefonnummer</th>
              <th>Email</th>
              <th>AHV</th>
              <th>Verantwortlich</th>
            </tr>
          </thead>
          <tbody>
              {filteredPatients.map((patient) => (
                <tr
                  key={patient.id}
                  className="clickable-row"
                  onClick={() => handlePatientClick(patient)}
                >
                  <td>
                    <FontAwesomeIcon icon={faUser} /> &nbsp;{" "}
                    {[
                      patient.vorname || patient.name?.split(' ')[0] || "",
                      patient.nachname || patient.name?.split(' ').slice(1).join(' ') || ""
                    ].filter(Boolean).join(" ")}
                  </td>
                  <td>{patient.adresse || patient.address?.street || ""}</td>
                  <td>{patient.telefonnummer || patient.phone || ""}</td>
                  <td>{patient.email || ""}</td>
                  <td>{patient.versichertennummer || patient.insurance_number || ""}</td>
                  <td>{formatGuardianSummary(patient) || "—"}</td>
                </tr>
              ))}
              {filteredPatients.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center", padding: 12, color: "#666" }}>
                    Keine Patienten gefunden.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Optional: einfaches Formular-Handling beibehalten (falls bei dir verwendet) */}
      {showPatientForm && (
        <form onSubmit={handleSubmit} style={{ marginTop: 16 }}>
          <h3>{selectedPatient ? "Patient bearbeiten" : "Neuen Patienten anlegen"}</h3>
          <div className="form-grid">
            <input name="vorname" placeholder="Vorname" value={formData.vorname} onChange={handleInputChange} />
            <input name="nachname" placeholder="Nachname" value={formData.nachname} onChange={handleInputChange} />
            <input type="date" value={birthDate} onChange={handleBirthDateChange} />
            <input name="adresse" placeholder="Adresse" value={formData.adresse} onChange={handleInputChange} />
            <input name="telefonnummer" placeholder="Telefon" value={formData.telefonnummer} onChange={handleInputChange} />
            <input name="email" placeholder="E-Mail" value={formData.email} onChange={handleInputChange} />
            <textarea name="krankengeschichte" placeholder="Krankengeschichte" value={formData.krankengeschichte} onChange={handleInputChange} />
            <textarea name="medikationsplan" placeholder="Medikationsplan" value={formData.medikationsplan} onChange={handleInputChange} />
            <textarea name="allergien" placeholder="Allergien" value={formData.allergien} onChange={handleInputChange} />
            <textarea name="impfstatus" placeholder="Impfstatus" value={formData.impfstatus} onChange={handleInputChange} />
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ display:'block', marginBottom: 4 }}>Krankenkasse / Assurance maladie</label>
              <input
                type="text"
                placeholder="Suche Versicherung..."
                value={insuranceFilter}
                onChange={(e) => handleInsuranceSearch(e.target.value)}
                style={{ width: '100%', marginBottom: 6 }}
              />
              <select name="insurance_id" value={formData.insurance_id || ''} onChange={handleInputChange}>
                <option value="">Bitte Krankenkasse auswählen</option>
                {insurances.map((i) => (
                  <option key={i.id} value={i.id}>{i.name}{i.canton ? ` (${i.canton})` : ''}</option>
                ))}
              </select>
              {insLoading && <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>Lade Versicherer …</div>}
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ display:'block', marginBottom: 4 }}>Abrechnungstyp</label>
              <select value={billingType} onChange={handleBillingTypeChange}>
                <option value="Selbstzahler">Selbstzahler</option>
                <option value="KVG">KVG</option>
                <option value="UVG">UVG</option>
                <option value="IV">IV</option>
              </select>
              {formError && <div style={{ color: '#b00020', marginTop: 6 }}>{formError}</div>}
            </div>
            {isMinor && (
              <div
                style={{
                  gridColumn: '1 / -1',
                  marginTop: 16,
                  borderTop: '1px solid #cfd7df',
                  paddingTop: 16
                }}
              >
                <div style={{ marginBottom: 8 }}>
                  <strong>Verantwortliche Person / gesetzlicher Vertreter</strong>
                  <p style={{ margin: '4px 0 0', fontSize: 12, color: '#5f6872' }}>
                    Pflichtfelder sind markiert und müssen vor dem Abrechnen ausgefüllt werden.
                  </p>
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                    gap: 8
                  }}
                >
                  <div>
                    <input
                      name="guardian_first_name"
                      placeholder="Vorname der verantwortlichen Person"
                      value={formData.guardian_first_name}
                      onChange={handleInputChange}
                    />
                    {renderGuardianError('guardian_first_name')}
                  </div>
                  <div>
                    <input
                      name="guardian_last_name"
                      placeholder="Nachname"
                      value={formData.guardian_last_name}
                      onChange={handleInputChange}
                    />
                    {renderGuardianError('guardian_last_name')}
                  </div>
                  <div>
                    <input
                      name="guardian_relationship"
                      placeholder="Beziehung (Mutter/Vater/Beistand/andere)"
                      value={formData.guardian_relationship}
                      onChange={handleInputChange}
                    />
                    {renderGuardianError('guardian_relationship')}
                  </div>
                  <div>
                    <input
                      name="guardian_phone"
                      placeholder="Telefonnummer"
                      value={formData.guardian_phone}
                      onChange={handleInputChange}
                    />
                    {renderGuardianError('guardian_phone')}
                  </div>
                  <div>
                    <input
                      name="guardian_email"
                      placeholder="E-Mail (optional)"
                      value={formData.guardian_email}
                      onChange={handleInputChange}
                    />
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input
                      type="checkbox"
                      name="guardian_same_address"
                      checked={formData.guardian_same_address}
                      onChange={handleInputChange}
                    />
                    Adresse gleich wie Patient
                  </label>
                  <div>
                    <input
                      name="guardian_adresse"
                      placeholder="Adresse (Strasse)"
                      value={formData.guardian_adresse}
                      onChange={handleInputChange}
                    />
                    {renderGuardianError('guardian_adresse')}
                  </div>
                  <div>
                    <input
                      name="guardian_plz"
                      placeholder="PLZ"
                      value={formData.guardian_plz}
                      onChange={handleInputChange}
                    />
                    {renderGuardianError('guardian_plz')}
                  </div>
                  <div>
                    <input
                      name="guardian_ort"
                      placeholder="Ort"
                      value={formData.guardian_ort}
                      onChange={handleInputChange}
                    />
                    {renderGuardianError('guardian_ort')}
                  </div>
                </div>
              </div>
            )}
          </div>
          <div style={{ marginTop: 10 }}>
            <button type="submit">{selectedPatient ? "Aktualisieren" : "Anlegen"}</button>
            <button type="button" onClick={togglePatientForm} style={{ marginLeft: 8 }}>
              Abbrechen
            </button>
          </div>
        </form>
      )}
    </>
  );
};

export default PatientenTable;
