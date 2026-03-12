import React, { useEffect, useMemo, useState } from 'react';
import { listInventoryItems, createInventoryItem, adjustInventoryItem, listInventoryTransactions } from './api';

export default function InventoryView({ onClose, inline = false }) {
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [newItem, setNewItem] = useState({ name: '', category: '', unit: '', min_stock: 0 });
  const [saving, setSaving] = useState(false);
  const [txOpen, setTxOpen] = useState({});
  const [txData, setTxData] = useState({});

  const load = async () => {
    try {
      setLoading(true); setError('');
      const list = await listInventoryItems({ search, lowStockOnly: lowOnly });
      setItems(list);
    } catch (e) {
      setError(e?.message || 'Inventar konnte nicht geladen werden');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const reload = () => load();

  const createItem = async () => {
    if (!newItem.name.trim()) return;
    try {
      setSaving(true);
      await createInventoryItem({
        name: newItem.name,
        category: newItem.category || null,
        unit: newItem.unit || null,
        min_stock: Number(newItem.min_stock) || 0,
        current_stock: 0
      });
      setNewItem({ name: '', category: '', unit: '', min_stock: 0 });
      await load();
    } catch (e) {
      alert(e?.response?.data?.message || e?.message || 'Item konnte nicht erstellt werden');
    } finally {
      setSaving(false);
    }
  };

  const adjust = async (id, delta) => {
    try {
      await adjustInventoryItem(id, { delta, reason: delta > 0 ? 'Zugang' : 'Abgang' });
      await load();
    } catch (e) {
      alert(e?.response?.data?.message || e?.message || 'Bestand konnte nicht angepasst werden');
    }
  };

  const shown = useMemo(() => items, [items]);

  const content = (
    <>
        {error && <div style={{ color: 'crimson', marginBottom: 8 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
          <input type="text" placeholder="Suche…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} /> Nur unter Mindestbestand
          </label>
          <button className="btn-save" onClick={load} disabled={loading}>{loading ? 'Lade…' : 'Aktualisieren'}</button>
        </div>

        <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 8, marginBottom: 12 }}>
          <h3 style={{ marginTop: 0 }}>Neues Item</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr auto', gap: 8 }}>
            <input type="text" placeholder="Name" value={newItem.name} onChange={(e) => setNewItem({ ...newItem, name: e.target.value })} />
            <input type="text" placeholder="Kategorie" value={newItem.category} onChange={(e) => setNewItem({ ...newItem, category: e.target.value })} />
            <input type="text" placeholder="Einheit" value={newItem.unit} onChange={(e) => setNewItem({ ...newItem, unit: e.target.value })} />
            <input type="number" min={0} placeholder="Mindestbestand" value={newItem.min_stock} onChange={(e) => setNewItem({ ...newItem, min_stock: e.target.value })} />
            <button className="btn-save" onClick={createItem} disabled={saving}>{saving ? 'Speichern…' : 'Anlegen'}</button>
          </div>
        </div>

        <div>
          {shown.length === 0 && <div style={{ color: '#6b7280' }}>Keine Elemente</div>}
          {shown.map(it => (
            <div key={it.id} style={{ padding: '8px 0', borderBottom: '1px dashed #e5e7eb' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>
                    {it.name} {it.unit ? <span style={{ color: '#6b7280', fontWeight: 400 }}>({it.unit})</span> : null}
                    {it.current_stock < it.min_stock && <span style={{ color: '#ef4444', marginLeft: 8 }}>unter Mindestbestand</span>}
                  </div>
                  <div style={{ fontSize: 13, color: '#374151' }}>
                    Kategorie: {it.category || '—'} · Mindest: {it.min_stock} · Bestand: {it.current_stock}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <button className="btn-cancel" onClick={() => adjust(it.id, -1)}>-1</button>
                  <button className="btn-save" onClick={() => adjust(it.id, +1)}>+1</button>
                  <input type="number" placeholder="Δ" style={{ width: 80 }} onKeyDown={async (e) => {
                    if (e.key === 'Enter') { const v = Number(e.currentTarget.value); if (Number.isFinite(v) && v !== 0) { await adjust(it.id, v); e.currentTarget.value=''; } }
                  }} />
                  <button className="btn-cancel" onClick={async () => {
                    const open = !!txOpen[it.id];
                    if (open) { setTxOpen(prev => ({ ...prev, [it.id]: false })); return; }
                    try {
                      const list = await listInventoryTransactions(it.id);
                      setTxData(prev => ({ ...prev, [it.id]: list.slice(0,10) }));
                      setTxOpen(prev => ({ ...prev, [it.id]: true }));
                    } catch (e) {
                      alert(e?.message || 'Transaktionen konnten nicht geladen werden');
                    }
                  }}>{txOpen[it.id] ? 'Verbergen' : 'Historie'}</button>
                </div>
              </div>
              {txOpen[it.id] && (
                <div style={{ marginTop: 6, fontSize: 13, color: '#374151' }}>
                  {(txData[it.id] || []).length === 0 && <div>Keine Transaktionen</div>}
                  {(txData[it.id] || []).map(tx => (
                    <div key={tx.id}>
                      {new Date(tx.created_at).toLocaleString('de-CH')} · Δ {tx.change_amount} · {tx.reason || '—'}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
    </>
  );

  if (inline) {
    return (
      <>
        <h2 className="h2" style={{ marginTop: 0 }}>Inventar</h2>
        {content}
      </>
    );
  }
  return (
    <div className="popup-overlay">
      <div className="popup-container wide-popup">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 className="h2" style={{ margin: 0 }}>Inventar</h2>
          <button className="btn-cancel" onClick={() => onClose?.()} title="Schließen" type="button">❌</button>
        </div>
        <hr />
        {content}
      </div>
    </div>
  );
}
