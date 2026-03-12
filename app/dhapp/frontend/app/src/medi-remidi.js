// src/medi-remidi.js
import './ModernCalendar.css';
import './medi-remidi.css';
import './medi-remidi.override.css';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import api, { getTenantId } from './api';

function useDebounced(value, delay = 250) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), delay); return () => clearTimeout(t); }, [value, delay]);
  return v;
}

function SearchBar({ value, onChange, onSubmit, loading, ariaLabel = 'Medikamente suchen' }) {
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  return (
    <form className="meds-searchbar" role="search" aria-label={ariaLabel} onSubmit={(e) => { e.preventDefault(); onSubmit?.(); }}>
      <input
        ref={inputRef}
        className="meds-input"
        type="search"
        value={value}
        placeholder="Suche nach Name, ATC, Wirkstoff"
        aria-autocomplete="list"
        aria-controls="meds-results"
        onChange={(e) => onChange(e.target.value)}
      />
      <button className="btn" type="submit" aria-label="Suchen" disabled={loading}>{loading ? '…' : 'Suchen'}</button>
    </form>
  );
}

function ResultsList({ items, onSelect, activeId }) {
  return (
    <ul id="meds-results" role="listbox" className="meds-results">
      {items.map(m => (
        <li
          key={m.id}
          role="option"
          aria-selected={activeId === m.id}
          tabIndex={0}
          onClick={() => onSelect(m)}
          onKeyDown={(e) => { if (e.key === 'Enter') onSelect(m); }}
          className={activeId === m.id ? 'active' : ''}
        >
          <div className="meds-res-title">{m.name}</div>
          <div className="meds-res-meta">{[m.manufacturer, m.atc_code].filter(Boolean).join(' · ')}</div>
        </li>
      ))}
      {!items.length && <li className="empty"></li>}
    </ul>
  );
}

function ModeToggle({ mode, onChange }) {
  return (
    <div className="mode-toggle" role="tablist" aria-label="Ansicht wählen">
      <button
        role="tab"
        aria-selected={mode === 'search'}
        className={`toggle-btn ${mode === 'search' ? 'active' : ''}`}
        onClick={() => onChange('search')}
      >
        Medikamente suchen
      </button>
      <button
        role="tab"
        aria-selected={mode === 'ai'}
        className={`toggle-btn ${mode === 'ai' ? 'active' : ''}`}
        onClick={() => onChange('ai')}
      >
        AI Suche
      </button>
    </div>
  );
}

function LabeledRow({ label, children }) {
  return (
    <div className="row">
      <div className="label">{label}</div>
      <div className="value">{children || '—'}</div>
    </div>
  );
}

function TextList({ text }) {
  if (!text) return <>—</>;
  const parts = String(text)
    .split(/\n|;|\./)
    .map((p) => p.trim())
    .filter((p) => p.length);
  if (parts.length <= 1) return <>{text}</>;
  return (
    <ul className="meds-list">
      {parts.map((p, idx) => <li key={idx}>{p}</li>)}
    </ul>
  );
}

function MedDetails({ item }) {
  if (!item) return <div className="meds-details empty"></div>;
  const arr = (a) => Array.isArray(a) ? a.join(', ') : (a || '—');
  return (
    <div className="meds-details">
      <div style={{ marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ fontSize: 18, fontWeight: 800 }}>{item.name}</div>
        <div style={{ color: '#475569', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {item.manufacturer ? <span>{item.manufacturer}</span> : null}
          {item.atc_code ? <span>ATC {item.atc_code}</span> : null}
          {item.approved_status ? <span>Status: {item.approved_status}</span> : null}
        </div>
      </div>
      <div className="grid">
        <section>
          <h3>Produkt-Stammdaten</h3>
          <LabeledRow label="Name">{item.name}</LabeledRow>
          <LabeledRow label="Hersteller">{item.manufacturer}</LabeledRow>
          <LabeledRow label="ATC-Code">{item.atc_code}</LabeledRow>
          <LabeledRow label="Wirkstoffe">{arr(item.active_substances)}</LabeledRow>
          <LabeledRow label="Formen">{arr(item.forms)}</LabeledRow>
          <LabeledRow label="Status">{item.approved_status}</LabeledRow>
          <LabeledRow label="Packungsbeilage">{
            item.leaflet_local
              ? <a href={item.leaflet_local} target="_blank" rel="noreferrer">Link</a>
              : (item.leaflet_ref ? <a href={item.leaflet_ref} target="_blank" rel="noreferrer">Link</a> : '—')
          }</LabeledRow>
        </section>
        <section>
          <h3>Indikationen/Kontraindikationen</h3>
          <LabeledRow label="Indikationen"><TextList text={item.indications} /></LabeledRow>
          <LabeledRow label="Kontraindikationen"><TextList text={item.contraindications} /></LabeledRow>
        </section>
        <section>
          <h3>Dosierung/Anwendung/Warnungen</h3>
          <LabeledRow label="Warnhinweise"><TextList text={item.warnings} /></LabeledRow>
          <LabeledRow label="Schwangerschaft/Stillzeit"><TextList text={item.pregnancy} /></LabeledRow>
          <LabeledRow label="Allergen-Hinweise"><TextList text={item.allergens} /></LabeledRow>
        </section>
        <section>
          <h3>Neben- & Wechselwirkungen</h3>
          <LabeledRow label="Nebenwirkungen"><TextList text={item.side_effects} /></LabeledRow>
          <LabeledRow label="Wechselwirkungen"><TextList text={item.interactions} /></LabeledRow>
        </section>
      </div>
    </div>
  );
}

function ChatPanel({ tenantId, contextSelection, variant = 'default' }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [aiStatus, setAiStatus] = useState({ ok: false, openaiConfigured: false, model: null });
  const [focus, setFocus] = useState(null); // { prepId, brandName } | null
  const chatBodyRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    let stop = false;
    const run = async () => {
      try {
        const res = await api.get('/api/ai/status');
        const g = res?.data?.gateway || {};
        if (!stop) setAiStatus({ ok: !!g.ok, openaiConfigured: !!g.openaiConfigured, model: g.model || null });
      } catch {
        if (!stop) setAiStatus({ ok: false, openaiConfigured: false, model: null });
      }
    };
    run();
    const t = setInterval(run, 10000);
    return () => { stop = true; clearInterval(t); };
  }, []);

  useEffect(() => {
    if (contextSelection?.id) {
      setFocus({ prepId: contextSelection.id, brandName: contextSelection.name || null });
    }
  }, [contextSelection?.id]);

  const buildHistoryPayload = (arr) => {
    const out = [];
    for (const m of (Array.isArray(arr) ? arr : [])) {
      if (m?.role === 'user' && typeof m.content === 'string' && m.content.trim()) {
        out.push({ role: 'user', text: m.content.trim(), focusPrepId: focus?.prepId || undefined });
        continue;
      }
      if (m?.role === 'assistant' && m?.result) {
        const summary = String(m.result?.summary || '').trim();
        if (summary) out.push({ role: 'assistant', text: summary, focusPrepId: focus?.prepId || undefined });
      }
    }
    return out.slice(-8);
  };

  const send = async () => {
    const content = input.trim();
    if (!content) return;
    const pendingId = `pending_${Date.now()}`;
    const next = [...messages, { role: 'user', content }, { role: 'assistant', type: 'pending', id: pendingId }];
    setMessages(next); setInput(''); setSending(true);
    try {
      const history = buildHistoryPayload(next);
      const payload = {
        tenantId,
        question: content,
        selectedId: focus?.prepId || contextSelection?.id || null,
        maxItems: 4,
        maxEvidencePerItem: 4,
        history,
      };
      const res = await api.post('/api/meds-chat', payload);
      if (!res?.ok) throw new Error(res?.data?.message || 'Meds-Chat nicht verfügbar.');
      const result = res?.data || {};
      setMessages(next.map((m) => (m?.id === pendingId ? { role: 'assistant', content: result.summary || 'Antwort erstellt.', result } : m)));
    } catch (e) {
      setMessages(next.map((m) => (m?.id === pendingId ? { role: 'assistant', content: `Fehler: ${(e && e.message) || 'Unbekannt'}`, error: true } : m)));
    } finally {
      setSending(false);
    }
  };

  // Auto-scroll chat to bottom when new messages arrive
  useEffect(() => {
    const el = chatBodyRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  // Auto-grow textarea height up to CSS max-height
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 140) + 'px';
  }, [input]);

  const cls = variant === 'wide' ? 'meds-chat wide' : 'meds-chat';
  return (
    <aside
      className={cls}
      aria-label="Medikamente Chat"
      style={{ '--redmedi-watermark': "url(/assets/redmedi.png)" }}
    >
      <div className="chat-header" aria-label="Remedi – Assistant">
        <span className="brand-title">Remedi</span>
        <img
          src="/assets/redmedi.png"
          alt=""
          role="presentation"
          className="brand-icon"
          onError={(e)=>{
            const cur = e.currentTarget.getAttribute('src') || '';
            if (cur.includes('redmedi.png')) { e.currentTarget.setAttribute('src','/assets/ionilogo.jpg'); return; }
            if (cur.includes('ionilogo.jpg')) { e.currentTarget.setAttribute('src','/assets/logo.png'); return; }
            e.currentTarget.style.display='none';
          }}
        />
        <span className="brand-sub">– Assistant</span>
        <div className="chat-actions">
          <button
            type="button"
            className="btn btn-ghost btn-small"
            onClick={() => { setMessages([]); setInput(''); }}
            title="Chatverlauf im Browser zurücksetzen (wird nicht serverseitig gespeichert)"
            disabled={sending}
          >
            Neuer Chat
          </button>
        </div>
      </div>
      <div className={`chat-indicator ${(!aiStatus.ok || sending) ? '' : 'ok'}`} aria-live="polite">
        {!aiStatus.ok
          ? 'LLM-Gateway nicht erreichbar'
          : (!aiStatus.openaiConfigured
            ? 'Fallback aktiv: OPENAI_API_KEY fehlt (lokale Antwort)'
            : (sending ? 'Durchsuche lokale Präparate/Fachtexte …' : 'Bereit'))}
      </div>
      <div ref={chatBodyRef} className="chat-body" role="log" aria-live="polite">
        {messages.map((m, idx) => (
          <div key={idx} className={`msg ${m.role}`}>
            {m.role === 'assistant' && m.type === 'pending' ? (
              <div className="bubble pending" aria-label="Antwort wird erstellt">
                <div className="pending-row">
                  <span className="dots" aria-hidden="true"><span>.</span><span>.</span><span>.</span></span>
                  <span>Suche in lokalen Präparaten/Fachtexten</span>
                </div>
              </div>
            ) : (m.role === 'assistant' && m.result ? (
              <div className="bubble" style={{ whiteSpace: 'normal' }}>
                <div style={{ fontWeight: 800, marginBottom: 6 }}>Kurze Zusammenfassung</div>
                <div style={{ whiteSpace: 'pre-wrap' }}>{m.result.summary || m.content}</div>

                <div style={{ height: 10 }} />
                <div style={{ fontWeight: 800, marginBottom: 6 }}>Gefundene Präparate</div>
                {Array.isArray(m.result.matches) && m.result.matches.length ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {m.result.matches.map((mm) => (
                      <div key={mm.prepId} style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 10 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'baseline' }}>
                          <div style={{ fontWeight: 800 }}>{mm.brandName || 'Präparat'}</div>
                          <button
                            className="btn btn-small"
                            type="button"
                            onClick={() => setFocus({ prepId: mm.prepId, brandName: mm.brandName || null })}
                            title="Für Folgefragen als Kontext verwenden"
                          >
                            Als Kontext
                          </button>
                        </div>
                        <div style={{ color: '#475569', marginTop: 2 }}>
                          {[
                            (mm.ingredients && mm.ingredients.length) ? `Wirkstoff(e): ${mm.ingredients.join(', ')}` : null,
                            (mm.forms && mm.forms.length) ? `Form(en): ${mm.forms.join(', ')}` : null,
                            mm.rxStatus ? `Status: ${mm.rxStatus}` : null,
                            mm.atc ? `ATC ${mm.atc}` : null
                          ].filter(Boolean).join(' · ')}
                        </div>
                        {Array.isArray(mm.statements) && mm.statements.length ? (
                          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {mm.statements.map((st, si) => (
                              <div key={si} className={`st st-${String(st.kind || 'other').toLowerCase()}`}>
                                <div className="st-head">
                                  <span className={`st-badge st-badge-${String(st.kind || 'other').toLowerCase()}`}>{String(st.kind || 'other').toUpperCase()}</span>
                                </div>
                                <div style={{ whiteSpace: 'pre-wrap' }}>{st.text}</div>
                                {Array.isArray(st.evidence) && st.evidence.length ? (
                                  <div style={{ marginTop: 4, fontSize: 12, color: '#334155' }}>
                                    Evidenz:
                                    <ul style={{ margin: '4px 0 0 18px' }}>
                                      {st.evidence.slice(0, 3).map((ev, ei) => (
                                        <li key={ei}>
                                          <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{ev.sourceRef}</span>
                                          {ev.quote ? ` — “${ev.quote}”` : ''}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div style={{ marginTop: 8, color: '#475569' }}>Keine evidenzbasierten Aussagen im lokalen Kontext gefunden.</div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ color: '#475569' }}>Keine lokalen Treffer.</div>
                )}

                {(Array.isArray(m.result.dataGaps) && m.result.dataGaps.length) || (Array.isArray(m.result.missingInfo) && m.result.missingInfo.length) ? (
                  <>
                    <div style={{ height: 12 }} />
                    <div style={{ fontWeight: 800, marginBottom: 6 }}>Nicht gefunden / Datenlücken</div>
                    {Array.isArray(m.result.dataGaps) && m.result.dataGaps.length ? (
                      <ul style={{ margin: '0 0 8px 18px' }}>
                        {m.result.dataGaps.map((g, gi) => <li key={gi}>{g}</li>)}
                      </ul>
                    ) : null}
                    {Array.isArray(m.result.missingInfo) && m.result.missingInfo.length ? (
                      <>
                        <div style={{ fontWeight: 800, marginBottom: 4 }}>Rückfragen</div>
                        <div className="chips">
                          {m.result.missingInfo.map((q, qi) => (
                            <button
                              key={qi}
                              type="button"
                              className="chip"
                              onClick={() => { setInput(String(q)); inputRef.current?.focus(); }}
                              title="Als nächste Frage übernehmen"
                            >
                              {q}
                            </button>
                          ))}
                        </div>
                      </>
                    ) : null}
                  </>
                ) : null}

                <div style={{ height: 12 }} />
                <div style={{ fontWeight: 800, marginBottom: 6 }}>Disclaimer</div>
                <div style={{ fontSize: 12, color: '#334155' }}>{m.result.disclaimer || 'Hinweis: Neutrale Fachinformation aus lokalen Texten; ersetzt keine ärztliche Beurteilung.'}</div>
              </div>
	            ) : (
	              <div className="bubble" style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>
	            ))}
	          </div>
	        ))}
	      </div>
      <div className="chat-input">
        <textarea
          ref={inputRef}
          className="chat-inputbox"
          rows={1}
          placeholder="Frage stellen… Enter: senden · Shift+Enter: Zeilenumbruch"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          aria-label="Chat-Eingabe"
        />
        <button className="btn" onClick={send} disabled={sending} style={{ whiteSpace: 'nowrap' }}>Senden</button>
      </div>
      <div className="chat-footer">
        {focus?.prepId ? `Kontext für Folgefragen: ${focus.brandName || `prepId ${focus.prepId}`}. ` : ''}
        LAN-only: Anfrage geht serverseitig an den internen LLM-Gateway (kein Browser-API-Key, kein Chat-Transcript). Disclaimer beachten.
      </div>
    </aside>
  );
}

export default function MediRemidi() {
  const tenantId = getTenantId() || 'test';
  const [q, setQ] = useState('');
  const dQ = useDebounced(q, 250);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [mode, setMode] = useState('search'); // 'search' | 'ai'

  useEffect(() => {
    let stop = false;
    const run = async () => {
      const typed = (dQ || '').trim();
      if (typed.length < 2) {
        // Vor Eingabe von mind. 2 Zeichen nichts laden und keine Fehl-Hinweise zeigen
        if (!stop) { setResults([]); setLoading(false); }
        return;
      }
      try {
        setLoading(true);
        const params = new URLSearchParams();
        params.set('q', typed);
        params.set('limit', '20');
        const res = await api.get(`/api/meds?${params.toString()}`);
        const items = Array.isArray(res?.data?.items) ? res.data.items : [];
        if (!stop) setResults(items);
      } catch {
        if (!stop) setResults([]);
      } finally {
        if (!stop) setLoading(false);
      }
    };
    run();
    return () => { stop = true; };
  }, [dQ]);

  const loadDetails = async (id) => {
    try {
      const res = await api.get(`/api/meds/${encodeURIComponent(id)}`);
      setSelected(res?.data || null);
    } catch { setSelected(null); }
  };

  const rootCls = `meds-root ${mode === 'ai' ? 'mode-ai' : 'mode-search'}`;
  return (
    <div className={rootCls}>
      <div className="meds-topbar">
        <ModeToggle mode={mode} onChange={setMode} />
      </div>

      {mode === 'search' ? (
        <>
          <div className="meds-left">
            <SearchBar value={q} onChange={setQ} onSubmit={() => { /* already auto-loaded */ }} loading={loading} />
            <ResultsList items={results} activeId={selected?.id} onSelect={(m) => loadDetails(m.id)} />
          </div>
          <div className="meds-center">
            <MedDetails item={selected} />
          </div>
        </>
      ) : (
        <div className="meds-center-wide">
          <ChatPanel tenantId={tenantId} contextSelection={selected} variant="wide" />
        </div>
      )}
    </div>
  );
}
