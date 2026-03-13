// src/api.js
// Zentrale API-Basis mit Dev-Fallback: bevorzugt REACT_APP_API_BASE, sonst Same-Origin.
// Wenn im Dev-Server (Port 3000) ohne Proxy, automatisch auf den konfigurierten Backend-Port umbiegen.
function getApiBase() {
  const envBase = process.env.REACT_APP_API_BASE || process.env.REACT_APP_API_URL;
  if (envBase) return String(envBase).replace(/\/+$/,'');
  const { protocol, hostname, host } = window.location;
  const isDevPort = /:3000$/.test(host);
  if (isDevPort) {
    const backendPort = process.env.REACT_APP_BACKEND_PORT || '5000';
    return `${protocol}//${hostname}:${backendPort}`;
  }
  return `${protocol}//${host}`;
}
const BASE = getApiBase();

let currentTenantId = null;
let currentUserId = null;
let currentJwt = null;
try {
  const stored = sessionStorage.getItem('tenantId');
  if (stored) currentTenantId = stored;
} catch {
  currentTenantId = null;
}
try {
  const storedUser = sessionStorage.getItem('userId');
  if (storedUser) currentUserId = storedUser;
} catch {
  currentUserId = null;
}
// DSGVO/security hardening: JWT is intentionally not persisted in browser storage.
// Session auth should flow via HttpOnly cookies.
currentJwt = null;

export const setTenantId = (tenantId) => {
  currentTenantId = tenantId ? String(tenantId) : null;
  try {
    if (currentTenantId) sessionStorage.setItem('tenantId', currentTenantId);
    else sessionStorage.removeItem('tenantId');
  } catch {
    /* ignore storage errors (private mode etc.) */
  }
};

export const getTenantId = () => currentTenantId;

export const setUserId = (userId) => {
  currentUserId = userId ? String(userId) : null;
  try {
    if (currentUserId != null) sessionStorage.setItem('userId', String(currentUserId));
    else sessionStorage.removeItem('userId');
  } catch {
    /* ignore */
  }
};

export const getUserId = () => currentUserId;

export const setJwt = (token) => {
  currentJwt = token || null;
};

export const getJwt = () => currentJwt;

// Optional compatibility alias
export const setBearerToken = (token) => setJwt(token);

export async function apiFetch(path, opts = {}) {
  const url = path.startsWith('http') ? path : `${BASE}${path.startsWith('/') ? '' : '/'}${path}`;
  const isForm = opts.body instanceof FormData;
  const headers = { ...(opts.headers || {}) };
  // Attach Authorization bearer if we have a stored JWT (useful when cookies are not forwarded)
  if (currentJwt && !headers['Authorization']) headers['Authorization'] = `Bearer ${currentJwt}`;
  if (!isForm && opts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  if (currentTenantId && !headers['X-Tenant-ID']) headers['X-Tenant-ID'] = currentTenantId;
  const isProdBuild = process.env.NODE_ENV === 'production';
  // Dev fallback only: ensure tenant header in local dev to unblock local testing.
  if (!isProdBuild && !headers['X-Tenant-ID']) {
    const devTenant = process.env.REACT_APP_DEV_TENANT_ID || 'dhpatientsync';
    headers['X-Tenant-ID'] = devTenant;
  }
  if (currentUserId != null && !headers['X-User-ID']) headers['X-User-ID'] = String(currentUserId);
  // Dev helpers: never active in production builds.
  if (!isProdBuild && process.env.REACT_APP_DEV_USER_ID && !headers['X-User-ID']) {
    headers['X-User-ID'] = String(process.env.REACT_APP_DEV_USER_ID);
  }
  if (!isProdBuild && process.env.REACT_APP_DEV_TENANT_ID && !headers['X-Tenant-ID']) {
    headers['X-Tenant-ID'] = String(process.env.REACT_APP_DEV_TENANT_ID);
  }

  const res = await fetch(url, { credentials: 'include', ...opts, headers });
  if (res.status === 401) throw new Error('Nicht angemeldet – bitte neu einloggen.');
  return res;
}

// ─── Flyway field-name mapping layer ───────────────────────────────────
// Backend now uses English column names (Flyway schema). Frontend keeps
// German names internally. These helpers translate both directions so that
// API calls stay compatible without touching every form component.
const DE_TO_EN = {
  vorname:'first_name', nachname:'last_name', geburtsdatum:'birth_date',
  geschlecht:'sex', telefonnummer:'phone', adresse:'street',
  hausnummer:'house_number', plz:'postal_code', ort:'city',
  allergien:'allergies', impfstatus:'vaccination_status',
  krankengeschichte:'medical_history', medikationsplan:'medication_plan',
  versichertennummer:'insurance_number', ahv_nummer:'ahv_number',
  krankenkasse:'insurance_name', krankenkasse_name:'insurance_name',
  krankenkasse_adresse:'insurance_address',
  guardian_adresse:'guardian_street', guardian_hausnummer:'guardian_house_number',
  guardian_plz:'guardian_postal_code', guardian_ort:'guardian_city',
};
const EN_TO_DE = {};
for (const [de,en] of Object.entries(DE_TO_EN)) { if (!EN_TO_DE[en]) EN_TO_DE[en] = de; }

const isPatientPath = (p) => /\/api\/patients\b/i.test(p) || /\/api\/rezept\b/i.test(p);

function mapOutgoing(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const out = { ...obj };
  for (const [key,val] of Object.entries(obj)) {
    const eng = DE_TO_EN[key];
    if (eng && !(eng in out)) out[eng] = val;
  }
  return out;
}
function mapIncoming(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(mapIncoming);
  const out = { ...obj };
  for (const [key,val] of Object.entries(obj)) {
    const de = EN_TO_DE[key];
    if (de && !(de in out)) out[de] = val;
  }
  return out;
}
function mapBody(body, path) {
  if (!isPatientPath(path) || !body || typeof body !== 'object' || body instanceof FormData) return body;
  let mapped = mapOutgoing(body);
  if (mapped.patientData && typeof mapped.patientData === 'object') {
    mapped = { ...mapped, patientData: mapOutgoing(mapped.patientData) };
  }
  return mapped;
}
function mapResponse(data, path) {
  if (!isPatientPath(path)) return data;
  if (Array.isArray(data)) return data.map(mapIncoming);
  if (data && typeof data === 'object') {
    const m = mapIncoming(data);
    if (m.patient) m.patient = mapIncoming(m.patient);
    if (Array.isArray(m.items)) m.items = m.items.map(mapIncoming);
    return m;
  }
  return data;
}

// Axios-ähnliches Minimal-Wrapper-API, wie in App.js erwartet
const parseJson = async (res) => {
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return await res.json();
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
};

const api = {
  async get(path, opts = {}) {
    const res = await apiFetch(path, { method: 'GET', ...opts });
    const data = mapResponse(await parseJson(res), path);
    return { data, status: res.status, ok: res.ok };
  },
  async post(path, body, opts = {}) {
    const mapped = mapBody(body, path);
    const res = await apiFetch(path, { method: 'POST', body: mapped && !(mapped instanceof FormData) ? JSON.stringify(mapped) : mapped, ...opts });
    const data = mapResponse(await parseJson(res), path);
    return { data, status: res.status, ok: res.ok };
  },
  async put(path, body, opts = {}) {
    const mapped = mapBody(body, path);
    const res = await apiFetch(path, { method: 'PUT', body: mapped && !(mapped instanceof FormData) ? JSON.stringify(mapped) : mapped, ...opts });
    const data = mapResponse(await parseJson(res), path);
    return { data, status: res.status, ok: res.ok };
  },
  async patch(path, body, opts = {}) {
    const mapped = mapBody(body, path);
    const res = await apiFetch(path, { method: 'PATCH', body: mapped && !(mapped instanceof FormData) ? JSON.stringify(mapped) : mapped, ...opts });
    const data = mapResponse(await parseJson(res), path);
    return { data, status: res.status, ok: res.ok };
  },
  async delete(path, opts = {}) {
    const res = await apiFetch(path, { method: 'DELETE', ...opts });
    const data = mapResponse(await parseJson(res), path);
    return { data, status: res.status, ok: res.ok };
  }
};

export default api;

export async function saveInvoice(payload) {
  const invoiceId = payload?.invoice?.id;
  const encodedId = invoiceId ? encodeURIComponent(invoiceId) : null;
  if (encodedId) {
    return await api.put(`/api/invoices/${encodedId}`, payload);
  }
  return await api.post('/api/invoices', payload);
}

export async function fetchPatients() {
  const res = await api.get('/api/patients');
  return Array.isArray(res.data) ? res.data : [];
}

export async function searchPatients(query) {
  const qs = encodeURIComponent(query || '');
  const res = await api.get(`/api/patients/search?query=${qs}`);
  return Array.isArray(res.data) ? res.data : [];
}

export async function fetchAppointments() {
  try {
    const res = await api.get('/api/appointments');
    if (Array.isArray(res.data)) return res.data;
  } catch (err) {
    console.warn('Termine konnten nicht über /api/appointments geladen werden:', err?.message || err);
  }
  return [];
}

export async function createAppointment(payload) {
  return api.post('/api/appointments', payload);
}

export async function updateAppointment(id, payload) {
  return api.put(`/api/appointments/${encodeURIComponent(id)}`, payload);
}

export async function deleteAppointment(id) {
  return api.delete(`/api/appointments/${encodeURIComponent(id)}`);
}

export async function fetchAppointmentsFiltered({ type, userId } = {}) {
  const params = new URLSearchParams();
  if (type) params.set('type', String(type));
  if (userId) params.set('user_id', String(userId));
  const res = await api.get(`/api/appointments?${params.toString()}`);
  return Array.isArray(res.data) ? res.data : [];
}

export async function listAccessibleUsers() {
  const res = await api.get('/api/users/accessible');
  if (Array.isArray(res?.data?.items)) return res.data.items;
  if (Array.isArray(res?.data)) return res.data;
  return [];
}

export async function getSessionInfo() {
  // server exposes /api/session with user + tenant info
  try {
    const res = await api.get('/api/session');
    return res?.data || {};
  } catch {
    return {};
  }
}

// New calendar-aware helpers
export async function getMyCalendars() {
  const out = [];
  const pushUnique = (item) => {
    if (!item || typeof item !== 'object') return;
    const id = String(item.id ?? '').trim();
    if (!id) return;
    if (!out.some((x) => String(x?.id ?? '').trim() === id)) out.push(item);
  };
  try {
    // Erst persönlichen Kalender sicherstellen (provisioniert wenn nötig)
    const mine = await api.get('/api/calendars/mine');
    if (mine?.data && !Array.isArray(mine.data)) {
      pushUnique(mine.data);
    }
  } catch (_) {}
  try {
    // Dann alle im Tenant (für Picker anzeigen)
    const all = await api.get('/api/calendars/tenant');
    if (Array.isArray(all?.data?.items) && all.data.items.length) {
      all.data.items.forEach(pushUnique);
    } else if (Array.isArray(all?.data) && all.data.length) {
      all.data.forEach(pushUnique);
    }
  } catch (e) {
    // fall back to generic list
  }
  if (out.length) return out;
  try {
    const resMe = await api.get('/api/calendars/me');
    if (Array.isArray(resMe?.data)) return resMe.data;
    if (Array.isArray(resMe?.data?.items)) return resMe.data.items;
  } catch (_eMine) {}
  try {
    const resAll = await api.get('/api/calendars');
    if (Array.isArray(resAll?.data?.items)) return resAll.data.items;
    if (Array.isArray(resAll.data)) return resAll.data;
  } catch (e2) {
    console.warn('Kalenderliste konnte nicht geladen werden:', e2?.message || e2);
  }
  return [];
}

export async function getAppointmentsByCalendarIds({ calendarIds = [], from, to, limit = 500, offset = 0 } = {}) {
  // Prefer the dedicated by-calendars endpoint if available, then fall back to /api/appointments
  const buildParams = (useIdsKey = true) => {
    const p = new URLSearchParams();
    if (calendarIds && calendarIds.length) p.set(useIdsKey ? 'ids' : 'calendarIds', calendarIds.join(','));
    if (from) p.set('from', new Date(from).toISOString());
    if (to) p.set('to', new Date(to).toISOString());
    if (limit != null) p.set('limit', String(limit));
    if (offset) p.set('offset', String(offset));
    return p;
  };

  // Attempt /by-calendars first
  try {
    const res = await api.get(`/api/appointments/by-calendars?${buildParams(true).toString()}`);
    if (Array.isArray(res?.data?.items)) return res.data.items;
    if (Array.isArray(res.data)) return res.data;
  } catch (_) {
    // ignore and try fallback
  }

  // Fallback: unified appointments with calendarIds
  const res2 = await api.get(`/api/appointments?${buildParams(false).toString()}`);
  if (Array.isArray(res2?.data?.items)) return res2.data.items;
  if (Array.isArray(res2.data)) return res2.data;
  return [];
}
export async function fetchInvoices() {
  const res = await api.get('/api/invoices');
  return Array.isArray(res.data) ? res.data : [];
}

// Letters (Briefe)
export async function listLetters(patientId) {
  const pid = encodeURIComponent(String(patientId));
  const res = await api.get(`/api/letters?patient_id=${pid}`);
  return Array.isArray(res?.data?.items) ? res.data.items : [];
}
export async function createLetter(payload) {
  const res = await api.post('/api/letters', payload);
  return res?.data || null;
}
export async function updateLetter(id, payload) {
  const res = await api.put(`/api/letters/${encodeURIComponent(id)}`, payload);
  return res?.data || null;
}
export async function finalizeLetter(id) {
  const res = await api.post(`/api/letters/${encodeURIComponent(id)}/finalize`);
  return res?.data || null;
}
export function letterPdfUrl(id, inline = false) {
  return inline ? `/api/letters/${encodeURIComponent(id)}/pdf/view` : `/api/letters/${encodeURIComponent(id)}/pdf`;
}
export async function getLetter(id) {
  const res = await api.get(`/api/letters/${encodeURIComponent(id)}`);
  return res?.data || null;
}
export async function deleteLetter(id) {
  const res = await api.delete(`/api/letters/${encodeURIComponent(id)}`);
  return res?.data || null;
}

// Sick Notes (Krankmeldungen)
export async function listSickNotes(patientId) {
  const pid = encodeURIComponent(String(patientId));
  const res = await api.get(`/api/sick-notes?patient_id=${pid}`);
  return Array.isArray(res?.data?.items) ? res.data.items : [];
}
export async function createSickNote(payload) {
  const res = await api.post('/api/sick-notes', payload);
  return res?.data || null;
}
export async function updateSickNote(id, payload) {
  const res = await api.put(`/api/sick-notes/${encodeURIComponent(id)}`, payload);
  return res?.data || null;
}
export async function finalizeSickNote(id) {
  const res = await api.post(`/api/sick-notes/${encodeURIComponent(id)}/finalize`);
  return res?.data || null;
}
export function sickNotePdfUrl(id, inline = false) {
  return inline ? `/api/sick-notes/${encodeURIComponent(id)}/pdf/view` : `/api/sick-notes/${encodeURIComponent(id)}/pdf`;
}

export async function createPatient(payload) {
  return api.post('/api/patients', payload);
}

export async function resolvePatient(params) {
  try {
    if (params && params.id != null) {
      const id = encodeURIComponent(params.id);
      return await api.get(`/api/patients/${id}`);
    }
    const qs = new URLSearchParams();
    const map = {
      vorname: params?.vorname, first_name: params?.vorname,
      nachname: params?.nachname, last_name: params?.nachname,
      adresse: params?.adresse, street: params?.adresse,
      versichertennummer: params?.versichertennummer || params?.insurance_number,
      insurance_number: params?.insurance_number || params?.versichertennummer,
    };
    Object.entries(map).forEach(([k, v]) => {
      if (v != null && String(v).trim().length) qs.set(k, String(v).trim());
    });
    return await api.get(`/api/patients/resolve?${qs.toString()}`);
  } catch (e) {
    return { data: null, status: e?.status || 500, ok: false };
  }
}

export async function fetchInsurances({ active = true, q = '', limit = 30 } = {}) {
  const params = new URLSearchParams();
  if (active !== undefined) params.set('active', String(active));
  if (q) params.set('q', String(q));
  if (limit) params.set('limit', String(limit));
  const res = await api.get(`/api/insurances?${params.toString()}`);
  return Array.isArray(res.data) ? res.data : [];
}

// Tasks API
export async function getUnreadTasksCount(statuses = ['OPEN','IN_PROGRESS']) {
  const params = new URLSearchParams();
  if (Array.isArray(statuses) && statuses.length) params.set('status', statuses.join(','));
  const res = await api.get(`/api/tasks/unreadCount?${params.toString()}`);
  const val = res?.data?.count;
  return Number.isFinite(Number(val)) ? Number(val) : 0;
}

export async function listTasks({ assignedToUserId, createdByUserId, status, priority, type, patientId, search, limit = 50, offset = 0 } = {}) {
  const p = new URLSearchParams();
  if (assignedToUserId) p.set('assigned_to_user_id', String(assignedToUserId));
  if (createdByUserId) p.set('created_by_user_id', String(createdByUserId));
  if (status && status.length) p.set('status', Array.isArray(status) ? status.join(',') : String(status));
  if (priority && priority.length) p.set('priority', Array.isArray(priority) ? priority.join(',') : String(priority));
  if (type) p.set('type', String(type));
  if (patientId) p.set('patient_id', String(patientId));
  if (search) p.set('q', String(search));
  if (limit != null) p.set('limit', String(limit));
  if (offset) p.set('offset', String(offset));
  const res = await api.get(`/api/tasks?${p.toString()}`);
  return Array.isArray(res?.data?.items) ? res.data.items : [];
}

export async function getTask(id) {
  const res = await api.get(`/api/tasks/${encodeURIComponent(id)}`);
  return res?.data || null;
}

export async function createTask(payload) {
  const res = await api.post('/api/tasks', payload);
  return res?.data || null;
}

export async function updateTask(id, payload) {
  const res = await api.patch(`/api/tasks/${encodeURIComponent(id)}`, payload);
  return res?.data || null;
}

export async function addTaskComment(id, commentText) {
  const res = await api.post(`/api/tasks/${encodeURIComponent(id)}/comments`, { comment_text: commentText });
  return res?.data || null;
}

export async function markTaskRead(id) {
  const res = await api.post(`/api/tasks/${encodeURIComponent(id)}/read`);
  return res?.data || null;
}

// Notes API
export async function listNotes({ visibilityType, patientId, tag, search, limit = 100, offset = 0 } = {}) {
  const p = new URLSearchParams();
  if (visibilityType) p.set('visibilityType', String(visibilityType));
  if (patientId != null) p.set('patientId', String(patientId));
  if (tag) p.set('tag', String(tag));
  if (search) p.set('q', String(search));
  if (limit != null) p.set('limit', String(limit));
  if (offset) p.set('offset', String(offset));
  const res = await api.get(`/api/notes?${p.toString()}`);
  return Array.isArray(res?.data?.items) ? res.data.items : [];
}

export async function getNote(id) {
  const res = await api.get(`/api/notes/${encodeURIComponent(id)}`);
  return res?.data || null;
}

export async function createNote(payload) {
  const res = await api.post('/api/notes', payload);
  return res?.data || null;
}

export async function updateNote(id, payload) {
  const res = await api.patch(`/api/notes/${encodeURIComponent(id)}`, payload);
  return res?.data || null;
}

export async function lockNote(id) {
  const res = await api.patch(`/api/notes/${encodeURIComponent(id)}/lock`, {});
  return res?.data || null;
}

export async function deleteNote(id) {
  const res = await api.delete(`/api/notes/${encodeURIComponent(id)}`);
  return res?.data || null;
}

// Patienten-Journey API
export async function getPatientJourney(patientId) {
  const res = await api.get(`/api/patients/${encodeURIComponent(patientId)}/journey`);
  return res?.data || null;
}

export async function setPatientJourneyStage(patientId, stage) {
  const res = await api.patch(`/api/patients/${encodeURIComponent(patientId)}/journey`, { stage });
  return res?.data || null;
}

export async function listPatientJourney({ stage } = {}) {
  const p = new URLSearchParams();
  if (stage) p.set('stage', String(stage));
  const res = await api.get(`/api/patient-journey${p.toString() ? `?${p.toString()}` : ''}`);
  return Array.isArray(res?.data?.items) ? res.data.items : [];
}

// Wartezimmer API
export async function getWaitingStatus(patientId) {
  const res = await api.get(`/api/patients/${encodeURIComponent(patientId)}/waiting-status`);
  return res?.data || null;
}

export async function setWaitingStatus(patientId, status) {
  const res = await api.post(`/api/patients/${encodeURIComponent(patientId)}/waiting-status`, { status });
  return res?.data || null;
}

export async function listWaitingRoom({ status } = {}) {
  const p = new URLSearchParams();
  if (status) p.set('status', String(status));
  const res = await api.get(`/api/waiting-room${p.toString() ? `?${p.toString()}` : ''}`);
  return Array.isArray(res?.data?.items) ? res.data.items : [];
}

// Inventory API
export async function listInventoryItems({ search, lowStockOnly } = {}) {
  const p = new URLSearchParams();
  if (search) p.set('search', String(search));
  if (lowStockOnly) p.set('lowStockOnly', 'true');
  const res = await api.get(`/api/inventory/items${p.toString() ? `?${p.toString()}` : ''}`);
  return Array.isArray(res?.data?.items) ? res.data.items : [];
}

export async function createInventoryItem(payload) {
  const res = await api.post('/api/inventory/items', payload);
  return res?.data || null;
}

export async function updateInventoryItem(id, payload) {
  const res = await api.patch(`/api/inventory/items/${encodeURIComponent(id)}`, payload);
  return res?.data || null;
}

export async function adjustInventoryItem(id, { delta, reason }) {
  const res = await api.post(`/api/inventory/items/${encodeURIComponent(id)}/adjust`, { delta, reason });
  return res?.data || null;
}

export async function listInventoryTransactions(id) {
  const res = await api.get(`/api/inventory/items/${encodeURIComponent(id)}/transactions`);
  return Array.isArray(res?.data?.items) ? res.data.items : [];
}

// SOPs API
export async function listSOPs({ search } = {}) {
  const p = new URLSearchParams();
  if (search) p.set('search', String(search));
  const res = await api.get(`/api/sops${p.toString() ? `?${p.toString()}` : ''}`);
  return Array.isArray(res?.data?.items) ? res.data.items : [];
}
export async function getSOP(id) {
  const res = await api.get(`/api/sops/${encodeURIComponent(id)}`);
  return res?.data || null;
}
export async function createSOP(payload) {
  const res = await api.post('/api/sops', payload);
  return res?.data || null;
}
export async function updateSOP(id, payload) {
  const res = await api.patch(`/api/sops/${encodeURIComponent(id)}`, payload);
  return res?.data || null;
}
export async function lockSOP(id) {
  const res = await api.post(`/api/sops/${encodeURIComponent(id)}/lock`, {});
  return res?.data || null;
}

// Chat helpers
export async function getChatUnreadCount(channelId) {
  const res = await api.get(`/api/chat/unreadCount${channelId ? `?channelId=${encodeURIComponent(channelId)}` : ''}`);
  return Number(res?.data?.count || 0);
}
export async function getChatMessages(channelId, { limit = 200 } = {}) {
  const res = await api.get(`/api/chat/messages?channelId=${encodeURIComponent(channelId)}&limit=${encodeURIComponent(limit)}`);
  return Array.isArray(res?.data?.items) ? res.data.items : [];
}
export async function sendChatMessage(channelId, content) {
  const res = await api.post('/api/chat/messages', { channel_id: channelId, content });
  return res?.data || null;
}
export async function markChatRead(messageId) {
  try { await api.post(`/api/chat/messages/${encodeURIComponent(messageId)}/read`, {}); } catch {}
}
export async function getChatTyping(channelId) {
  try { const res = await api.get(`/api/chat/typing?channelId=${encodeURIComponent(channelId)}`); return Array.isArray(res?.data?.users) ? res.data.users : []; } catch { return []; }
}
export async function sendChatTyping(channelId) {
  try { await api.post('/api/chat/typing', { channel_id: channelId }); } catch {}
}

// Direct messages
export async function startDM(userId) {
  const res = await api.post('/api/chat/dm/start', { user_id: String(userId) });
  return res?.data || null;
}
export async function listDMs() {
  const res = await api.get('/api/chat/dm/list');
  return Array.isArray(res?.data?.items) ? res.data.items : [];
}
