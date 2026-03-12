// src/login.js
import React, { useState, useEffect, useCallback } from 'react';
import './login.css';
import logo from './assets/logo.png';

function Login({ onLoginSuccess, API_BASE, initialTenant = '' }) {
  // API-Basis: Prop > .env > Same-Origin
  const apiBase = ((API_BASE || process.env.REACT_APP_API_BASE || '') + '').replace(/\/+$/, '');

  const [tenant, setTenant] = useState(initialTenant);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [isBooting, setIsBooting] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [tenantInfo, setTenantInfo] = useState(null);
  const [tenantLookupError, setTenantLookupError] = useState('');
  const [tenantLookupPending, setTenantLookupPending] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setIsBooting(false), 800);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    setTenant(initialTenant || '');
  }, [initialTenant]);

  useEffect(() => {
    const tenantTrimmed = tenant.trim();
    if (!tenantTrimmed) {
      setTenantInfo(null);
      setTenantLookupError('');
      setTenantLookupPending(false);
      return;
    }
    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      setTenantLookupPending(true);
      try {
        const res = await fetch(`${apiBase}/api/public/tenants/${encodeURIComponent(tenantTrimmed)}`, {
          method: 'GET',
          signal: controller.signal
        });
        if (!res.ok) throw new Error('not_found');
        const data = await res.json();
        setTenantInfo(data);
        setTenantLookupError('');
      } catch (fetchError) {
        if (controller.signal.aborted) return;
        setTenantInfo(null);
        setTenantLookupError('Mandant nicht gefunden oder deaktiviert.');
      } finally {
        if (!controller.signal.aborted) {
          setTenantLookupPending(false);
        }
      }
    }, 250);
    return () => {
      controller.abort();
      clearTimeout(timeout);
      setTenantLookupPending(false);
    };
  }, [apiBase, tenant]);

  const handleLogin = useCallback(async () => {
    if (submitting) return;
    const tenantTrimmed = tenant.trim();
    if (!tenantTrimmed) {
      setError('Bitte Mandanten-ID eingeben.');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const res = await fetch(`${apiBase}/api/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-ID': tenantTrimmed
        },
        credentials: 'include',
        body: JSON.stringify({
          username: username.trim(),
          password,
          tenant: tenantTrimmed,
        }),
      });

      if (!res.ok) {
        let msg = 'Falscher Benutzername oder Passwort';
        try {
          const j = await res.json();
          if (j?.message) msg = j.message;
        } catch { /* ignore */ }
        setError(msg);
        setSubmitting(false);
        return;
      }

      const data = await res.json();
      onLoginSuccess?.(data);
    } catch (e) {
      setError('Serverfehler beim Login (Netzwerk/HTTPS).');
    } finally {
      setSubmitting(false);
    }
  }, [apiBase, onLoginSuccess, password, submitting, tenant, username]);

  const onKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleLogin();
    }
  };

  if (isBooting) {
    return (
      <div className="loginpage-wrapper">
        <div className="loader-container">
          <div className="apple-spinner"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="loginpage-wrapper">
      <div className="loginpage-outer-wrapper">
        <div className="loginpage-logo-wrapper">
          <div className="loginpage-heartbeat-left"></div>
          <img className="loginpage-logo" src={logo} alt="Logo" />
          <div className="loginpage-heartbeat-right">
            <svg viewBox="0 0 200 30" className="loginpage-svg">
              <path
                d="M0 15 L20 15 L30 5 L40 25 L50 15 L70 15 L80 10 L90 20 L100 15 L200 15"
                className="loginpage-heartbeat-path"
              />
            </svg>
          </div>
        </div>

        <div className="loginpage-form-container">
          <h2>Login</h2>

          <input
            type="text"
            placeholder="Mandant"
          autoComplete="organization"
          value={tenant}
          onChange={(e) => setTenant(e.target.value)}
          onKeyDown={onKeyDown}
          className="loginpage-input"
          disabled={submitting}
        />
          {tenantLookupPending && (
            <div className="loginpage-tenant-status">Mandant wird geprüft …</div>
          )}
          {tenantInfo && !tenantLookupPending && (
            <div className="loginpage-tenant-status success">
              <div><strong>{tenantInfo.displayName}</strong></div>
              {tenantInfo?.meta?.clinic?.subtitle && (
                <div>{tenantInfo.meta.clinic.subtitle}</div>
              )}
              {tenantInfo?.database && (
                <div>Datenbank: <code>{tenantInfo.database}</code></div>
              )}
            </div>
          )}
          {tenantLookupError && !tenantLookupPending && (
            <div className="loginpage-tenant-status error">{tenantLookupError}</div>
          )}
          <br />

          <input
            type="text"
            placeholder="Benutzername"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={onKeyDown}
            className="loginpage-input"
            disabled={submitting}
          />
          <br />

          <input
            type="password"
            placeholder="Passwort"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={onKeyDown}
            className="loginpage-input"
            disabled={submitting}
          />
          <br />

          <button
            onClick={handleLogin}
            className="loginpage-button"
            disabled={submitting || !tenant.trim() || !username.trim() || !password}
          >
            {submitting ? 'Anmelden…' : 'Einloggen'}
          </button>

          {error && <p className="loginpage-error-message">{error}</p>}
          <noscript>
            <p className="loginpage-error-message">JavaScript ist deaktiviert – bitte aktivieren.</p>
          </noscript>
        </div>
      </div>
    </div>
  );
}

export default Login;
