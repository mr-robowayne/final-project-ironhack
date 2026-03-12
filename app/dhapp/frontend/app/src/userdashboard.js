import React, { useState, useRef, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faUserPlus, faSearch, faTimes, faNoteSticky, faComments } from '@fortawesome/free-solid-svg-icons';
import { faUserInjured, faUser, faBrain,faCalendarCheck,faCalendarAlt, faTools, faFileAlt,faStethoscope, faPrescriptionBottle, faDiagnoses, faFolderOpen, faPrescriptionBottleAlt, faUserMd } from "@fortawesome/free-solid-svg-icons";

import './App.css';
import './userdashboard.css';
import api from './api';
// Chat opens as popup via App.js; no inline widget here

const firstChar = (value) => {
  const t = String(value || '').trim();
  if (!t) return '';
  return Array.from(t)[0] || '';
};

const splitTokens = (value) =>
  String(value || '')
    .trim()
    .split(/[\s._-]+/g)
    .map((s) => s.trim())
    .filter(Boolean);

function resolveDisplayName(user) {
  const first = String(user?.vorname || '').trim();
  const last = String(user?.nachname || '').trim();
  if (first || last) return `${first} ${last}`.trim();

  const named = String(user?.displayName || user?.name || '').trim();
  if (named) return named;

  const username = String(user?.username || '').trim();
  if (username) return username;

  const email = String(user?.email || '').trim();
  if (email) return email.split('@')[0] || email;

  return 'User';
}

function resolveInitials(user) {
  const first = String(user?.vorname || '').trim();
  const last = String(user?.nachname || '').trim();
  if (first || last) return `${firstChar(first)}${firstChar(last)}`.toUpperCase() || 'U';

  const usernameTokens = splitTokens(user?.username);
  if (usernameTokens.length >= 2) {
    return `${firstChar(usernameTokens[0])}${firstChar(usernameTokens[usernameTokens.length - 1])}`.toUpperCase();
  }
  if (usernameTokens.length === 1) {
    const chars = Array.from(usernameTokens[0]).slice(0, 2).join('');
    if (chars) return chars.toUpperCase();
  }

  const nameTokens = splitTokens(user?.displayName || user?.name);
  if (nameTokens.length >= 2) {
    return `${firstChar(nameTokens[0])}${firstChar(nameTokens[nameTokens.length - 1])}`.toUpperCase();
  }
  if (nameTokens.length === 1) {
    const chars = Array.from(nameTokens[0]).slice(0, 2).join('');
    if (chars) return chars.toUpperCase();
  }

  const emailTokens = splitTokens(String(user?.email || '').split('@')[0] || '');
  if (emailTokens.length >= 2) {
    return `${firstChar(emailTokens[0])}${firstChar(emailTokens[emailTokens.length - 1])}`.toUpperCase();
  }
  if (emailTokens.length === 1) {
    const chars = Array.from(emailTokens[0]).slice(0, 2).join('');
    if (chars) return chars.toUpperCase();
  }

  return 'U';
}




function ChatButton({ count = 0, onClick }) {
  return (
    <button onClick={onClick} style={{ position: 'relative' }} title="Chat">
      <FontAwesomeIcon icon={faComments} className="floating-text" />
      {count > 0 && (
        <span
          style={{
            position: 'absolute', top: -4, right: -4,
            background: '#ef4444', color: '#fff',
            minWidth: 18, height: 18, borderRadius: 999,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, padding: '0 5px', fontWeight: 700,
            boxShadow: '0 0 0 2px #f8f9fa'
          }}
        >{count}</span>
      )}
    </button>
  );
}

function RoomsButton({ count = 0, onClick }) {
  return (
    <button onClick={onClick} style={{ position: 'relative' }} title="Räume">
      <FontAwesomeIcon icon={faStethoscope} className="floating-text" />
      {count > 0 && (
        <span
          style={{
            position: 'absolute', top: -4, right: -4,
            background: '#10b981', color: '#fff',
            minWidth: 18, height: 18, borderRadius: 999,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, padding: '0 5px', fontWeight: 700,
            boxShadow: '0 0 0 2px #f8f9fa'
          }}
        >{count}</span>
      )}
    </button>
  );
}

function UserProfileDropdown({ user, onLogout, onOpenSOPs, onOpenNotes, onOpenJourney, onOpenWaitingRoom, onOpenAutomationSettings, onOpenBillingSettings, onOpenChat, onOpenRooms, onOpenDoctors, unreadChat = 0 }) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef(null);
  const [chatBadge, setChatBadge] = useState(Number(unreadChat)||0);
  const [roomsBadge, setRoomsBadge] = useState(0);
  const [myBookingsToday, setMyBookingsToday] = useState([]);

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    // Wenn neue Unreads eintreffen (höher als vorher), Badge erhöhen
    const next = Number(unreadChat)||0;
    setChatBadge((prev) => (next > prev ? next : prev));
  }, [unreadChat]);

  // Load today's bookings for me when dropdown opens
  useEffect(() => {
    const load = async () => {
      try {
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0,0,0);
        const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23,59,59);
        const { data } = await api.get(`/api/bookings?doctorId=me&from=${encodeURIComponent(start.toISOString())}&to=${encodeURIComponent(end.toISOString())}`);
        const items = Array.isArray(data?.items) ? data.items : [];
        setMyBookingsToday(items);
        // show upcoming count (now -> end of day)
        const upcoming = items.filter(x => new Date(x.end_time) > now);
        setRoomsBadge(upcoming.length);
      } catch (_) {
        setMyBookingsToday([]); setRoomsBadge(0);
      }
    };
    if (open) load();
  }, [open]);

  // DM Nutzerliste und UI sind im Chat-Popup integriert

  const displayName = resolveDisplayName(user);
  const roleLabel = String(user?.rolle || user?.role || '').trim();
  const description = String(user?.beschreibung || '').trim();
  const email = String(user?.email || '').trim();
  const initials = resolveInitials(user);

  return (

    <div className="user-profile-sidebar" ref={dropdownRef}>
      <div
        className="user-avatar-circle"
        onClick={() => setOpen(!open)}
        title={displayName}
      >
        {initials}
      </div>

      {open && (
        <div className="dropdown-menu">

          <h1>{displayName}</h1>
          
          <label>{description}</label>
          <label>{email}</label>
          <label></label>
          <hr></hr>
          {onOpenAutomationSettings ? (
            <button onClick={() => { setOpen(false); onOpenAutomationSettings(); }}>
              <FontAwesomeIcon icon={faTools} /> Automation
            </button>
          ) : null}
          {onOpenBillingSettings ? (
            <button onClick={() => { setOpen(false); onOpenBillingSettings(); }}>
              <FontAwesomeIcon icon={faTools} /> Abrechnung (Punktwert)
            </button>
          ) : null}
          <button onClick={onLogout}>
      <FontAwesomeIcon icon={faTimes} />  Abmelden 
    </button>
          

        </div>
      )}
      <label>{roleLabel}</label>
      <hr></hr>

     

      <div className="user-tools">
        <button title="Suche"><FontAwesomeIcon icon={faSearch} className="floating-text" /></button>
        {onOpenSOPs ? (
          <button onClick={onOpenSOPs} title="SOPs"><FontAwesomeIcon icon={faFileAlt} className="floating-text" /></button>
        ) : null}
        {onOpenNotes ? (
          <button onClick={onOpenNotes} title="Notizen"><FontAwesomeIcon icon={faNoteSticky} className="floating-text" /></button>
        ) : null}
        {onOpenDoctors ? (
          <button onClick={onOpenDoctors} title="Ärzte-Verzeichnis"><FontAwesomeIcon icon={faUserMd} className="floating-text" /></button>
        ) : null}
        {onOpenWaitingRoom ? (
          <button onClick={onOpenWaitingRoom} title="Wartezimmer"><FontAwesomeIcon icon={faUserInjured} className="floating-text" /></button>
        ) : null}
        {onOpenJourney ? (
          <button onClick={onOpenJourney} title="Patienten‑Journey"><FontAwesomeIcon icon={faDiagnoses} className="floating-text" /></button>
        ) : null}
        {onOpenChat ? (
          <ChatButton count={Number(chatBadge)||0} onClick={() => { setChatBadge(0); onOpenChat && onOpenChat(); }} />
        ) : null}
      </div>
      <hr />

      {/* Compact list of today's bookings */}
      {open && (
        <div style={{ fontSize: 13 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Meine heutigen Raum‑Buchungen</div>
          {myBookingsToday.length === 0 ? (
            <div style={{ color: '#6b7280' }}>Keine Buchungen für heute</div>
          ) : (
            myBookingsToday.slice(0,5).map((b) => (
              <div key={b.id} style={{ display:'flex', justifyContent:'space-between', gap:8, padding:'4px 0', borderBottom:'1px dashed #e5e7eb' }}>
                <div>
                  <strong>{new Date(b.start_time).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })}</strong>
                  {b.vorname || b.nachname ? <> · {b.vorname||''} {b.nachname||''}</> : null}
                </div>
                <div>{b.status || 'GEPLANT'}</div>
              </div>
            ))
          )}
          {myBookingsToday.length > 5 && (
            <div style={{ textAlign:'right' }}>
              <button className="btn-save" onClick={() => onOpenRooms && onOpenRooms()}>Mehr…</button>
            </div>
          )}
        </div>
      )}

    </div>
  );
}

export default UserProfileDropdown;
