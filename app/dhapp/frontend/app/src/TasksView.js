import React, { useEffect, useMemo, useRef, useState } from 'react';
import { listTasks, getTask, createTask, updateTask, addTaskComment, listAccessibleUsers, getUnreadTasksCount, fetchPatients as fetchPatientsList } from './api';

const STATUS_OPTIONS = ['OPEN','IN_PROGRESS','DONE','ARCHIVED'];
const PRIORITY_OPTIONS = ['LOW','NORMAL','HIGH','URGENT'];
const statusLabel = (s) => ({ OPEN: 'Offen', IN_PROGRESS: 'In Bearbeitung', DONE: 'Erledigt', ARCHIVED: 'Archiviert' }[String(s).toUpperCase()] || s);
const prioLabel = (p) => ({ LOW: 'Niedrig', NORMAL: 'Normal', HIGH: 'Hoch', URGENT: 'Dringend' }[String(p).toUpperCase()] || p);

function Badge({ children, kind='default' }) {
  const styles = {
    display: 'inline-block', padding: '2px 8px', borderRadius: 12, fontSize: 12,
    background: '#e5e7eb', color: '#111827'
  };
  if (kind === 'status:OPEN') Object.assign(styles, { background: '#fde68a', color: '#7c2d12' });
  if (kind === 'status:IN_PROGRESS') Object.assign(styles, { background: '#bfdbfe', color: '#1e3a8a' });
  if (kind === 'status:DONE') Object.assign(styles, { background: '#bbf7d0', color: '#065f46' });
  if (kind === 'status:ARCHIVED') Object.assign(styles, { background: '#e5e7eb', color: '#374151' });
  if (kind === 'prio:HIGH' || kind === 'prio:URGENT') Object.assign(styles, { background: '#fecaca', color: '#7f1d1d' });
  return <span style={styles}>{children}</span>;
}

export default function TasksView({ user, onClose, onMinimize, onUnreadChanged, unreadCount = 0, embed = false }) {
  const [filterMine, setFilterMine] = useState('assigned'); // assigned | created | all
  const [statusFilter, setStatusFilter] = useState(['OPEN','IN_PROGRESS']);
  const [priorityFilter, setPriorityFilter] = useState([]);
  const [search, setSearch] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null); // { task, comments, attachments }
  const [newTask, setNewTask] = useState({ open: false, title: '', description: '', type: '', priority: 'NORMAL', assignee: '', patientId: '' });
  const [users, setUsers] = useState([]);
  const [patients, setPatients] = useState([]);
  const unreadRef = useRef(Number(unreadCount) || 0);

  useEffect(() => { unreadRef.current = Number(unreadCount) || 0; }, [unreadCount]);

  useEffect(() => {
    (async () => {
      try {
        const list = await listAccessibleUsers();
        setUsers(list);
      } catch (_) {
        // fallback to self only
        if (user) setUsers([{ id: user.id, name: user.name || `${user.vorname||''} ${user.nachname||''}`.trim() || 'Ich' }]);
      }
    })();
  }, [user?.id]);

  useEffect(() => {
    (async () => {
      try {
        const list = await fetchPatientsList();
        setPatients(Array.isArray(list) ? list : []);
      } catch (_) { setPatients([]); }
    })();
  }, []);

  const refreshUnread = async () => {
    try {
      const c = await getUnreadTasksCount();
      const prev = Number(unreadRef.current) || 0;
      const delta = Number(c) - prev;
      unreadRef.current = Number(c);
      if (typeof onUnreadChanged === 'function' && delta !== 0) onUnreadChanged(delta);
    } catch (_) { /* ignore */ }
  };
  const [newComment, setNewComment] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try {
      const q = {
        status: statusFilter,
        priority: priorityFilter,
        search,
        limit: 100,
      };
      if (filterMine === 'assigned') q.assignedToUserId = user?.id;
      else if (filterMine === 'created') q.createdByUserId = user?.id;
      const list = await listTasks(q);
      setItems(list);
    } catch (e) {
      setError(e?.message || 'Aufgaben konnten nicht geladen werden');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filterMine, statusFilter.join(','), priorityFilter.join(','), search]);

  const openTask = async (task) => {
    try {
      const dto = await getTask(task.id);
      setSelected(dto);
      // server marks as read for assignee; refresh unread count accurately
      await refreshUnread();
    } catch (e) {
      alert(e?.message || 'Aufgabe konnte nicht geladen werden');
    }
  };

  const handleCreate = async () => {
    // Beim Erstellen neue Aufgabe: Detailansicht schließen
    setSelected(null);
    if (!newTask.title.trim()) { alert('Titel fehlt'); return; }
    try {
      const row = await createTask({
        title: newTask.title,
        description: newTask.description || null,
        type: newTask.type || null,
        priority: newTask.priority || 'NORMAL',
        assigned_to_user_id: newTask.assignee ? Number(newTask.assignee) : null,
        patient_id: newTask.patientId ? Number(newTask.patientId) : null,
        status: 'OPEN',
      });
      setNewTask({ open: false, title: '', description: '', type: '', priority: 'NORMAL', assignee: '', patientId: '' });
      await load();
      await refreshUnread();
    } catch (e) {
      alert(e?.message || 'Aufgabe konnte nicht erstellt werden');
    }
  };

  const handleUpdate = async (patch) => {
    if (!selected?.task) return;
    try {
      const before = selected.task;
      const updated = await updateTask(selected.task.id, patch);
      setSelected((s) => s ? { ...s, task: { ...s.task, ...updated } } : s);
      await load();
      // If assignee or status change impacts unread, refresh count
      if ('assigned_to_user_id' in patch || 'status' in patch) {
        await refreshUnread();
      }
    } catch (e) { alert(e?.message || 'Aktualisierung fehlgeschlagen'); }
  };

  const handleAddComment = async () => {
    if (!selected?.task || !newComment.trim()) return;
    try {
      const c = await addTaskComment(selected.task.id, newComment.trim());
      setSelected((s) => s ? { ...s, comments: [...(s.comments||[]), c] } : s);
      setNewComment('');
    } catch (e) { alert(e?.message || 'Kommentar fehlgeschlagen'); }
  };

  const usersForAssignee = useMemo(() => {
    if (Array.isArray(users) && users.length) return users;
    return user ? [{ id: user.id, name: user.name || `${user.vorname||''} ${user.nachname||''}`.trim() || 'Ich' }] : [];
  }, [users, user]);

  const unreadForMe = (task) => (task.assigned_to_user_id === user?.id && !task.read_at_assignee && ['OPEN','IN_PROGRESS'].includes(task.status));

  const content = (
    <>
      <h2 className="h2" style={{ margin: 0 }}>Aufgaben</h2>
      {!embed && (
        <div className="title-actions" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <button className="btn-cancel" onClick={onClose} title="Schließen" type="button">❌</button>
        </div>
      )}
      <hr />

        {/* Filterleiste */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={filterMine} onChange={(e) => setFilterMine(e.target.value)}>
            <option value="assigned">Meine Aufgaben</option>
            <option value="created">Von mir erstellt</option>
            <option value="all">Alle (im Mandanten)</option>
          </select>
          <select multiple value={statusFilter} onChange={(e) => setStatusFilter(Array.from(e.target.selectedOptions).map(o => o.value))} style={{ minWidth: 180 }}>
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}
          </select>
          <select multiple value={priorityFilter} onChange={(e) => setPriorityFilter(Array.from(e.target.selectedOptions).map(o => o.value))} style={{ minWidth: 160 }}>
            {PRIORITY_OPTIONS.map(p => <option key={p} value={p}>{prioLabel(p)}</option>)}
          </select>
          <input type="text" placeholder="Suchen… (Titel/Beschreibung)" value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex: 1, minWidth: 240 }} />
          <button
            className="btn-save"
            onClick={() => {
              // Beim Start einer neuen Aufgabe aktuelle Detailansicht schließen
              setSelected(null);
              setNewTask((t) => ({ ...t, open: true }));
            }}
          >
            Neue Aufgabe
          </button>
        </div>

        {/* Liste & Detail nur anzeigen, wenn keine neue Aufgabe erfasst wird */}
        {!newTask.open && (
          <>
            {/* Liste */}
            <div style={{ marginTop: 12, border: '1px solid #ddd', borderRadius: 8, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f3f4f6' }}>
                    <th style={{ textAlign: 'left', padding: 8 }}>Titel</th>
                    <th style={{ textAlign: 'left', padding: 8 }}>Status</th>
                    <th style={{ textAlign: 'left', padding: 8 }}>Priorität</th>
                    <th style={{ textAlign: 'left', padding: 8 }}>Zuständig</th>
                    <th style={{ textAlign: 'left', padding: 8 }}>Betroffener Patient</th>
                    <th style={{ textAlign: 'left', padding: 8 }}>Fällig</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan="5" style={{ padding: 12 }}>Lade…</td></tr>
                  ) : items.length === 0 ? (
                    <tr><td colSpan="5" style={{ padding: 12 }}>Keine Aufgaben</td></tr>
                  ) : (
                    items.map((t) => (
                      <tr key={t.id} onClick={() => openTask(t)} style={{ cursor: 'pointer', background: unreadForMe(t) ? '#fff7ed' : 'transparent' }}>
                        <td style={{ padding: 8 }}>
                          {unreadForMe(t) ? <span title="Ungelesen" style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 8, background: '#ef4444', marginRight: 6 }} /> : null}
                          <span style={{ fontWeight: 600 }}>{t.title}</span>
                          {t.description ? <div style={{ color: '#6b7280', fontSize: 12, marginTop: 2, maxWidth: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.description}</div> : null}
                        </td>
                        <td style={{ padding: 8 }}><Badge kind={`status:${t.status}`}>{statusLabel(t.status)}</Badge></td>
                        <td style={{ padding: 8 }}><Badge kind={`prio:${t.priority}`}>{prioLabel(t.priority)}</Badge></td>
                        <td style={{ padding: 8 }}>{t.assignee_name || (t.assigned_to_user_id ? `#${t.assigned_to_user_id}` : '-')}</td>
                        <td style={{ padding: 8 }}>{t.patient_name || (() => { const p = patients.find(x => x.id === t.patient_id); return p ? ([p.vorname,p.nachname].filter(Boolean).join(' ') || p.name || `#${p.id}`) : '-'; })()}</td>
                        <td style={{ padding: 8 }}>{t.due_date ? new Date(t.due_date).toLocaleDateString() : '-'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Detailansicht */}
            {selected && (
              <div style={{ marginTop: 16 }}>
                <h3 style={{ margin: 0 }}>{selected.task?.title}</h3>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                  <Badge kind={`status:${selected.task?.status}`}>{selected.task?.status}</Badge>
                  <Badge kind={`prio:${selected.task?.priority}`}>{selected.task?.priority}</Badge>
                  {selected.task?.due_date ? <Badge>Fällig: {new Date(selected.task.due_date).toLocaleDateString()}</Badge> : null}
                </div>
                <p style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>{selected.task?.description || ''}</p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <select value={selected.task?.status || 'OPEN'} onChange={(e) => handleUpdate({ status: e.target.value })} title="Status">
                    {STATUS_OPTIONS.map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}
                  </select>
                  <select value={selected.task?.priority || 'NORMAL'} onChange={(e) => handleUpdate({ priority: e.target.value })} title="Priorität">
                    {PRIORITY_OPTIONS.map(p => <option key={p} value={p}>{prioLabel(p)}</option>)}
                  </select>
                  <select
                    value={selected.task?.assigned_to_user_id || ''}
                    onChange={(e) => handleUpdate({ assigned_to_user_id: e.target.value ? Number(e.target.value) : null })}
                    title="Zuständig (Benutzer)"
                  >
                    <option value="">– kein/e Zuständige/r –</option>
                    {usersForAssignee.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                  <select
                    value={selected.task?.patient_id || ''}
                    onChange={(e) => handleUpdate({ patient_id: e.target.value ? Number(e.target.value) : null })}
                    title="Betroffener Patient"
                  >
                    <option value="">– kein Patient –</option>
                    {patients.map(p => <option key={p.id} value={p.id}>{[p.vorname, p.nachname].filter(Boolean).join(' ') || p.name || `#${p.id}`}</option>)}
                  </select>
                </div>
                <hr />
                <h4 style={{ margin: '8px 0' }}>Kommentare</h4>
                <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 8, maxHeight: 220, overflowY: 'auto' }}>
                  {(selected.comments || []).map((c) => (
                    <div key={c.id} style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 12, color: '#6b7280' }}>{new Date(c.created_at).toLocaleString('de-CH')} · {c.author_name || `#${c.author_user_id||'-'}`}</div>
                      <div>{c.comment_text}</div>
                    </div>
                  ))}
                  {(!selected.comments || !selected.comments.length) && <div style={{ color: '#6b7280' }}>Noch keine Kommentare</div>}
                </div>
                <div style={{ display: 'flex', marginTop: 8, gap: 8 }}>
                  <input type="text" placeholder="Kommentar hinzufügen" value={newComment} onChange={(e) => setNewComment(e.target.value)} style={{ flex: 1 }} />
                  <button className="btn-save" onClick={handleAddComment}>Hinzufügen</button>
                </div>
              </div>
            )}
          </>
        )}

        {/* Neue Aufgabe Modal simple inline */}
        {newTask.open && (
          <div style={{ marginTop: 16, borderTop: '1px solid #e5e7eb', paddingTop: 12 }}>
            <h3 style={{ margin: 0 }}>Neue Aufgabe</h3>
            <div className="form-group">
              <label>Titel</label>
              <input type="text" value={newTask.title} onChange={(e) => setNewTask({ ...newTask, title: e.target.value })} autoFocus />
            </div>
            <div className="form-group">
              <label>Beschreibung</label>
              <textarea rows={3} value={newTask.description} onChange={(e) => setNewTask({ ...newTask, description: e.target.value })} />
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <div className="form-group" style={{ minWidth: 160 }}>
                <label>Typ</label>
                <input type="text" value={newTask.type} onChange={(e) => setNewTask({ ...newTask, type: e.target.value })} placeholder="KLINISCH/ADMIN/BILLING…" />
              </div>
              <div className="form-group" style={{ minWidth: 160 }}>
                <label>Priorität</label>
                <select value={newTask.priority} onChange={(e) => setNewTask({ ...newTask, priority: e.target.value })}>
                  {PRIORITY_OPTIONS.map(p => <option key={p} value={p}>{prioLabel(p)}</option>)}
                </select>
              </div>
              <div className="form-group" style={{ minWidth: 200 }}>
                <label>Zuständig (Benutzer)</label>
                <select value={newTask.assignee} onChange={(e) => setNewTask({ ...newTask, assignee: e.target.value })}>
                  <option value="">– kein/e Zuständige/r –</option>
                  {usersForAssignee.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
              <div className="form-group" style={{ minWidth: 240 }}>
                <label>Betroffener Patient</label>
                <select value={newTask.patientId} onChange={(e) => setNewTask({ ...newTask, patientId: e.target.value })}>
                  <option value="">– kein Patient –</option>
                  {patients.map(p => <option key={p.id} value={p.id}>{[p.vorname, p.nachname].filter(Boolean).join(' ') || p.name || `#${p.id}`}</option>)}
                </select>
              </div>
            </div>
            <div className="button-row">
              <button className="btn-cancel" onClick={() => setNewTask({ open: false, title: '', description: '', type: '', priority: 'NORMAL', assignee: '', patientId: '' })}>Abbrechen</button>
              <button className="btn-save" onClick={handleCreate}>Speichern</button>
            </div>
          </div>
        )}

      {error && <div style={{ color: '#dc2626', marginTop: 8 }}>{error}</div>}
    </>
  );

  if (embed) {
    return (
      <div className="App">
        {content}
      </div>
    );
  }
  return (
    <div className="popup-overlay" onClick={onClose}>
      <div className="popup-container" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '1100px' }}>
        {content}
      </div>
    </div>
  );
}
