(function () {
  const tenantInput = document.getElementById('tenant');
  const usernameInput = document.getElementById('username');
  const passwordInput = document.getElementById('password');
  const loginButton = document.getElementById('loginButton');
  const errorMessage = document.getElementById('errorMessage');
  const tenantStatus = document.getElementById('tenantStatus');
  const bootLoader = document.getElementById('bootLoader');
  const loginContent = document.getElementById('loginContent');

  let tenantLookupTimer = null;
  let tenantLookupController = null;
  let submitting = false;

  function setError(msg) {
    if (!msg) {
      errorMessage.textContent = '';
      errorMessage.style.display = 'none';
      return;
    }
    errorMessage.textContent = msg;
    errorMessage.style.display = 'block';
  }

  function setTenantStatus(kind, lines) {
    if (!kind) {
      tenantStatus.innerHTML = '';
      tenantStatus.className = 'loginpage-tenant-status';
      tenantStatus.style.display = 'none';
      return;
    }

    tenantStatus.className = `loginpage-tenant-status ${kind}`;
    tenantStatus.innerHTML = lines.join('<br />');
    tenantStatus.style.display = 'block';
  }

  function updateDisabledState() {
    const disabled = submitting || !tenantInput.value.trim() || !usernameInput.value.trim() || !passwordInput.value;
    tenantInput.disabled = submitting;
    usernameInput.disabled = submitting;
    passwordInput.disabled = submitting;
    loginButton.disabled = disabled;
    loginButton.textContent = submitting ? 'Anmelden...' : 'Einloggen';
  }

  async function lookupTenant() {
    const tenant = tenantInput.value.trim();
    if (!tenant) {
      setTenantStatus(null);
      return;
    }

    if (tenantLookupController) {
      tenantLookupController.abort();
    }
    tenantLookupController = new AbortController();

    setTenantStatus('pending', ['Mandant wird geprueft ...']);

    try {
      const res = await fetch(`/api/public/tenants/${encodeURIComponent(tenant)}`, {
        method: 'GET',
        signal: tenantLookupController.signal,
      });

      if (!res.ok) throw new Error('not_found');
      const data = await res.json();
      const lines = [`<strong>${data.displayName || tenant}</strong>`];
      if (data && data.meta && data.meta.clinic && data.meta.clinic.subtitle) {
        lines.push(String(data.meta.clinic.subtitle));
      }
      setTenantStatus('success', lines);
    } catch (err) {
      if (tenantLookupController.signal.aborted) return;
      setTenantStatus('error', ['Mandant nicht gefunden oder deaktiviert.']);
    }
  }

  function scheduleTenantLookup() {
    if (tenantLookupTimer) {
      clearTimeout(tenantLookupTimer);
    }
    tenantLookupTimer = setTimeout(lookupTenant, 250);
  }

  async function handleLogin() {
    if (submitting) return;

    const tenant = tenantInput.value.trim();
    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    if (!tenant) {
      setError('Bitte Mandanten-ID eingeben.');
      return;
    }

    setError('');
    submitting = true;
    updateDisabledState();

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-ID': tenant,
        },
        credentials: 'include',
        body: JSON.stringify({
          username,
          password,
          tenant,
        }),
      });

      const payload = await res.json().catch(function () { return {}; });

      if (!res.ok) {
        setError(payload.message || 'Falscher Benutzername oder Passwort');
        return;
      }

      if (!payload.redirectUrl) {
        setError('Redirect-URL fehlt.');
        return;
      }

      window.location.href = payload.redirectUrl;
    } catch (_err) {
      setError('Serverfehler beim Login (Netzwerk/HTTPS).');
    } finally {
      submitting = false;
      updateDisabledState();
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleLogin();
    }
  }

  tenantInput.addEventListener('input', function () {
    scheduleTenantLookup();
    updateDisabledState();
  });
  usernameInput.addEventListener('input', updateDisabledState);
  passwordInput.addEventListener('input', updateDisabledState);
  tenantInput.addEventListener('keydown', onKeyDown);
  usernameInput.addEventListener('keydown', onKeyDown);
  passwordInput.addEventListener('keydown', onKeyDown);
  loginButton.addEventListener('click', handleLogin);

  setTimeout(function () {
    bootLoader.style.display = 'none';
    loginContent.style.display = 'flex';
    updateDisabledState();
  }, 800);
})();
