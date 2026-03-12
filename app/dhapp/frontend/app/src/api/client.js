// Single-source API client: delegate to src/api.js (tenant header, dev base, cookie+optional bearer)
import { apiFetch } from '../api';

function assertOk(res) {
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res;
}

export async function getJson(path) {
  const res = await apiFetch(path, { method: 'GET', headers: { Accept: 'application/json' } });
  assertOk(res);
  return res.json();
}

export async function getBlob(path) {
  const res = await apiFetch(path, { method: 'GET', headers: { Accept: '*/*' } });
  assertOk(res);
  return res.blob();
}

export async function postForm(path, formData) {
  const res = await apiFetch(path, { method: 'POST', body: formData });
  assertOk(res);
  return res.json().catch(() => ({}));
}

export async function del(path) {
  const res = await apiFetch(path, { method: 'DELETE' });
  assertOk(res);
  return res.json().catch(() => ({}));
}

export default { getJson, getBlob, postForm, del };
