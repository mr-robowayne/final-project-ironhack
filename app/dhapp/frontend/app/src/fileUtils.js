import { getTenantId } from "./api";

export const openFile = async (file, selectedPatient) => {
    try {
        const tenant = getTenantId();
        const response = await fetch(`/api/open-file/${selectedPatient.id}/${file.name}`, {
            credentials: 'include',
            headers: tenant ? { 'X-Tenant-ID': tenant } : {}
        });
        const data = await response.json();
        console.log(data.message);
    } catch (error) {
        console.error("Fehler beim Öffnen der Datei:", error);
    }
};
