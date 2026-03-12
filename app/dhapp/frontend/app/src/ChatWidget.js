import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api, { getChatTyping, sendChatTyping, markChatRead, sendChatMessage, getChatMessages } from './api';
import { sanitizeRichTextToPlainText, splitTextByMentions } from './utils/textSanitizer';

export default function ChatWidget({ title = 'Klinik‑Chat', onUnreadCleared, channelId: forcedChannelId = null, allowedMentionUsers: forcedMentions = null }) {
  const SHOW_CHAT_NOTIFICATION_PREVIEW =
    String(process.env.REACT_APP_CHAT_NOTIFICATION_PREVIEW || '').toLowerCase() === 'true';
  const [channelId, setChannelId] = useState(forcedChannelId || null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const endRef = useRef(null);
  const [me, setMe] = useState(null);
  const [mentionUsers, setMentionUsers] = useState([]);
  const [showEmoji, setShowEmoji] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [suggestIndex, setSuggestIndex] = useState(0);
  const inputRef = useRef(null);
  const lastMessageIdRef = useRef(null);
  const [collapsed, setCollapsed] = useState(true);
  const [unread, setUnread] = useState(0);
  const [lastIncoming, setLastIncoming] = useState(null);
  const lastUnreadRef = useRef(0);

  const ensureChannel = async () => {
    try {
      if (forcedChannelId) { setChannelId(forcedChannelId); return; }
      const { data } = await api.get('/api/chat/channels');
      const items = data?.items || [];
      const global = items.find(c => String(c.type).toUpperCase() === 'GLOBAL') || items[0];
      if (global) setChannelId(global.id);
    } catch (e) {
      setError(e?.message || 'Chat nicht verfügbar');
    }
  };
  const loadMessages = async (id) => {
    if (!id) return;
    try {
      const list = await getChatMessages(id, { limit: 200 });
      setMessages(list);
      setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    } catch (e) {
      setError(e?.message || 'Nachrichten konnten nicht geladen werden');
    }
  };

  useEffect(() => { ensureChannel(); }, []);
  useEffect(() => { if (!collapsed) loadMessages(channelId); /* eslint-disable-next-line */ }, [channelId, collapsed]);

  // Auto-refresh every 10s
  useEffect(() => {
    if (!channelId || collapsed) return;
    const t = setInterval(() => loadMessages(channelId), 10000);
    return () => clearInterval(t);
  }, [channelId, collapsed]);

  const send = async () => {
    const content = text.trim();
    if (!channelId || !content) return;
    try {
      await sendChatMessage(channelId, content);
      setText('');
      await loadMessages(channelId);
    } catch (e) {
      alert(e?.response?.data?.message || e?.message || 'Senden fehlgeschlagen');
    }
  };

  // Session + users for mentions
  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get('/api/session');
        setMe(data?.user || null);
      } catch {}
      try {
        if (forcedMentions && Array.isArray(forcedMentions)) {
          setMentionUsers(forcedMentions.map(u => ({ id: u.id, username: u.username, display: u.display || u.username || u.email || `User ${u.id}`, email: u.email })));
        } else {
          const res = await api.get('/api/users/accessible');
          const items = (res?.data?.items || []).map(u => ({ id: u.id, username: u.username || (u.email ? u.email.split('@')[0] : null), display: u.name || u.username || u.email || `User ${u.id}`, email: u.email || null }));
          setMentionUsers(items);
        }
      } catch {}
    })();
  }, [forcedMentions]);

  // Mark messages as read when loaded (only when expanded)
  useEffect(() => {
    (async () => {
      if (collapsed || !messages.length || !me?.id) return;
      for (const m of messages) {
        if (m.author_user_id && m.author_user_id !== me.id) {
          try { await markChatRead(m.id); } catch {}
        }
      }
      try { setUnread(0); onUnreadCleared && onUnreadCleared(); } catch {}
    })();
  }, [messages, me?.id, collapsed]);

  const notifyIncoming = useCallback((last) => {
    if (!last || me?.id === last.author_user_id) return;
    const plainContent = sanitizeRichTextToPlainText(last.content || '', 120);
    setLastIncoming({
      id: last.id,
      author: last.author_name || '—',
      content: plainContent,
      at: last.created_at
    });
    try {
      if (window.Notification && window.Notification.permission === 'granted') {
        const body = SHOW_CHAT_NOTIFICATION_PREVIEW
          ? `${last.author_name || 'Unbekannt'}: ${plainContent.slice(0, 80)}`
          : 'Neue Nachricht im Klinik-Chat';
        new window.Notification('Neuer Chat-Beitrag', { body });
      }
    } catch {}
    try {
      // Simple beep for attention
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = 880; o.connect(g); g.connect(ctx.destination); o.start();
      setTimeout(() => { o.stop(); ctx.close(); }, 100);
    } catch {}
  }, [SHOW_CHAT_NOTIFICATION_PREVIEW, me?.id]);

  // Notifications for new messages
  useEffect(() => {
    try { if (window.Notification && window.Notification.permission === 'default') window.Notification.requestPermission(); } catch {}
  }, []);
  useEffect(() => {
    if (!messages.length) return;
    const last = messages[messages.length - 1];
    const prevId = lastMessageIdRef.current;
    lastMessageIdRef.current = last.id;
    if (prevId && last.id !== prevId && me?.id && last.author_user_id !== me.id) {
      notifyIncoming(last);
    }
  }, [messages, me?.id, notifyIncoming, channelId, forcedChannelId]);

  // typing heartbeat while typing
  useEffect(() => {
    if (!channelId || collapsed) return;
    const t = setInterval(() => { sendChatTyping(channelId); }, 4000);
    return () => clearInterval(t);
  }, [channelId, text, collapsed]);

  const [typingUsers, setTypingUsers] = useState([]);
  useEffect(() => {
    if (!channelId || collapsed) return;
    let active = true;
    const poll = async () => {
      try { const users = await getChatTyping(channelId); if (active) setTypingUsers(users); } catch {}
    };
    const t = setInterval(poll, 3000); poll();
    return () => { active = false; clearInterval(t); };
  }, [channelId, collapsed]);

  // Unread counter polling (even when collapsed)
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        if (!channelId && !forcedChannelId) return;
        const { getChatUnreadCount } = await import('./api');
        const c = await getChatUnreadCount(channelId || forcedChannelId || undefined);
        const nextCount = Number(c) || 0;
        if (!alive) return;
        setUnread(nextCount);
        const prev = Number(lastUnreadRef.current || 0);
        if (nextCount > prev && (channelId || forcedChannelId)) {
          try {
            const list = await getChatMessages(channelId || forcedChannelId, { limit: 1 });
            const last = list?.[list.length - 1];
            if (last && last.id !== lastMessageIdRef.current) {
              lastMessageIdRef.current = last.id;
              notifyIncoming(last);
            }
          } catch {}
        }
        lastUnreadRef.current = nextCount;
      } catch {}
    };
    tick();
    const t = setInterval(tick, 2000);
    return () => { alive = false; clearInterval(t); };
  }, [channelId, forcedChannelId, notifyIncoming]);

  // Emoji picker
  const EMOJIS = useMemo(() => ['😀','😁','😂','🤣','😊','😍','😘','😎','🤔','🙌','👍','👎','🙏','🎉','🔥','💯','💊','🩺','🏥','📞','🕒','✅','❗'], []);
  const insertAtCursor = (str) => {
    const el = inputRef.current;
    if (!el) { setText((t) => (t + str)); return; }
    const start = el.selectionStart || text.length;
    const end = el.selectionEnd || text.length;
    const before = text.slice(0, start);
    const after = text.slice(end);
    const next = before + str + after;
    setText(next);
    setTimeout(() => { const pos = start + str.length; el.setSelectionRange(pos, pos); el.focus(); }, 0);
  };

  // Mention suggestions
  useEffect(() => {
    const match = /(^|\s)@([A-Za-z0-9_.-]{0,32})$/.exec(text.slice(0, (inputRef.current?.selectionStart || text.length)));
    if (!match) { setSuggestions([]); setSuggestIndex(0); return; }
    const q = match[2].toLowerCase();
    const candidates = mentionUsers.filter(u => (u.username && u.username.toLowerCase().startsWith(q)) || (u.email && u.email.toLowerCase().startsWith(q))).slice(0,8);
    setSuggestions(candidates);
    setSuggestIndex(0);
  }, [text, mentionUsers]);

  const applySuggestion = (user) => {
    const el = inputRef.current;
    const caret = el ? el.selectionStart : text.length;
    const upto = text.slice(0, caret);
    const rest = text.slice(caret);
    const replaced = upto.replace(/@([A-Za-z0-9_.-]{0,32})$/, `@${user.username || user.email || ('user'+user.id)}`);
    const next = replaced + ' ' + rest;
    setText(next);
    setSuggestions([]);
    setTimeout(() => el && el.focus(), 0);
  };

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, display: 'flex', flexDirection: 'column', minHeight: collapsed ? 'auto' : 280, maxHeight: collapsed ? 'auto' : '70vh' }}>
      <div style={{ padding: 8, borderBottom: '1px solid #e5e7eb', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }} onClick={async () => {
        const willOpen = collapsed;
        setCollapsed(!collapsed);
        if (willOpen) {
          await ensureChannel();
          await loadMessages(channelId || undefined);
        }
      }}>
        <span>{title}</span>
        {unread > 0 && (
          <span style={{ background: '#ef4444', color: '#fff', minWidth: 18, height: 18, padding: '0 6px', borderRadius: 999, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}> {unread} </span>
        )}
      </div>
      {error && <div style={{ color: 'crimson', padding: 8 }}>{error}</div>}
      {!collapsed && lastIncoming && unread > 0 && (
        <div style={{ padding: 8, background: '#fef3c7', color: '#92400e', borderBottom: '1px solid #fde68a' }}>
          <div style={{ fontWeight: 700 }}>Neue Nachricht von {lastIncoming.author}</div>
          <div style={{ fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{lastIncoming.content}</div>
        </div>
      )}
      {!collapsed && (
      <div style={{ flex: 1, overflowY: 'auto', padding: 8, minHeight: 0 }}>
        {messages.map(m => (
          <div key={m.id} style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 12, color: '#6b7280' }}>{m.author_name || '—'} · {new Date(m.created_at).toLocaleString('de-CH')}</div>
            <div>
              {splitTextByMentions(m.content).map((part, idx) => (
                part.isMention ? (
                  <span key={`${m.id}:${idx}`} style={{ background: '#fef3c7', color: '#92400e', padding: '0 4px', borderRadius: 4 }}>
                    {part.text}
                  </span>
                ) : (
                  <React.Fragment key={`${m.id}:${idx}`}>{part.text}</React.Fragment>
                )
              ))}
            </div>
          </div>
        ))}
        <div ref={endRef} />
        {typingUsers.length > 0 && (
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 8 }}>
            {typingUsers.map(u => u.name).join(', ')} {typingUsers.length === 1 ? 'schreibt…' : 'schreiben…'}
          </div>
        )}
      </div>
      )}
      {!collapsed && (
      <div style={{ display: 'flex', gap: 6, padding: 8, borderTop: '1px solid #e5e7eb', position: 'relative' }}>
        <button className="btn-save" onClick={() => setShowEmoji((v)=>!v)} title="Emoji">🙂</button>
        {showEmoji && (
          <div style={{ position: 'absolute', bottom: '48px', left: 8, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 8, display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 6, zIndex: 10 }}>
            {EMOJIS.map(e => (
              <button key={e} onClick={() => { insertAtCursor(e); setShowEmoji(false); }} style={{ fontSize: 18, lineHeight: '24px' }}>{e}</button>
            ))}
          </div>
        )}
        <input ref={inputRef} type="text" value={text}
               onChange={(e) => setText(e.target.value)}
               onKeyDown={(e) => {
                 if (e.key === 'Enter' && !suggestions.length) { e.preventDefault(); send(); return; }
                 if (suggestions.length) {
                   if (e.key === 'ArrowDown') { e.preventDefault(); setSuggestIndex((i)=>Math.min(i+1, suggestions.length-1)); }
                   if (e.key === 'ArrowUp') { e.preventDefault(); setSuggestIndex((i)=>Math.max(i-1, 0)); }
                   if (e.key === 'Tab' || e.key === 'Enter') { e.preventDefault(); applySuggestion(suggestions[suggestIndex]); }
                 }
               }}
               placeholder="Nachricht… (@username für Erwähnung)" style={{ flex: 1 }} />
        <button className="btn-save" onClick={send}>Senden</button>
        {suggestions.length > 0 && (
          <div style={{ position: 'absolute', bottom: '48px', left: 52, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, padding: 6, width: 260, maxHeight: 200, overflowY: 'auto', zIndex: 11 }}>
            {suggestions.map((u, idx) => (
              <div key={u.id} onMouseDown={(e) => { e.preventDefault(); applySuggestion(u); }}
                   style={{ padding: '4px 6px', cursor: 'pointer', background: idx===suggestIndex ? '#eef2ff' : 'transparent' }}>
                @{u.username || u.email || ('user'+u.id)} · <span style={{ color: '#6b7280' }}>{u.display}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      )}
    </div>
  );
}
