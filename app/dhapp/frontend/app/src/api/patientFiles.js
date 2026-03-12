import { getJson, getBlob, postForm, del } from './client';

export async function resolvePatient(id) {
  try {
    return await getJson(`/api/patients/${encodeURIComponent(id)}`);
  } catch (_e) {
    try {
      return await getJson(`/api/patients/resolve?id=${encodeURIComponent(id)}`);
    } catch {
      return {};
    }
  }
}

export async function listFiles(patientId) {
  // Backend primary route (observed in server.js)
  try {
    return await getJson(`/api/patient-files/${encodeURIComponent(patientId)}`);
  } catch (_e) {
    // Future/new style fallback
    return await getJson(`/api/patients/${encodeURIComponent(patientId)}/files`);
  }
}

export async function uploadFile(patientId, file) {
  const fd = new FormData();
  fd.append('file', file, file.name);
  // Backend primary route
  try {
    return await postForm(`/api/upload-patient-file/${encodeURIComponent(patientId)}`, fd);
  } catch (_e) {
    // New style fallback
    return await postForm(`/api/patients/${encodeURIComponent(patientId)}/files`, fd);
  }
}

export async function downloadFile(patientId, fileName) {
  // Backend serves statically from /patient-files/<id>/<filename>
  try {
    const seg = String(fileName).split('/').map(encodeURIComponent).join('/');
    return await getBlob(`/patient-files/${encodeURIComponent(patientId)}/${seg}`);
  } catch (_e) {
    // Alternate new-style path if available
    const seg2 = String(fileName).split('/').map(encodeURIComponent).join('/');
    return await getBlob(`/api/patients/${encodeURIComponent(patientId)}/files/${seg2}`);
  }
}

export async function deleteFile(patientId, fileName) {
  // Primary backend route implemented in server.js
  try {
    return await del(`/api/patient-files/${encodeURIComponent(patientId)}?name=${encodeURIComponent(fileName)}`);
  } catch (_) {}
  // Legacy fallback
  try {
    return await del(`/api/delete-patient-file/${encodeURIComponent(patientId)}?name=${encodeURIComponent(fileName)}`);
  } catch (e) {
    throw e;
  }
}

export default { resolvePatient, listFiles, uploadFile, downloadFile, deleteFile };
