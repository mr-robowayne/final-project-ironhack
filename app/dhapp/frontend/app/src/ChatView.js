import React, { useEffect, useState, useRef } from 'react';
import api, { startDM, markChatRead, listDMs, getChatUnreadCount } from './api';

export default function ChatView({ onClose }) {
  const [channels, setChannels] = useState([]);
  const [active, setActive] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const endRef = useRef(null);
  const [me, setMe] = useState(null);
  const [users, setUsers] = useState([]);
  const [dmList, setDmList] = useState([]);
  const [activeDmUser, setActiveDmUser] = useState(null);
  const [showDmPicker, setShowDmPicker] = useState(false);
  const [dmSearch, setDmSearch] = useState('');
  const [unreadByChannel, setUnreadByChannel] = useState({});
  const [lastUnreadChannel, setLastUnreadChannel] = useState(null);
  const lastUnreadSnapshot = useRef({});

  const loadChannels = async () => {
    try { const { data } = await api.get('/api/chat/channels'); setChannels(data?.items || []); if (!active && data?.items?.length) setActive(data.items[0].id); } catch (e) { setError(e?.message || 'Kanäle konnten nicht geladen werden'); }
  };
  const loadMessages = async (channelId) => {
    if (!channelId) return;
    try {
      const { data } = await api.get(`/api/chat/messages?channelId=${encodeURIComponent(channelId)}`);
      const list = data?.items || [];
      setMessages(list);
      // mark read for foreign messages
      if (me?.id) {
        for (const m of list) { if (m.author_user_id && m.author_user_id !== me.id) { try { await markChatRead(m.id); } catch {} } }
      }
      setUnreadByChannel((prev) => ({ ...prev, [channelId]: 0 }));
      setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    } catch (e) { setError(e?.message || 'Nachrichten konnten nicht geladen werden'); }
  };
  useEffect(() => { loadChannels(); /* eslint-disable-next-line */ }, []);
  useEffect(() => { loadMessages(active); /* eslint-disable-next-line */ }, [active]);

  useEffect(() => { (async () => { try { const { data } = await api.get('/api/session'); setMe(data?.user || null); } catch {} })(); }, []);
  // Eigene DMs laden (nur meine, serverseitig gefiltert)
  const loadDMs = async () => {
    try {
      const list = await listDMs();
      const arr = Array.isArray(list) ? list : [];
      // Sicherstellen: Pro Gegenüber nur EIN Eintrag, selbst wenn historisch mehrere Channels existieren
      const seen = new Set();
      const dedup = [];
      for (const dm of arr) {
        const key = dm && dm.other_user_id != null ? String(dm.other_user_id) : null;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        dedup.push(dm);
      }
      setDmList(dedup);
    } catch {}
  };
  useEffect(() => { loadDMs(); }, []);
  useEffect(() => { (async () => { try { const res = await api.get('/api/users/accessible'); setUsers(res?.data?.items || []); } catch {} })(); }, []);

  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => { loadMessages(active); }, 5000);
    return () => clearInterval(t);
  }, [active]);

  useEffect(() => {
    let stop = false;
    const refreshUnread = async () => {
      const ids = Array.from(new Set([
        ...(channels || []).map((c) => c.id).filter(Boolean),
        ...(dmList || []).map((dm) => dm.channel_id).filter(Boolean)
      ]));
      if (!ids.length) return;
      try {
        const entries = await Promise.all(ids.map(async (id) => {
          try { const c = await getChatUnreadCount(id); return [id, Number(c) || 0]; }
          catch { return [id, lastUnreadSnapshot.current[id] || 0]; }
        }));
        if (!stop) {
          setUnreadByChannel((prev) => {
            const next = { ...prev };
            let newest = lastUnreadChannel;
            for (const [id, cnt] of entries) {
              const prevCnt = prev[id] || 0;
              next[id] = cnt;
              if (cnt > prevCnt) newest = id;
            }
            if (newest && newest !== lastUnreadChannel) setLastUnreadChannel(newest);
            lastUnreadSnapshot.current = next;
            return next;
          });
        }
      } catch {}
    };
    refreshUnread();
    const t = setInterval(refreshUnread, 2000);
    return () => { stop = true; clearInterval(t); };
  }, [channels, dmList, lastUnreadChannel]);

  const send = async () => {
    const content = text.trim();
    if (!active || !content) return;
    try {
      await api.post('/api/chat/messages', { channel_id: active, content });
      setText('');
      await loadMessages(active);
    } catch (e) { alert(e?.response?.data?.message || e?.message || 'Senden fehlgeschlagen'); }
  };

  return (
    <div className="popup-overlay">
      <div className="popup-container wide-popup" style={{ maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 className="h2" style={{ margin: 0 }}>💬 Interner Chat</h2>
          <button className="btn-cancel" onClick={() => onClose?.()} title="Schließen" type="button">❌</button>
        </div>
        <hr />
        {error && <div style={{ color: 'crimson' }}>{error}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 12, minHeight: 360, flex: 1, overflow: 'hidden' }}>
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ padding: 8, borderBottom: '1px solid #e5e7eb', fontWeight: 600 }}>Kanal</div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {(() => {
                const globals = (channels||[]).filter(c => String(c.type).toUpperCase() !== 'DM');
                const allgemeine = globals.find(c => (c.name||'').toLowerCase() === 'allgemein') || globals[0];
                return allgemeine ? (
                  <div key={allgemeine.id} onClick={() => { setActive(allgemeine.id); setActiveDmUser(null); }} style={{ padding: 8, cursor: 'pointer', background: active===allgemeine.id ? '#eef2ff' : 'transparent', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      {allgemeine.name} <span style={{ color: '#6b7280', fontSize: 12 }}>({allgemeine.type})</span>
                    </div>
                    {Number(unreadByChannel[allgemeine.id]||0) > 0 && (
                      <span style={{ background: '#ef4444', color: '#fff', minWidth: 18, height: 18, padding: '0 6px', borderRadius: 999, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>
                        {unreadByChannel[allgemeine.id]}
                      </span>
                    )}
                  </div>
                ) : (
                  <div style={{ padding: 8, color: '#6b7280' }}>Kein allgemeiner Kanal</div>
                );
              })()}
            </div>
            <div style={{ padding: 8, borderTop: '1px solid #e5e7eb', fontWeight: 600 }}>Privat</div>
            <div style={{ maxHeight: 220, overflowY: 'auto' }}>
              {dmList.length === 0 && <div style={{ padding: 8, color: '#6b7280' }}>Keine Privat‑Chats</div>}
              {dmList.map(dm => {
                const title = dm.other_name || `User ${dm.other_user_id}`;
                const initials = String(title).split(' ').map(p=>p[0]).join('').slice(0,2).toUpperCase() || 'U';
                const palette = ['#60a5fa','#34d399','#f472b6','#f59e0b','#a78bfa','#22d3ee','#ef4444','#10b981','#f97316','#e879f9'];
                const key = String(dm.other_user_id || title);
                let h = 0; for (let i=0;i<key.length;i++) h = (h*31 + key.charCodeAt(i)) >>> 0;
                const color = palette[h % palette.length];
                const unread = Number(unreadByChannel[dm.channel_id] || 0);
                return (
                  <div key={dm.channel_id} onClick={() => { setActive(dm.channel_id); setActiveDmUser({ id: dm.other_user_id, name: dm.other_name }); }}
                       style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 8, cursor: 'pointer', background: active===dm.channel_id ? '#eef2ff' : (unread ? '#fff7ed' : 'transparent'), borderBottom: '1px solid #f3f4f6' }}>
                    <div style={{ width: 24, height: 24, borderRadius: 999, background: color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 12 }}>{initials}</div>
                    <div style={{ fontSize: 14, flex: 1 }}>{title}</div>
                    {unread > 0 && (
                      <span style={{ background: '#ef4444', color: '#fff', minWidth: 18, height: 18, padding: '0 6px', borderRadius: 999, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>
                        {unread}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            <div style={{ padding: 8, borderTop: '1px solid #e5e7eb' }}>
              <button className="btn-save" onClick={() => setShowDmPicker(true)}>+ Neuer Privat‑Chat</button>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', border: '1px solid #e5e7eb', borderRadius: 8, minHeight: 0, maxHeight: '80vh' }}>
            {lastUnreadChannel && lastUnreadChannel !== active && (
              <div style={{ padding: 8, background: '#fef3c7', color: '#92400e', borderBottom: '1px solid #fde68a' }}>
                Neue Nachricht in&nbsp;
                {(() => {
                  const ch = channels.find(c => c.id === lastUnreadChannel);
                  if (ch) return ch.name;
                  const dm = dmList.find(d => d.channel_id === lastUnreadChannel);
                  return dm ? (dm.other_name || `User ${dm.other_user_id}`) : `Kanal ${lastUnreadChannel}`;
                })()}
              </div>
            )}
            <div style={{ padding: 8, borderBottom: '1px solid #e5e7eb', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
              {(() => {
                const ch = channels.find(c => c.id === active);
                const label = ch ? ch.name : (activeDmUser ? `Privat: ${activeDmUser.name || activeDmUser.username || activeDmUser.email || '—'}` : '—');
                const unread = Number(unreadByChannel[active] || 0);
                return (
                  <>
                    <span>{label}</span>
                    {unread > 0 && (
                      <span style={{ background: '#ef4444', color: '#fff', minWidth: 18, height: 18, padding: '0 6px', borderRadius: 999, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>
                        {unread}
                      </span>
                    )}
                  </>
                );
              })()}
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 8, minHeight: 0 }}>
              {messages.map(m => (
                <div key={m.id} style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>{m.author_name || '—'} · {new Date(m.created_at).toLocaleString('de-CH')}</div>
                  <div>{m.content}</div>
                </div>
              ))}
              <div ref={endRef} />
            </div>
            <div style={{ display: 'flex', gap: 6, padding: 8, borderTop: '1px solid #e5e7eb' }}>
              <input type="text" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') send(); }} placeholder="Nachricht… (@username für Erwähnung)" style={{ flex: 1 }} />
              <button className="btn-save" onClick={send}>Senden</button>
            </div>
          </div>
        </div>
      </div>
      {showDmPicker && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: 8, width: 420, maxWidth: '95vw', padding: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontWeight: 700 }}>Privat‑Chat starten</div>
              <button className="btn-cancel" onClick={() => setShowDmPicker(false)}>✕</button>
            </div>
            <div style={{ marginTop: 8 }}>
              <input type="text" placeholder="Benutzer suchen…" value={dmSearch} onChange={(e) => setDmSearch(e.target.value)} style={{ width: '100%' }} />
            </div>
            <div style={{ marginTop: 8, maxHeight: 320, overflowY: 'auto' }}>
              {(users||[])
                .filter(u => Number(u.id) !== Number(me?.id))
                .filter(u => {
                  const q = dmSearch.trim().toLowerCase(); if (!q) return true;
                  const name = (u.name || '').toLowerCase(); const uname = (u.username || '').toLowerCase(); const email = (u.email || '').toLowerCase();
                  return name.includes(q) || uname.includes(q) || email.includes(q);
                })
                .map(u => {
                  const initials = `${(u.name||u.username||u.email||'').split(' ').map(p=>p[0]).join('').slice(0,2).toUpperCase()}` || 'U';
                  const palette = ['#60a5fa','#34d399','#f472b6','#f59e0b','#a78bfa','#22d3ee','#ef4444','#10b981','#f97316','#e879f9'];
                  const key = String(u.id || u.username || u.email || '0');
                  let h = 0; for (let i=0;i<key.length;i++) h = (h*31 + key.charCodeAt(i)) >>> 0;
                  const color = palette[h % palette.length];
                  return (
                    <div
                      key={u.id}
                      onClick={async () => {
                        try {
                          // Wenn bereits ein DM mit diesem Benutzer existiert, nur wechseln – keinen neuen Channel anlegen
                          const existing = dmList.find(dm => Number(dm.other_user_id) === Number(u.id));
                          if (existing) {
                            setActive(existing.channel_id);
                            setActiveDmUser({ id: u.id, name: u.name, username: u.username, email: u.email });
                            setShowDmPicker(false);
                            return;
                          }
                          const res = await startDM(Number(u.id));
                          setActive(res?.channel_id);
                          setActiveDmUser({ id: u.id, name: u.name, username: u.username, email: u.email });
                          await loadDMs();
                          setShowDmPicker(false);
                        } catch (e) {
                          alert(e?.response?.data?.message || e?.message || 'DM konnte nicht gestartet werden');
                        }
                      }}
                         style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 8, cursor: 'pointer', borderBottom: '1px solid #f3f4f6' }}>
                      <div style={{ width: 28, height: 28, borderRadius: 999, background: color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>{initials}</div>
                      <div>
                        <div style={{ fontWeight: 600 }}>{u.name || u.username || u.email}</div>
                        <div style={{ fontSize: 12, color: '#6b7280' }}>{u.email || u.username || ''}</div>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
