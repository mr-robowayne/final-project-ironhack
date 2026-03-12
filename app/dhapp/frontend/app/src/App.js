import React, { useState, useEffect, useCallback } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faUserPlus, faSearch, faNoteSticky, faClock } from '@fortawesome/free-solid-svg-icons';
import {
  faUserMd, faUser, faCalendarCheck, faFileAlt, faEnvelope,
  faFolderOpen, faPrescriptionBottleAlt
} from "@fortawesome/free-solid-svg-icons";
import { faShieldHalved } from "@fortawesome/free-solid-svg-icons";
import './App.css';
import './usertable.css';

import logo from './assets/logo.png';
import RechungenView from './RechungenView';
import CalendarView from './main_kalender';
import MediRemidi from './medi-remidi';
import TerminPopup from './UserTermine';
import DokumentePopup from './UserDokumente';
import Rezepte from "./Rezepte";
import Briefe from "./Briefe";
import Krankmeldung from "./Krankmeldung";
import FallEröffnung from './faelle';
import Login from "./login";
import UserProfileDropdown from './userdashboard';
import TasksView from './TasksView';
import NotesView from './NotesView';
import './userdashboard.css';
import BenutzerPopup from './Benutzererstellen';
import PatientJourneyBoard from './PatientJourneyBoard';
import WaitingRoomView from './WaitingRoomView';
import AutomationSettings from './AutomationSettings';
import BillingSettings from './BillingSettings';
import RoomsView from './RoomsView';
import InventoryView from './InventoryView';
import SOPsView from './SOPsView';
import PatientCommunicationView from './PatientCommunicationView';
import TenantDashboard from './TenantDashboard';
import PersonalDashboard from './PersonalDashboard';
import ChatView from './ChatView';
import PatientTimeline from './PatientTimeline';
import PatientMediaGallery from './PatientMediaGallery';
// import WorkflowConfigView from './WorkflowConfigView';
import CombinedDashboard from './CombinedDashboard';
import { hasPermission, hasAnyPermission } from './rbac';

// Zentrale API
import api, {
  setTenantId as setApiTenantId,
  getTenantId as getApiTenantId,
  fetchPatients as fetchPatientsApi,
  fetchInsurances,
  resolvePatient
} from './api';

// Optional weiterreichen (einige Unter-Components erwarten das)
const API_BASE = process.env.REACT_APP_API_BASE || `${window.location.protocol}//${window.location.host}`;
const DEFAULT_TENANT = process.env.REACT_APP_DEFAULT_TENANT || 'test';

const parseGuardianAddress = (value) => {
  if (!value) return {};
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return {}; }
  }
  if (typeof value === 'object') return value;
  return {};
};

const baseGuardianState = () => ({
  guardian_first_name: '',
  guardian_last_name: '',
  guardian_relationship: '',
  guardian_phone: '',
  guardian_email: '',
  guardian_same_address: false,
  guardian_adresse: '',
  guardian_hausnummer: '',
  guardian_plz: '',
  guardian_ort: ''
});

const snapshotGuardianState = (source = {}) => {
  const base = baseGuardianState();
  const guardianObj = source.guardian || {};
  const addressFromJson = parseGuardianAddress(source.guardian_address);
  const address = guardianObj.address || addressFromJson || {};
  return {
    guardian_first_name: source.guardian_first_name ?? guardianObj.first_name ?? base.guardian_first_name,
    guardian_last_name: source.guardian_last_name ?? guardianObj.last_name ?? base.guardian_last_name,
    guardian_relationship: source.guardian_relationship ?? guardianObj.relationship ?? base.guardian_relationship,
    guardian_phone: source.guardian_phone ?? guardianObj.phone ?? base.guardian_phone,
    guardian_email: source.guardian_email ?? guardianObj.email ?? base.guardian_email,
    guardian_same_address: source.guardian_same_address ?? guardianObj.same_address ?? base.guardian_same_address,
    guardian_adresse: source.guardian_adresse ?? address.street ?? base.guardian_adresse,
    guardian_hausnummer: source.guardian_hausnummer ?? address.houseNo ?? base.guardian_hausnummer,
    guardian_plz: source.guardian_plz ?? address.zip ?? base.guardian_plz,
    guardian_ort: source.guardian_ort ?? address.city ?? base.guardian_ort
  };
};

const enrichPatientWithGuardian = (patient) => {
  if (!patient) return patient;
  return {
    ...patient,
    ...snapshotGuardianState(patient)
  };
};

const createInitialPatientFormState = () => ({
  vorname: '',
  nachname: '',
  adresse: '',
  telefonnummer: '',
  email: '',
  krankengeschichte: '',
  medikationsplan: '',
  allergien: '',
  impfstatus: '',
  insurance_id: '',
  ...baseGuardianState()
});

function App() {
  const [user, setUser] = useState(null);
  const [tenantId, setTenantIdState] = useState(getApiTenantId() || DEFAULT_TENANT);
  const [tenantName, setTenantName] = useState('');
  const [tenantMeta, setTenantMeta] = useState(null);
  const [tenantDatabase, setTenantDatabase] = useState('');

  // UI-States
  const [showFileModal, setShowFileModal] = useState(false);
  const [searchVisible, setSearchVisible] = useState(false);
  const [showPatientForm, setShowPatientForm] = useState(false);
  const [showPatientForm_all, setShowPatientForm_all] = useState(true);
  const [patients, setPatients] = useState([]);
  const [selectedPatient, setSelectedPatient] = useState(null);

  const [formData, setFormData] = useState(() => createInitialPatientFormState());
  const [insurances, setInsurances] = useState([]);
  const [insLoading, setInsLoading] = useState(false);
  const [insuranceFilter, setInsuranceFilter] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [age, setAge] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // Popups
  const [showPopup_main, setShowPopup_main] = useState(false);
  const [showPopup_rezepte, setshowPopup_rezepte] = useState(false);
  const [showPopup_falle, setshowPopup_falle] = useState(false);
  const [showPopup_main_kalender, setShowPopup_main_kalender] = useState(false);
  const [showPopup_meds, setShowPopup_meds] = useState(false);
  const [showPopup_main_rechungen, setShowPopup_main_rechungen] = useState(false);
  const [showPopup_briefe, setShowPopup_briefe] = useState(false);
  const [showPopup_krankmeldung, setShowPopup_krankmeldung] = useState(false);
  const [showPopup_communication, setShowPopup_communication] = useState(false);
  const [showPopup_timeline, setShowPopup_timeline] = useState(false);
  const [showPopup_media, setShowPopup_media] = useState(false);
  const [showPopup_main_patienten, setShowPopup_main_patienten] = useState(false);
  const [showPopup_terminplaner, setShowPopup_terminplaner] = useState(false);
  const [showUserPopup, setShowUserPopup] = useState(false);
  const [patient_header, setPatientHeader] = useState(true);
  const [patientEditMode, setPatientEditMode] = useState(false);
  const [showTasksMain, setShowTasksMain] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [notesPreset, setNotesPreset] = useState({});
  const [unreadTasks, setUnreadTasks] = useState(0);
  const [unreadChat, setUnreadChat] = useState(0);
  const [showJourney, setShowJourney] = useState(false);
  const [showWaitingRoom, setShowWaitingRoom] = useState(false);
  const [showAutomationSettings, setShowAutomationSettings] = useState(false);
  const [showBillingSettings, setShowBillingSettings] = useState(false);
  const [showRoomsInline, setShowRoomsInline] = useState(false);
  const [showInventoryInline, setShowInventoryInline] = useState(false);
  const [showSOPs, setShowSOPs] = useState(false);
  const [showDashboardInline, setShowDashboardInline] = useState(false);
  // const [showWorkflows, setShowWorkflows] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [showDoctorAdmin, setShowDoctorAdmin] = useState(false);
  const [doctorList, setDoctorList] = useState([]);
  const [selectedDoctor, setSelectedDoctor] = useState(null);
  const [doctorLoading, setDoctorLoading] = useState(false);
  const [doctorSaving, setDoctorSaving] = useState(false);
  // Arbeits-Tabs (persistente Popups)
  const [workingTabs, setWorkingTabs] = useState([]); // { key, type, title, patientId, patient, state }

  const addWorkingTab = useCallback((type, patient, state) => {
    if (!patient) return;
    const key = `${type}:${patient.id}`;
    setWorkingTabs((prev) => {
      const titleMap = { faelle: 'Fälle', termine: 'Termine', dokumente: 'Dokumente', rezepte: 'Rezepte', briefe: 'Briefe', krankmeldungen: 'Krankmeldungen', patient: 'Patientenakte' };
      const existing = prev.find((t) => t.key === key);
      if (existing) return prev.map((t) => (t.key === key ? { ...t, state } : t));
      return [...prev, { key, type, title: `${titleMap[type] || type}: ${patient.vorname || ''} ${patient.nachname || ''}`.trim(), patientId: patient.id, patient, state }];
    });
  }, []);

  const applySelectedPatient = (patient) => {
    setSelectedPatient(patient ? enrichPatientWithGuardian(patient) : patient);
  };
  const patchSelectedPatient = (patch, { rehydrateGuardian = false } = {}) => {
    setSelectedPatient((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      return rehydrateGuardian ? enrichPatientWithGuardian(next) : next;
    });
  };
  const updateGuardianState = (patch) => patchSelectedPatient(patch, { rehydrateGuardian: true });

  // Provide local variables for the "Als Tab" button in Patientenakte header
  // Keeps the existing design and prevents ESLint no-undef errors.
  const minimizeButtonClassName = 'btn-save';
  const falldaten = {};
  const fallData = {};
  const empfaengerArt = '';
  const andereName = '';
  const andereAdresse = '';
  const onMinimize = (state) => {
    if (!selectedPatient) return;
    addWorkingTab('patient', selectedPatient, state || { formData: selectedPatient });
    setShowPopup_main(false);
  };

  // Load insurers when editing patient in Patientenakte
  useEffect(() => {
    const loadIns = async () => {
      try {
        setInsLoading(true);
        const data = await fetchInsurances({ active: true, limit: 30 });
        setInsurances(Array.isArray(data) ? data : []);
      } catch (e) {
        console.warn('Insurances load failed', e);
      } finally {
        setInsLoading(false);
      }
    };
    if (showPopup_main && patientEditMode) {
      loadIns();
    }
  }, [showPopup_main, patientEditMode]);

  const handleInsuranceSearchAkte = (value) => {
    setInsuranceFilter(value);
  };

  // Debounced live search for insurers
  useEffect(() => {
    let t;
    const run = async () => {
      try {
        setInsLoading(true);
        const v = insuranceFilter || '';
        const params = v.trim().length >= 2
          ? { active: true, q: v.trim().toLowerCase(), limit: 200 }
          : { active: true, limit: 30 };
        const data = await fetchInsurances(params);
        setInsurances(Array.isArray(data) ? data : []);
      } catch (e) {
        console.warn('Insurances search failed', e);
      } finally {
        setInsLoading(false);
      }
    };
    if (patientEditMode) {
      t = setTimeout(run, 300);
    }
    return () => { if (t) clearTimeout(t); };
  }, [insuranceFilter, patientEditMode]);
  const closeWorkingTab = useCallback((key) => {
    setWorkingTabs((prev) => prev.filter((t) => t.key !== key));
  }, []);
  const openWorkingTab = useCallback((tab) => {
    if (!tab) return;
    setSelectedPatient(tab.patient);
    if (tab.type === 'patient') { setShowPopup_main(true); setPatientEditMode(Boolean(tab.state?.editMode)); }
    if (tab.type === 'faelle') { setshowPopup_falle(true); }
    if (tab.type === 'termine') { setShowPopup_terminplaner(true); }
    if (tab.type === 'dokumente') { setShowFileModal(true); }
    if (tab.type === 'rezepte') { setshowPopup_rezepte(true); }
    if (tab.type === 'briefe') { setShowPopup_briefe(true); }
    if (tab.type === 'krankmeldungen') { setShowPopup_krankmeldung(true); }
  }, []);

  useEffect(() => {
    if (!getApiTenantId()) {
      setApiTenantId(DEFAULT_TENANT);
    }
  }, []);

  // Boot: Session laden (Cookie-basiert)
  useEffect(() => {
    const loadSession = async () => {
      try {
        const { data } = await api.get('/api/session');
        if (data?.user) {
          setApiTenantId(data.tenant || '');
          setTenantIdState(data.tenant || '');
          setTenantName(data.tenantName || '');
          setTenantMeta(data.tenantMeta || null);
          setTenantDatabase(data.tenantDatabase || '');
          setUser(data.user);
          await fetchPatients();
          try {
            const { getUnreadTasksCount } = await import('./api');
            const c = await getUnreadTasksCount();
            setUnreadTasks(Number(c) || 0);
          } catch (_) {}
        }
      } catch {
        setApiTenantId(DEFAULT_TENANT);
        setTenantIdState(DEFAULT_TENANT);
        setTenantName('');
        setTenantMeta(null);
        setTenantDatabase('');
        setUser(null);
      }
    };
    loadSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll unread tasks periodically (optional)
  useEffect(() => {
    let timer = null;
    const tick = async () => {
      try {
        const { getUnreadTasksCount } = await import('./api');
        const c = await getUnreadTasksCount();
        setUnreadTasks(Number(c) || 0);
      } catch (_) {}
      try {
        const { getChatUnreadCount } = await import('./api');
        const cc = await getChatUnreadCount();
        setUnreadChat(Number(cc) || 0);
      } catch (_) {}
    };
    if (user) {
      timer = setInterval(tick, 2000);
    }
    return () => { if (timer) clearInterval(timer); };
  }, [user]);

  // Initialize view based on path (simple routing hint)
  useEffect(() => {
    const p = window.location?.pathname || '';
    if (p === '/medikamente') {
      openPopup_meds();
    } else if (p === '/kalender') {
      openPopup_main_kalender();
    } else if (p === '/aufgaben') {
      // Open tasks main view
      setShowDashboardInline(false);
      setShowRoomsInline(false);
      setShowInventoryInline(false);
      setShowPopup_main_kalender(false);
      setShowPopup_main_rechungen(false);
      setShowPopup_meds(false);
      hidePatientFormCompletely(); setShowPatientForm_all(false); setPatientHeader(false);
      setShowTasksMain(true);
    }
    // We intentionally do not include openPopup_* in deps to avoid reruns
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Patienten laden (bei Start und wenn Formular zugeht)
  useEffect(() => {
    if (!showPatientForm) fetchPatients();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPatientForm]);

  // ---------------- Helpers ----------------
  const calculateAge = (dob) => {
    if (!dob) return '';
    const birth = new Date(dob);
    if (Number.isNaN(birth.getTime())) return '';
    const today = new Date();
    let ageVal = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
      ageVal -= 1;
    }
    return ageVal >= 0 ? ageVal : '';
  };

  const handleBirthDateChange = (e) => {
    setBirthDate(e.target.value);
    if (e.target.value) setAge(calculateAge(e.target.value));
    else setAge('');
  };

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData({ ...formData, [name]: type === 'checkbox' ? checked : value });
  };

  const formatGuardianSummary = (patient) => {
    if (!patient) return '';
  const guardianData = patient.guardian || {};
  const firstName = patient.guardian_first_name || guardianData.first_name || '';
  const lastName = patient.guardian_last_name || guardianData.last_name || '';
  const relationship = patient.guardian_relationship || guardianData.relationship || '';
  const phone = patient.guardian_phone || guardianData.phone || '';
  const email = patient.guardian_email || guardianData.email || '';
  let street = patient.guardian_adresse || guardianData.address?.street || '';
  let house = patient.guardian_hausnummer || guardianData.address?.houseNo || '';
  let zip = patient.guardian_plz || guardianData.address?.zip || '';
  let city = patient.guardian_ort || guardianData.address?.city || '';
  if (patient.guardian_same_address && (!street && !house && !zip && !city)) {
    street = patient.adresse || '';
    house = patient.hausnummer || '';
    zip = patient.plz || '';
    city = patient.ort || '';
  }
    const nameLine = [relationship, [firstName, lastName].filter(Boolean).join(' ')].filter(Boolean).join(' – ');
    const addressLine = [street, house].filter(Boolean).join(' ');
    const cityLine = [zip, city].filter(Boolean).join(' ');
    const meta = [
      nameLine,
      addressLine,
      cityLine,
      patient.guardian_same_address ? 'Adresse wie Patient' : '',
      phone ? `Tel: ${phone}` : '',
      email
    ].filter(Boolean);
    return meta.join(' • ');
  };

  const toggleSearch = () => { setSearchVisible(!searchVisible); setShowPatientForm(false); };

  const togglePatientForm = () => {
    setShowPatientForm(!showPatientForm);
    setSearchVisible(false);
    setSelectedPatient(null);
    setIsEditing(false);
    setFormData({
      vorname: '', nachname: '', adresse: '', telefonnummer: '', email: '',
      krankengeschichte: '', medikationsplan: '', allergien: '', impfstatus: '',
      insurance_id: ''
    });
    setBirthDate(''); setAge('');
  };

  useEffect(() => {
    if (showPatientForm) {
      import('./api').then(({ fetchInsurances }) => {
        fetchInsurances({ active: true }).then(setInsurances).catch((e) => console.warn('Insurances load failed', e));
      });
    }
  }, [showPatientForm]);

  // ---------------- API Calls ----------------
  const fetchPatients = async () => {
    try {
      const data = await fetchPatientsApi();
      setPatients(data || []);
    } catch (error) {
      console.error('Fehler beim Abrufen der Patienten:', error);
      if (String(error?.message || '').toLowerCase().includes('nicht angemeldet')) handleLogout();
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (selectedPatient) {
        // Backend unterstützt aktuell noch kein PUT /api/patients/:id.
        alert('Bearbeiten von Patienten ist serverseitig noch nicht verfügbar.');
        return;
      } else {
        // Neuen Patienten anlegen
        await api.post('/api/patients', {
          ...formData,
          geburtsdatum: birthDate,
          alter: age,
        });
        alert('Neuer Patient erfolgreich hinzugefügt');
        setFormData({
          vorname: '', nachname: '', adresse: '', telefonnummer: '', email: '',
          krankengeschichte: '', medikationsplan: '', allergien: '', impfstatus: '',
          insurance_id: ''
        });
        setBirthDate(''); setAge('');
        fetchPatients();
      }
    } catch (error) {
      console.error('Fehler beim Speichern:', error);
      const msg = error?.response?.data?.message || error?.message || 'Unbekannter Fehler';
      alert(`Fehler: ${msg}`);
      if (error?.response?.status === 401 || error?.response?.status === 403) handleLogout();
    }
  };

  // ---------------- Auswahl / Popups ----------------
  const handlePatientClick = (patient) => {
    setSelectedPatient(patient);
    setFormData({
      vorname: patient.vorname, nachname: patient.nachname, adresse: patient.adresse,
      telefonnummer: patient.telefonnummer, email: patient.email,
      krankengeschichte: patient.krankengeschichte, medikationsplan: patient.medikationsplan,
      allergien: patient.allergien, impfstatus: patient.impfstatus,
    });
    setBirthDate(patient.geburtsdatum);
    setAge(calculateAge(patient.geburtsdatum));
    setIsEditing(false);
    setShowPatientForm(true);
  };

  const openPopup_main = async (patient) => {
    if (!patient) return;
    // Sofort anzeigen mit aktuellem Objekt aus Tabelle
    setSelectedPatient(patient);
    setShowPopup_main(true);
    // Danach frisch vom Server auflösen und Tabelle synchronisieren
    try {
      const { data: resolved } = await resolvePatient({ id: patient.id });
      if (resolved && typeof resolved === 'object') {
        setSelectedPatient((prev) => (prev?.id === patient.id ? { ...prev, ...resolved } : prev));
        setPatients((list) => list.map((p) => (p.id === patient.id ? { ...p, ...resolved } : p)));
      }
    } catch (e) {
      // still show existing data
    }
  };
  const closePopup_main = () => {
    // Beim Schließen sicherstellen, dass Liste den letzten Stand aus selectedPatient übernimmt
    if (selectedPatient?.id) {
      const sp = selectedPatient;
      setPatients((list) => list.map((p) => (p.id === sp.id ? { ...p, ...sp } : p)));
    }
    setShowPopup_main(false);
    setSelectedPatient(null);
  };

  const openpopup_rezepte = (patient) => { setSelectedPatient(patient); setshowPopup_rezepte(true); };
  const closepopup_rezepte = () => setshowPopup_rezepte(false);

  const openpopup_falle = (patient) => {
    if (!patient) return;
    setSelectedPatient(patient);
    setShowPopup_main(false);
    setshowPopup_falle(true);
  };
  const closepopup_fall = () => setshowPopup_falle(false);

  function formatDate(dateString) {
    const date = new Date(dateString);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}.${month}.${year}`;
  }

  // Für <input type="date"> ohne Zeitzonen-Verschiebung
  function toDateInputValue(value) {
    if (!value) return '';
    // Falls bereits YYYY-MM-DD
    const s = String(value);
    const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
    // Aus Date ableiten, aber lokales Datum verwenden (nicht UTC)
    const d = new Date(value);
    if (isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${mm}-${dd}`;
  }

  const hidePatientFormCompletely = () => {
    setShowPatientForm(false); setSelectedPatient(null); setSearchVisible(false); setIsEditing(false);
    setFormData({
      vorname: '', nachname: '', adresse: '', telefonnummer: '', email: '',
      krankengeschichte: '', medikationsplan: '', allergien: '', impfstatus: '',
    });
    setBirthDate(''); setAge('');
  };

  // Zentraler Umschalter für die Hauptbereiche unter der Top‑Navigation
  const activateSection = (section) => {
    // Alle Inline‑Bereiche zurücksetzen
    setShowPopup_main_kalender(false);
    setShowPopup_main_rechungen(false);
    setShowPopup_meds(false);
    setShowRoomsInline(false);
    setShowInventoryInline(false);
    setShowDashboardInline(false);
    setShowTasksMain(false);
    setShowPatientForm_all(false);
    setPatientHeader(false);
    hidePatientFormCompletely();

    switch (section) {
      case 'PATIENTS':
        setShowPatientForm_all(true);
        setPatientHeader(true);
        break;
      case 'MEDS':
        setShowPopup_meds(true);
        break;
      case 'KALENDER':
        setShowPopup_main_kalender(true);
        break;
      case 'RECHNUNGEN':
        setShowPopup_main_rechungen(true);
        break;
      case 'ROOMS':
        setShowRoomsInline(true);
        break;
      case 'INVENTAR':
        setShowInventoryInline(true);
        break;
      case 'TASKS':
        setShowTasksMain(true);
        break;
      case 'DASHBOARD':
        setShowDashboardInline(true);
        break;
      default:
        break;
    }
  };

  const openPopup_main_kalender = () => {
    activateSection('KALENDER');
    // Route hint
    try { window.history.pushState({}, '', '/kalender'); } catch {}
  };
  const closePopup_main_kalender = () => setShowPopup_main_kalender(false);

  const openPopup_meds = () => {
    activateSection('MEDS');
    try { window.history.pushState({}, '', '/medikamente'); } catch {}
  };

  const openPopup_main_rechungen = () => {
    activateSection('RECHNUNGEN');
  };

  const openPopup_main_patienten = () => {
    activateSection('PATIENTS');
    setShowPopup_main_patienten(true);
  };

  const openPopup_terminplaner = (patient) => { setSelectedPatient(patient); setShowPopup_terminplaner(true); };
  const closePopup_terminplaner = () => { setSelectedPatient(null); setShowPopup_terminplaner(false); };

  const handleClosePopup = () => setShowUserPopup(false);
  const handlePatientSaved = (patient) => {
    console.log('Patient gespeichert:', patient);
    fetchPatients();
    setShowUserPopup(false);
  };

  // Suche/Filter
  const handleSearchChange = (e) => setSearchTerm(e.target.value);
  const filteredPatients = patients.filter((patient) => {
    return (
      (patient.vorname || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (patient.nachname || '').toLowerCase().includes(searchTerm.toLowerCase())
    );
  });

  // Logout
  const handleLogout = async () => {
    try { await api.post('/api/logout'); } catch (_) { /* ignore */ }
    setApiTenantId(DEFAULT_TENANT);
    setTenantIdState(DEFAULT_TENANT);
    setTenantName('');
    setTenantMeta(null);
    setTenantDatabase('');
    setPatients([]);
    setUser(null);
  };

  const handleLoginSuccess = async (session) => {
    setApiTenantId(session.tenant || '');
    setTenantIdState(session.tenant || '');
    setTenantName(session.tenantName || '');
    setTenantMeta(session.tenantMeta || null);
    setTenantDatabase(session.tenantDatabase || '');
    setUser(session.user);
    await fetchPatients();
  };

  // Rollen-Checks für Ärzteverwaltung
  const roleLower = String(user?.role || user?.rolle || '').toLowerCase();
  const canEditDoctors = hasPermission(user, 'users.manage') || roleLower === 'assistant';
  const canViewDoctorAdmin = canEditDoctors || hasAnyPermission(user, ['appointments.read']) || roleLower === 'doctor';

  const loadDoctors = useCallback(async () => {
    if (!canViewDoctorAdmin) return;
    setDoctorLoading(true);
    try {
      const { data } = await api.get('/api/doctors');
      const list = Array.isArray(data) ? data : [];
      setDoctorList(list);
      if (list.length && !selectedDoctor) setSelectedDoctor(list[0]);
    } catch (err) {
      console.error('Doctors load failed', err);
      alert('Ärzte konnten nicht geladen werden.');
    } finally {
      setDoctorLoading(false);
    }
  }, [canViewDoctorAdmin, selectedDoctor]);

  const openDoctorAdmin = () => {
    if (!canViewDoctorAdmin) {
      alert('Keine Berechtigung.');
      return;
    }
    setShowDoctorAdmin(true);
    loadDoctors();
  };

  const saveDoctor = async () => {
    if (!canEditDoctors || !selectedDoctor) return;
    setDoctorSaving(true);
    try {
      const payload = {
        name: selectedDoctor.name,
        vorname: selectedDoctor.vorname,
        nachname: selectedDoctor.nachname,
        fachrichtung: selectedDoctor.fachrichtung || '',
        sparte: selectedDoctor.sparte || '',
        dignitaet: selectedDoctor.dignitaet || '',
        aktiv: !!selectedDoctor.aktiv
      };
      const { data } = await api.put(`/api/doctors/${selectedDoctor.id}`, payload);
      setSelectedDoctor(data);
      setDoctorList((prev) => prev.map((d) => (d.id === data.id ? data : d)));
    } catch (err) {
      console.error('Doctors save failed', err);
      alert(err?.response?.data?.message || 'Speichern fehlgeschlagen.');
    } finally {
      setDoctorSaving(false);
    }
  };

  // Nicht eingeloggt → Login
  if (!user) {
    return (
      <Login
        onLoginSuccess={handleLoginSuccess}
        initialTenant={tenantId}
        API_BASE={API_BASE}
      />
    );
  }

  // ---------- UI ----------
  return (
    <div className="App">
      <div className="app-container">
        <UserProfileDropdown
          user={user}
          onLogout={handleLogout}
          // SOPs werden über Sidebar geöffnet; Aufgaben sind im Top-Menü
          onOpenNotes={() => { setNotesPreset({ visibilityType: 'PERSONAL' }); setShowNotes(true); }}
          onOpenJourney={() => setShowJourney(true)}
          onOpenWaitingRoom={() => setShowWaitingRoom(true)}
          onOpenAutomationSettings={() => setShowAutomationSettings(true)}
          onOpenBillingSettings={() => setShowBillingSettings(true)}
          onOpenChat={() => setShowChat(true)}
          onOpenSOPs={() => setShowSOPs(true)}
          onOpenRooms={() => {
            activateSection('ROOMS');
          }}
          onOpenDoctors={openDoctorAdmin}
          unreadChat={unreadChat}
        />
        <div className="tenant-indicator" style={{ marginTop: '8px', fontSize: '0.9rem', color: '#555' }}>
          Mandant: {tenantName || tenantId || 'unbekannt'}
          {tenantDatabase ? (
            <>
              {' '}·{' '}
              <span title="Zugehörige Datenbank">
                DB: <code>{tenantDatabase}</code>
              </span>
            </>
          ) : null}
        </div>
        <main className="app-main-content"></main>
      </div>

      <header className="top-header">
        <nav className="tab-nav">
          <button className="tab-button" onClick={() => openPopup_main_patienten()}>Patienten</button>
          <button className="tab-button" onClick={() => openPopup_meds()}>Medikamente</button>
          <button className="tab-button" onClick={() => openPopup_main_rechungen()}>Rechnungen</button>
          <button className="tab-button" onClick={() => openPopup_main_kalender()}> Kalender</button>
          <button className="tab-button" onClick={() => {
            activateSection('ROOMS');
          }}>Räume</button>
          <button className="tab-button" onClick={() => {
            activateSection('INVENTAR');
          }}>Inventar</button>
          <button className="tab-button" onClick={() => {
            activateSection('TASKS');
            try { window.history.pushState({}, '', '/aufgaben'); } catch {}
          }}>Aufgaben{unreadTasks > 0 ? ` (${unreadTasks})` : ''}</button>
          <button className="tab-button" onClick={() => {
            // like meds/patient/calendar, hide other views and show dashboard inline
            activateSection('DASHBOARD');
          }}>Dashboard</button>
          {/* Workflows entfernt */}
        </nav>
      </header>

      {!showTasksMain && (
        <>
          <hr />
          <div className="logo-container">
            <div className="heartbeat-left">
              <svg viewBox="0 0 200 30">
                <path d="M0 15 L20 15 L30 5 L40 25 L50 15 L70 15 L80 10 L90 20 L100 15 L200 15" className="heartbeat-path" />
              </svg>
            </div>

            <img className="logo" src={logo} alt="Logo" />

            <div className="heartbeat-right">
              <svg viewBox="0 0 200 30">
                <path d="M0 15 L20 15 L30 5 L40 25 L50 15 L70 15 L80 10 L90 20 L100 15 L200 15" className="heartbeat-path" />
              </svg>
            </div>
          </div>
          <hr />
        </>
      )}

      {patient_header && (
        <>
          <div className="toolbar">
            <button className="icon-btn" onClick={() => setShowUserPopup(true)} title="Neuen Patienten hinzufügen">
              <FontAwesomeIcon icon={faUserPlus} />
              <span>Neuer Patient</span>
            </button>
            <button className="icon-btn" onClick={toggleSearch} title="Patienten suchen">
              <FontAwesomeIcon icon={faSearch} />
              <span>Patienten suchen</span>
            </button>
          </div>
        </>
      )}

      {showNotes && (
        <NotesView
          user={user}
          preset={notesPreset}
          onClose={() => { setShowNotes(false); setNotesPreset({}); }}
        />
      )}

      {showDoctorAdmin && (
        <div className="popup-overlay">
          <div className="popup-container wide-popup" style={{ width: '80vw', maxWidth: 1100 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0 }}>Ärzte-Verzeichnis (Sparte / Dignität)</h2>
              <button className="btn-cancel" onClick={() => setShowDoctorAdmin(false)}>✖</button>
            </div>
            <p style={{ marginTop: 6, color: '#374151' }}>
              Nur Admin und Arztsekretariat können bearbeiten. Ärzte sehen eigene Daten read-only. Felder: Fachrichtung, Sparte (z.B. 0001,0022), Dignität (z.B. Facharzt Innere Medizin FMH), Aktiv.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 16, marginTop: 10 }}>
              <div style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: 8, maxHeight: '60vh', overflow: 'auto' }}>
                {doctorLoading ? <div>Lade Ärzte …</div> : (
                  <table className="table">
                    <thead>
                      <tr><th>Name</th><th>Fach</th><th>Aktiv</th></tr>
                    </thead>
                    <tbody>
                      {doctorList.map((d) => (
                        <tr key={d.id}
                          className="clickable-row"
                          onClick={() => setSelectedDoctor(d)}
                          style={{ background: selectedDoctor?.id === d.id ? '#eef2ff' : 'transparent' }}
                        >
                          <td>{d.name}</td>
                          <td>{d.fachrichtung || '—'}</td>
                          <td>{d.aktiv ? 'Ja' : 'Nein'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <div style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: 12 }}>
                {selectedDoctor ? (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <label>
                        <div>Name (Anzeige)</div>
                        <input type="text" value={selectedDoctor.name || ''} disabled={!canEditDoctors}
                          onChange={(e) => setSelectedDoctor({ ...selectedDoctor, name: e.target.value })} />
                      </label>
                      <label>
                        <div>Fachrichtung</div>
                        <input type="text" value={selectedDoctor.fachrichtung || ''} disabled={!canEditDoctors}
                          onChange={(e) => setSelectedDoctor({ ...selectedDoctor, fachrichtung: e.target.value })} />
                      </label>
                      <label>
                        <div>Sparte (Komma getrennt)</div>
                        <input type="text" value={selectedDoctor.sparte || ''} disabled={!canEditDoctors}
                          onChange={(e) => setSelectedDoctor({ ...selectedDoctor, sparte: e.target.value })} />
                      </label>
                      <label>
                        <div>Dignität</div>
                        <input type="text" value={selectedDoctor.dignitaet || ''} disabled={!canEditDoctors}
                          onChange={(e) => setSelectedDoctor({ ...selectedDoctor, dignitaet: e.target.value })} />
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input type="checkbox" checked={!!selectedDoctor.aktiv} disabled={!canEditDoctors}
                          onChange={(e) => setSelectedDoctor({ ...selectedDoctor, aktiv: e.target.checked })} />
                        <span>Aktiv</span>
                      </label>
                      <div />
                      <div>
                        <div style={{ fontSize: 12, color: '#6b7280' }}>Angelegt:</div>
                        <div style={{ fontSize: 13 }}>{selectedDoctor.created_at ? new Date(selectedDoctor.created_at).toLocaleString() : '—'}</div>
                        <div style={{ fontSize: 12, color: '#6b7280' }}>Geändert:</div>
                        <div style={{ fontSize: 13 }}>{selectedDoctor.updated_at ? new Date(selectedDoctor.updated_at).toLocaleString() : '—'}</div>
                      </div>
                    </div>
                    {canEditDoctors ? (
                      <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                        <button className="btn-save" onClick={saveDoctor} disabled={doctorSaving}>{doctorSaving ? 'Speichere…' : 'Speichern'}</button>
                        <button className="btn-cancel" onClick={loadDoctors}>Neu laden</button>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div>Kein Arzt ausgewählt.</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      

      {/* Arbeits-Tabs Leiste (horizontal scrollable) */}
      <div className="working-tabs">
        <div className="working-tabs-scroll">
          {workingTabs.length === 0 && (
            <span style={{ color: '#64748b', fontSize: 13 }}>
              Keine Arbeits‑Tabs. Öffne ein Popup und klicke „Als Tab“ um es hier abzulegen.
            </span>
          )}
          {workingTabs.map((tab) => (
            <div key={tab.key} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 8, background: '#eef2ff', border: '1px solid #c7d2fe' }}>
              <button onClick={() => openWorkingTab(tab)} style={{ background: 'transparent', border: 0, cursor: 'pointer', fontWeight: 600 }}>{tab.title}</button>
              <button onClick={() => closeWorkingTab(tab.key)} style={{ background: 'transparent', border: 0, cursor: 'pointer' }} title="Tab schließen">×</button>
            </div>
          ))}
        </div>
      </div>

      {showTasksMain && (
        <div className="responsive-patient-wrapper" style={{ marginTop: 12, padding: 0 }}>
          <TasksView
            user={user}
            embed={true}
            unreadCount={unreadTasks}
            onUnreadChanged={(delta) => {
              setUnreadTasks((n) => {
                const v = Number(n) + Number(delta || 0);
                return v < 0 ? 0 : v;
              });
            }}
          />
        </div>
      )}

      {showPatientForm_all && (
        <div className="responsive-patient-wrapper">
          {searchVisible && (
            <div className="responsive-search-container">
              <input
                type="text"
                placeholder="Suche nach Patienten"
                value={searchTerm}
                onChange={handleSearchChange}
                className="responsive-search-input"
              />
            </div>
          )}

          {/* Desktop-Tabelle */}
          <div className="responsive-table-wrapper desktop-only">
            <table className="responsive-patient-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Adresse</th>
                  <th>Telefon</th>
                  <th>Email</th>
                  <th>AHV</th>
                  <th>Verantwortlich</th>
                </tr>
              </thead>
              <tbody>
                {filteredPatients.map((patient) => (
                  <tr key={patient.id} className="responsive-table-row" onClick={() => openPopup_main(patient)}>
                    <td>
                      <FontAwesomeIcon icon={faUser} /> &nbsp;{patient.vorname} {patient.nachname}
                      {patient.insurance_id ? (
                        <span style={{ marginLeft: 8, color: '#2563eb' }} title="Krankenkasse vorhanden">
                          <FontAwesomeIcon icon={faShieldHalved} style={{ fontSize: 12 }} />
                        </span>
                      ) : null}
                    </td>
                    <td>{patient.adresse}</td>
                    <td>{patient.telefonnummer}</td>
                    <td>{patient.email}</td>
                    <td>{patient.ahv_nummer}</td>
                    <td style={{ whiteSpace: 'normal' }}>{formatGuardianSummary(patient) || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile-Ansicht als Karten */}
          <div className="mobile-only">
            {filteredPatients.map((patient) => (
                <div key={patient.id} className="patient-card" onClick={() => openPopup_main(patient)}>
                  <p>
                    <strong><FontAwesomeIcon icon={faUser} /> {patient.vorname} {patient.nachname}</strong>
                    {patient.insurance_id ? (
                      <span style={{ marginLeft: 8, color: '#2563eb' }} title="Krankenkasse vorhanden">
                        <FontAwesomeIcon icon={faShieldHalved} style={{ fontSize: 12 }} />
                      </span>
                    ) : null}
                  </p>
                  <p><strong>Adresse:</strong> {patient.adresse}</p>
                  <p><strong>Telefon:</strong> {patient.telefonnummer}</p>
                  <p><strong>Email:</strong> {patient.email}</p>
                  <p><strong>AHV:</strong> {patient.ahv_nummer}</p>
                  <p><strong>Verantwortlich:</strong> {formatGuardianSummary(patient) || '—'}</p>
                </div>
            ))}
          </div>
        </div>
      )}

      {showPopup_main && selectedPatient && (
        <div className="popup-overlay">
          <div className="popup-container wide-popup">

             {/* Titel — exakt dein .h2-Style */}
        <h2 className="h2" style={{ margin: 0 }}>
          📁 Patientenakte: {selectedPatient.vorname} {selectedPatient.nachname}
        </h2>

        <div className="title-actions" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          
           {typeof onMinimize === 'function' && (
              <button type="button" className={minimizeButtonClassName} onClick={() => onMinimize({ falldaten, fallData, empfaengerArt, andereName, andereAdresse })} title="Als Tab ablegen" >Als Tab</button>
            )}
  
          <button className="btn-cancel" onClick={closePopup_main} title="Schließen" type="button">❌</button>
        </div>


            <br />
            <hr />

            <form>
              <div className="button-container">
                <button className="tab-button" onClick={(e) => { e.preventDefault(); setShowFileModal(true); }}>
                  <FontAwesomeIcon icon={faFileAlt} className="fa-icon" /> Dokumente
                </button>
                <button className="tab-button" onClick={(e) => { e.preventDefault(); openpopup_falle(selectedPatient); }}>
                  <FontAwesomeIcon icon={faFolderOpen} /> Fälle
                </button>
                <button className="tab-button" onClick={(e) => { e.preventDefault(); setShowPopup_briefe(true); }}>
                  <FontAwesomeIcon icon={faEnvelope} /> Briefe
                </button>
                <button className="tab-button" onClick={(e) => { e.preventDefault(); setShowPopup_krankmeldung(true); }}>
                  <FontAwesomeIcon icon={faFileAlt} /> Krankmeldung
                </button>
                <button className="tab-button" onClick={(e) => { e.preventDefault(); openpopup_rezepte(selectedPatient); }}>
                  <FontAwesomeIcon icon={faPrescriptionBottleAlt} /> Rezepte
                </button>
                <button className="tab-button" onClick={(e) => { e.preventDefault(); openPopup_terminplaner(selectedPatient); }}>
                  <FontAwesomeIcon icon={faCalendarCheck} /> Termine
                </button>
                <button className="tab-button" onClick={(e) => { e.preventDefault(); setNotesPreset({ visibilityType: 'PATIENT', patient: selectedPatient, patientId: selectedPatient.id }); setShowNotes(true); }}>
                  <FontAwesomeIcon icon={faNoteSticky} /> Notizen
                </button>
                <button className="tab-button" onClick={(e) => { e.preventDefault(); setShowPopup_timeline(true); }}>
                  <FontAwesomeIcon icon={faClock} /> Timeline
                </button>
              </div>
              <hr />

              <div style={{ display: 'flex', justifyContent: 'center', position: 'relative', alignItems: 'center', marginTop: 6 }}>
                <span style={{ fontWeight: 600, fontSize: 18 }}>Patientendaten</span>
              </div>
        
              <label>Vorname:</label>
              <input
                type="text"
                value={selectedPatient.vorname}
                disabled={!patientEditMode}
                onChange={(e) => setSelectedPatient({ ...selectedPatient, vorname: e.target.value })}
              />
              <label>Nachname:</label>
              <input
                type="text"
                value={selectedPatient.nachname}
                disabled={!patientEditMode}
                onChange={(e) => setSelectedPatient({ ...selectedPatient, nachname: e.target.value })}
              />
              <label>Geburtsdatum:</label>
              {patientEditMode ? (
                <input
                  type="date"
                  value={toDateInputValue(selectedPatient.geburtsdatum)}
                  onChange={(e) => setSelectedPatient({ ...selectedPatient, geburtsdatum: e.target.value })}
                />
              ) : (
                <input type="text" value={formatDate(selectedPatient.geburtsdatum)} disabled />
              )}
              <label>Alter:</label>
              <input type="text" value={calculateAge(selectedPatient.geburtsdatum) + " Jahre"} disabled />
              <label>Geschlecht:</label>
              {patientEditMode ? (
                <select
                  value={selectedPatient.geschlecht || ''}
                  onChange={(e) => setSelectedPatient({ ...selectedPatient, geschlecht: e.target.value })}
                >
                  <option value="">Bitte wählen</option>
                  <option value="weiblich">Weiblich</option>
                  <option value="männlich">Männlich</option>
                  <option value="divers">Divers</option>
                  <option value="unbekannt">Unbekannt</option>
                </select>
              ) : (
                <input type="text" value={selectedPatient.geschlecht || ''} disabled />
              )}
              {['divers', 'd', 'diverse', 'other'].includes(String(selectedPatient.geschlecht || '').trim().toLowerCase()) && (
                <>
                  <label>Behandeltes Geschlecht (Abrechnung):</label>
                  {patientEditMode ? (
                    <select
                      value={selectedPatient.treated_sex || ''}
                      onChange={(e) => setSelectedPatient({ ...selectedPatient, treated_sex: e.target.value })}
                    >
                      <option value="">Bitte wählen</option>
                      <option value="female">Weiblich</option>
                      <option value="male">Männlich</option>
                    </select>
                  ) : (
                    <input type="text" value={selectedPatient.treated_sex || ''} disabled />
                  )}
                </>
              )}
              <br /><br />

              <label>AHV Nummer:</label>
              <input type="text" value={selectedPatient.ahv_nummer || ''} disabled={!patientEditMode} onChange={(e) => setSelectedPatient({ ...selectedPatient, ahv_nummer: e.target.value })} />

              <div style={{ marginTop: 12 }}>
                <strong>Versicherung / Assurance maladie</strong>
                <hr />
                {/* Versicherer-Name mit Icon (kleines Kassen-Icon) */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <FontAwesomeIcon icon={faShieldHalved} style={{ color: '#2563eb', fontSize: 14 }} />
                  {!patientEditMode ? (
                    <span style={{ fontWeight: 600 }}>{selectedPatient.krankenkasse || selectedPatient.insurance_name || '—'}</span>
                  ) : (
                    <div style={{ flex: 1 }}>
                      <input
                        type="text"
                        placeholder="Suche Versicherung..."
                        value={insuranceFilter}
                        onChange={(e) => handleInsuranceSearchAkte(e.target.value)}
                        style={{ width: '100%', marginBottom: 6 }}
                      />
                      <select
                        value={selectedPatient.insurance_id || ''}
                        onChange={(e) => {
                          const id = e.target.value;
                          if (!id) {
                            // Keine Krankenkasse gewählt -> Felder leeren
                            setSelectedPatient({
                              ...selectedPatient,
                              insurance_id: null,
                              krankenkasse: '',
                              insurance_name: '',
                              krankenkasse_adresse: '',
                              insurance_address: '',
                              insurance_zip: '',
                              insurance_city: '',
                              canton: ''
                            });
                            // Patientenliste sofort anpassen (Icon verschwindet)
                            setPatients((list) => list.map((p) => (
                              p.id === selectedPatient.id
                                ? { ...p, insurance_id: null, krankenkasse: '', insurance_name: '' }
                                : p
                            )));
                          } else {
                            const ins = insurances.find((i) => String(i.id) === String(id));
                            const name = ins?.name || '';
                            const address = ins?.address || ins?.adresse || '';
                            const zip = ins?.zip || ins?.plz || '';
                            const city = ins?.city || ins?.ort || '';
                            const canton = ins?.canton || ins?.kanton || '';
                            const formattedAddr = [address, [zip, city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
                            setSelectedPatient({
                              ...selectedPatient,
                              insurance_id: id,
                              krankenkasse: name,
                              insurance_name: name,
                              krankenkasse_adresse: formattedAddr,
                              insurance_address: address,
                              insurance_zip: zip,
                              insurance_city: city,
                              canton: canton
                            });
                            // Patientenliste sofort anpassen (Icon sichtbar, Name aktuell)
                            setPatients((list) => list.map((p) => (
                              p.id === selectedPatient.id
                                ? { ...p, insurance_id: id, krankenkasse: name, insurance_name: name }
                                : p
                            )));
                          }
                        }}
                      >
                        <option value="">Keine Krankenkasse</option>
                        {insurances.map((i) => (
                          <option key={i.id} value={i.id}>{i.name}{i.canton ? ` (${i.canton})` : ''}</option>
                        ))}
                      </select>
                      {insLoading && <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>Lade Versicherer …</div>}
                      {/* Aktuelle Auswahl/Vorschau während Bearbeiten */}
                      <div style={{ marginTop: 6, fontSize: 13, color: '#374151' }}>
                        <div><strong>Auswahl:</strong> {selectedPatient.krankenkasse || selectedPatient.insurance_name || '—'}</div>
                        <div><strong>Kanton:</strong> {selectedPatient.canton || '—'}</div>
                      </div>
                    </div>
                  )}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: '6px 12px' }}>
                  <div>Adresse:</div>
                  <div>
                    {patientEditMode ? (
                      <input type="text" value={selectedPatient.krankenkasse_adresse || ''} onChange={(e) => setSelectedPatient({ ...selectedPatient, krankenkasse_adresse: e.target.value })} />
                    ) : (
                      (selectedPatient.krankenkasse_adresse && String(selectedPatient.krankenkasse_adresse)) ||
                      [selectedPatient.insurance_address, selectedPatient.insurance_zip, selectedPatient.insurance_city].filter(Boolean).join(', ')
                    )}
                  </div>
                  <div>Kanton:</div>
                  <div>{[selectedPatient.canton || '', selectedPatient.insurance_zip || ''].filter(Boolean).join(', ')}</div>
                </div>
              </div>

              <label>Ort:</label>
              <input type="text" value={selectedPatient.ort || ''} disabled={!patientEditMode} onChange={(e) => setSelectedPatient({ ...selectedPatient, ort: e.target.value })} />
              <label>Versichertennummer:</label>
              <input type="text" value={selectedPatient.versichertennummer || ''} disabled={!patientEditMode} onChange={(e) => setSelectedPatient({ ...selectedPatient, versichertennummer: e.target.value })} />
              <br />

              <label>Adresse:</label>
              <input type="text" value={selectedPatient.adresse || ''} disabled={!patientEditMode} onChange={(e) => setSelectedPatient({ ...selectedPatient, adresse: e.target.value })} />
              <label>Hausnummer:</label>
              <input type="text" value={selectedPatient.hausnummer || ''} disabled={!patientEditMode} onChange={(e) => setSelectedPatient({ ...selectedPatient, hausnummer: e.target.value })} />
              <label>PLZ:</label>
              <input type="text" value={selectedPatient.plz || ''} disabled={!patientEditMode} onChange={(e) => setSelectedPatient({ ...selectedPatient, plz: e.target.value })} />
              <br />

              <label>Telefonnummer:</label>
              <input type="tel" value={selectedPatient.telefonnummer || ''} disabled={!patientEditMode} onChange={(e) => setSelectedPatient({ ...selectedPatient, telefonnummer: e.target.value })} />
              <label>Email:</label>
              <input type="email" value={selectedPatient.email || ''} disabled={!patientEditMode} onChange={(e) => setSelectedPatient({ ...selectedPatient, email: e.target.value })} />
              <label>Vorgesetzter:</label>
              <input
                type="text"
                value={selectedPatient.vorgesetzter || ''}
                disabled={!patientEditMode}
                onChange={(e) => setSelectedPatient({ ...selectedPatient, vorgesetzter: e.target.value })}
              />
              <br /><br />
              <hr />

              <label>Diagnosen:</label>
              <textarea value={selectedPatient.krankengeschichte || ''} disabled={!patientEditMode} onChange={(e) => setSelectedPatient({ ...selectedPatient, krankengeschichte: e.target.value })}></textarea>
              <label>Medikationsplan:</label>
              <textarea value={selectedPatient.medikationsplan || ''} disabled={!patientEditMode} onChange={(e) => setSelectedPatient({ ...selectedPatient, medikationsplan: e.target.value })}></textarea>
              <label>Allergien:</label>
              <textarea value={selectedPatient.allergien || ''} disabled={!patientEditMode} onChange={(e) => setSelectedPatient({ ...selectedPatient, allergien: e.target.value })}></textarea>
              <label>Impfstatus:</label>
              <textarea value={selectedPatient.impfstatus || ''} disabled={!patientEditMode} onChange={(e) => setSelectedPatient({ ...selectedPatient, impfstatus: e.target.value })}></textarea>
              <hr />
            </form>
            <br />
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <div>
                {user && hasPermission(user, 'patients.write') && selectedPatient?.id && (
                  !patientEditMode ? (
                    <button className="btn-save" onClick={(e) => { e.preventDefault(); setPatientEditMode(true); }}>Bearbeiten</button>
                  ) : (
                    <>
                      <button
                        className="btn-save"
                        onClick={async (e) => {
                          e.preventDefault();
                          try {
                            const emptyInsurance = !selectedPatient.insurance_id;
                            const payload = {
                              vorname: selectedPatient.vorname,
                              nachname: selectedPatient.nachname,
                              geburtsdatum: selectedPatient.geburtsdatum,
                              geschlecht: selectedPatient.geschlecht,
                              treated_sex: selectedPatient.treated_sex,
                              telefonnummer: selectedPatient.telefonnummer,
                              email: selectedPatient.email,
                              adresse: selectedPatient.adresse,
                              hausnummer: selectedPatient.hausnummer,
                              plz: selectedPatient.plz,
                              ort: selectedPatient.ort,
                              krankengeschichte: selectedPatient.krankengeschichte,
                              medikationsplan: selectedPatient.medikationsplan,
                              allergien: selectedPatient.allergien,
                              impfstatus: selectedPatient.impfstatus,
                              // Wenn keine Krankenkasse, Felder explizit leeren (null damit Server wirklich löscht)
                              krankenkasse: emptyInsurance ? null : (selectedPatient.krankenkasse || selectedPatient.insurance_name),
                              krankenkasse_adresse: emptyInsurance ? null : (selectedPatient.krankenkasse_adresse || selectedPatient.insurance_address),
                              versichertennummer: selectedPatient.versichertennummer,
                              ahv_nummer: selectedPatient.ahv_nummer,
                              vorgesetzter: selectedPatient.vorgesetzter,
                              // ensure backend can link insurance for canton/zip; null entfernt die Verknüpfung
                              insurance_id: emptyInsurance ? null : selectedPatient.insurance_id
                            };
                            await api.put(`/api/patients/${encodeURIComponent(selectedPatient.id)}`, payload);
                            // Direkt lokalen State anpassen, damit UI sofort aktuell ist
                            setSelectedPatient((prev) => ({
                              ...prev,
                              ...payload,
                              insurance_id: payload.insurance_id,
                              insurance_name: payload.krankenkasse || '',
                              insurance_address: payload.krankenkasse_adresse || '',
                              insurance_zip: emptyInsurance ? '' : (prev.insurance_zip || ''),
                              insurance_city: emptyInsurance ? '' : (prev.insurance_city || ''),
                              canton: emptyInsurance ? '' : (prev.canton || '')
                            }));
                            // Patientenliste im Hintergrund aktualisieren
                            try {
                              const list = await fetchPatientsApi();
                              setPatients(Array.isArray(list) ? list : []);
                            } catch (e) {
                              console.warn('Patientenliste Reload fehlgeschlagen', e);
                            }
                            // Nach dem Speichern Patientendaten (inkl. Versicherung) zusätzlich via Resolve laden
                            // Aber wenn explizit "keine Krankenkasse" gesetzt wurde, nicht direkt mit altem Serverwert überschreiben
                            if (!emptyInsurance) {
                              try {
                                const { data: resolved } = await resolvePatient({ id: selectedPatient.id });
                                if (resolved && typeof resolved === 'object') {
                                  setSelectedPatient((prev) => ({ ...prev, ...resolved }));
                                  // Patientenliste aktualisieren, falls angezeigt
                                  setPatients((list) => list.map((p) => (p.id === selectedPatient.id ? { ...p, ...resolved } : p)));
                                }
                              } catch (er) {
                                console.warn('Patient resolve nach Update fehlgeschlagen', er);
                              }
                            }
                            setPatientEditMode(false);
                            alert('Patient aktualisiert.');
                          } catch (err) {
                            alert(err?.message || 'Aktualisieren fehlgeschlagen');
                          }
                        }}
                      >
                        Aktualisieren
                      </button>
                      <button
                        className="btn-cancel"
                        onClick={async (e) => {
                          e.preventDefault();
                          if (!window.confirm('Diesen Patienten wirklich löschen?')) return;
                          try {
                            await api.delete(`/api/patients/${encodeURIComponent(selectedPatient.id)}`);
                            alert('Patient gelöscht.');
                            setShowPopup_main(false);
                            fetchPatients();
                          } catch (err) {
                            alert(err?.message || 'Löschen fehlgeschlagen');
                          }
                        }}
                      >
                        Löschen
                      </button>
                      <button className="btn-cancel" onClick={(e) => { e.preventDefault(); setPatientEditMode(false); }}>Abbrechen</button>
                    </>
                  )
                )}
              </div>

            </div>
          </div>
        </div>
      )}

      

      {showUserPopup && (
      <BenutzerPopup show={showUserPopup} onClose={handleClosePopup} onSave={handlePatientSaved} />
      )}

      {showPopup_falle && selectedPatient && (
        <FallEröffnung
          tenantMeta={tenantMeta}
          selectedPatient={selectedPatient}
          closepopup_falle={() => setshowPopup_falle(false)}
          onMinimize={(s) => { addWorkingTab('faelle', selectedPatient, s); setshowPopup_falle(false); }}
          initialState={(workingTabs.find(t => t.type==='faelle' && t.patientId===selectedPatient?.id)?.state) || null}
        />
      )}

      {showPopup_rezepte && selectedPatient && (
        <Rezepte
          tenantMeta={tenantMeta}
          selectedPatient={selectedPatient}
          closepopup_rezepte={() => setshowPopup_rezepte(false)}
          onMinimize={(s) => { addWorkingTab('rezepte', selectedPatient, s); setshowPopup_rezepte(false); }}
          initialState={(workingTabs.find(t => t.type==='rezepte' && t.patientId===selectedPatient?.id)?.state) || null}
        />
      )}

      {showPopup_briefe && selectedPatient && (
        <Briefe
          selectedPatient={selectedPatient}
          onClose={() => setShowPopup_briefe(false)}
          onMinimize={(s) => { addWorkingTab('briefe', selectedPatient, s); setShowPopup_briefe(false); }}
          initialState={(workingTabs.find(t => t.type==='briefe' && t.patientId===selectedPatient?.id)?.state) || null}
        />
      )}

      {showPopup_krankmeldung && selectedPatient && (
        <Krankmeldung
          selectedPatient={selectedPatient}
          onClose={() => setShowPopup_krankmeldung(false)}
          onMinimize={(s) => { addWorkingTab('krankmeldungen', selectedPatient, s); setShowPopup_krankmeldung(false); }}
          initialState={(workingTabs.find(t => t.type==='krankmeldungen' && t.patientId===selectedPatient?.id)?.state) || null}
        />
      )}

      {showPopup_communication && selectedPatient && (
        <PatientCommunicationView patient={selectedPatient} onClose={() => setShowPopup_communication(false)} />
      )}

      {showPopup_timeline && selectedPatient && (
        <PatientTimeline patient={selectedPatient} onClose={() => setShowPopup_timeline(false)} />
      )}

      {showPopup_media && selectedPatient && (
        <PatientMediaGallery patient={selectedPatient} onClose={() => setShowPopup_media(false)} />
      )}

      {showFileModal && selectedPatient && (
        <DokumentePopup show={showFileModal} patient={selectedPatient} onClose={() => setShowFileModal(false)} onMinimize={(s) => { addWorkingTab('dokumente', selectedPatient, s); setShowFileModal(false); }} />
      )}

      {showPopup_terminplaner && selectedPatient && (
        <div className="App">
          <TerminPopup
            show={showPopup_terminplaner}
            patient={selectedPatient}
            onClose={() => setShowPopup_terminplaner(false)}
            API_BASE={API_BASE}
            onMinimize={(s) => { addWorkingTab('termine', selectedPatient, s); setShowPopup_terminplaner(false); }}
            initialState={(workingTabs.find(t => t.type==='termine' && t.patientId===selectedPatient?.id)?.state) || null}
          />
        </div>
      )}

      {showPopup_main_rechungen && (
        <div className="responsive-patient-wrapper" style={{ marginTop: 12, padding: 0 }}>
          <RechungenView API_BASE={API_BASE} tenantMeta={tenantMeta} />
        </div>
      )}

      {showPopup_main_kalender && (
        <div className="responsive-patient-wrapper" style={{ marginTop: 12, padding: 0 }}>
          <CalendarView API_BASE={API_BASE} />
        </div>
      )}

      {showPopup_meds && (
        <div className="responsive-patient-wrapper" style={{ marginTop: 12, padding: 0 }}>
          <MediRemidi />
        </div>
      )}

      {/* Patienten-Journey */}
      {showJourney && (
        <div className="popup-overlay">
          <div className="popup-container wide-popup" style={{ width: '80vw' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 className="h2" style={{ margin: 0 }}>Patienten OP Verlauf</h2>
              <button className="btn-cancel" onClick={() => setShowJourney(false)} title="Schließen" type="button">❌</button>
            </div>
            <hr />
            <PatientJourneyBoard />
          </div>
        </div>
      )}

      {/* Wartezimmer */}
      {showWaitingRoom && (
        <div className="popup-overlay">
          <div className="popup-container wide-popup">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 className="h2" style={{ margin: 0 }}>Patienten Verlauf</h2>
              <button className="btn-cancel" onClick={() => setShowWaitingRoom(false)} title="Schließen" type="button">❌</button>
            </div>
            <hr />
            <WaitingRoomView />
          </div>
        </div>
      )}

      {showAutomationSettings && (
        <AutomationSettings onClose={() => setShowAutomationSettings(false)} />
      )}
      {showBillingSettings && (
        <BillingSettings onClose={() => setShowBillingSettings(false)} />
      )}

      {showRoomsInline && (
        <div className="responsive-patient-wrapper" style={{ marginTop: 12, padding: 0 }}>
          <RoomsView inline />
        </div>
      )}

      {showInventoryInline && (
        <div className="responsive-patient-wrapper" style={{ marginTop: 12, padding: 0 }}>
          <InventoryView inline />
        </div>
      )}

      {showSOPs && (
        <SOPsView onClose={() => setShowSOPs(false)} canEdit={hasAnyPermission(user, ['tasks.write', 'patients.write'])} />
      )}


      {showDashboardInline && (
        <div className="responsive-patient-wrapper" style={{ marginTop: 12, padding: 0 }}>
          <CombinedDashboard user={user} />
        </div>
      )}

      {/* Workflows entfernt */}

      {showChat && (
        <ChatView onClose={() => setShowChat(false)} />
      )}
    </div>
  );
}

export default App;
