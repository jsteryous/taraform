import { useState, useEffect, useRef } from 'react';
import Modal from '../shared/Modal';
import { useApp } from '../../context/AppContext';
import { getTemplates, createTemplate, updateTemplate, deleteTemplate } from '../../lib/api';

const TOUCH_LABELS = {
  1: 'Touch 1 — Initial Outreach',
  2: 'Touch 2 — 7 Day Follow-up',
  3: 'Touch 3 — 30 Day Nurture',
  4: 'Touch 4 — 180 Day Long Nurture',
};

const CORE_VARS = ['firstName','lastName','propertyAddress','city','county'];

export default function TemplatesModal({ open, onClose }) {
  const { currentClientId, currentClient, showToast } = useApp();
  const [templates, setTemplates] = useState([]);
  const [editModal, setEditModal] = useState(false);
  const [editId, setEditId]       = useState(null);
  const [form, setForm]           = useState({ name: '', body: '', touch_number: 1 });
  const bodyRef = useRef(null);

  const customVars = (currentClient?.config?.custom_field_definitions || []).map(d => d.key);

  useEffect(() => {
    if (open && currentClientId) {
      getTemplates(currentClientId).then(setTemplates).catch(() => {});
    }
  }, [open, currentClientId]);

  async function handleSave() {
    if (!form.name || !form.body) return;
    if (editId) {
      await updateTemplate(editId, form);
    } else {
      await createTemplate({ ...form, client_id: currentClientId, active: false });
    }
    const updated = await getTemplates(currentClientId);
    setTemplates(updated);
    setEditModal(false);
    showToast('Template saved');
  }

  async function handleSetActive(id, touchNumber) {
    const touchTpls = templates.filter(t => t.touch_number === touchNumber);
    for (const t of touchTpls) {
      await updateTemplate(t.id, { active: t.id === id });
    }
    setTemplates(await getTemplates(currentClientId));
  }

  async function handleDelete(id) {
    if (!confirm('Delete this template?')) return;
    await deleteTemplate(id);
    setTemplates(await getTemplates(currentClientId));
    showToast('Template deleted');
  }

  function insertVar(v) {
    const ta = bodyRef.current;
    if (!ta) return;
    const start = ta.selectionStart, end = ta.selectionEnd;
    const val = form.body.slice(0, start) + `{{${v}}}` + form.body.slice(end);
    setForm(f => ({ ...f, body: val }));
    setTimeout(() => { ta.focus(); ta.selectionStart = ta.selectionEnd = start + v.length + 4; }, 0);
  }

  function openNew(touch) {
    setEditId(null);
    setForm({ name: '', body: '', touch_number: touch });
    setEditModal(true);
  }

  function openEdit(t) {
    setEditId(t.id);
    setForm({ name: t.name, body: t.body, touch_number: t.touch_number });
    setEditModal(true);
  }

  const byTouch = [1,2,3,4].map(n => ({ n, tpls: templates.filter(t => t.touch_number === n) }));
  const chars = form.body.length;
  const segs  = Math.ceil(chars / 160) || 1;
  const charColor = chars > 320 ? 'var(--danger)' : chars > 160 ? 'var(--warning)' : 'var(--success)';

  return (
    <>
      <Modal open={open} onClose={onClose} title="SMS Templates" width="780px">
        {/* Var bar */}
        <div style={{ padding: '0.75rem 1.5rem', background: 'var(--surface)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', margin: '0 -1.5rem' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Variables</span>
          {CORE_VARS.map(v => <button key={v} className="tpl-var-btn" onClick={() => {}}>{v}</button>)}
          {customVars.map(v => <button key={v} className="tpl-var-btn tpl-var-custom" onClick={() => {}}>{v}</button>)}
        </div>

        <div style={{ padding: '1.25rem 0' }}>
          {byTouch.map(({ n, tpls }) => {
            const active = tpls.find(t => t.active);
            return (
              <div key={n} className="tpl-touch-section">
                <div className="tpl-touch-header">
                  <div>
                    <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{TOUCH_LABELS[n]}</span>
                    {!active && <span style={{ fontSize: '0.75rem', color: 'var(--danger)', marginLeft: '0.5rem' }}>⚠ No active template</span>}
                  </div>
                  <button className="btn-small btn-primary" onClick={() => openNew(n)}>+ Add</button>
                </div>
                {tpls.length === 0
                  ? <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem', padding: '0.5rem 0' }}>No templates yet.</div>
                  : tpls.map(t => {
                    const c = t.body.length, s = Math.ceil(c / 160) || 1;
                    const sc = c > 320 ? 'var(--danger)' : c > 160 ? 'var(--warning)' : 'var(--text-muted)';
                    return (
                      <div key={t.id} className={`tpl-card${t.active ? ' tpl-active' : ''}`}>
                        <div>
                          <div className="tpl-card-name">{t.name}{t.active && <span className="tpl-active-tag">active</span>}</div>
                          <div className="tpl-card-body">{t.body}</div>
                          <div style={{ fontSize: '0.7rem', fontFamily: 'var(--mono)', color: sc, marginTop: '0.4rem' }}>{c} chars · {s} segment{s !== 1 ? 's' : ''}</div>
                        </div>
                        <div className="tpl-card-actions">
                          {!t.active && <button className="btn-small" onClick={() => handleSetActive(t.id, t.touch_number)}>✓ Set Active</button>}
                          <button className="btn-small" onClick={() => openEdit(t)}>✏</button>
                          {!t.active && <button className="btn-small btn-danger" onClick={() => handleDelete(t.id)} style={{ padding: '0.375rem 0.6rem' }}>×</button>}
                        </div>
                      </div>
                    );
                  })}
              </div>
            );
          })}
        </div>
      </Modal>

      {/* Edit modal */}
      <Modal open={editModal} onClose={() => setEditModal(false)} title={editId ? 'Edit Template' : 'New Template'} width="580px"
        footer={<><button onClick={() => setEditModal(false)}>Cancel</button><button className="btn-primary" onClick={handleSave}>Save</button></>}>
        {/* Var buttons for edit modal */}
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
          {[...CORE_VARS, ...customVars].map(v => (
            <button key={v} className={`tpl-var-btn${customVars.includes(v) ? ' tpl-var-custom' : ''}`} onClick={() => insertVar(v)}>{v}</button>
          ))}
        </div>
        <div className="form-grid">
          <div className="form-group full-width">
            <label>Template Name</label>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Direct Message" />
          </div>
          <div className="form-group full-width">
            <label>Touch Number</label>
            <select value={form.touch_number} onChange={e => setForm(f => ({ ...f, touch_number: Number(e.target.value) }))}>
              {[1,2,3,4].map(n => <option key={n} value={n}>{TOUCH_LABELS[n]}</option>)}
            </select>
          </div>
          <div className="form-group full-width">
            <label>Message Body</label>
            <textarea
              ref={bodyRef}
              value={form.body}
              onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
              style={{ minHeight: '120px', resize: 'vertical' }}
              placeholder="Hi {{firstName}}, are you the owner of..."
            />
            <div style={{ fontSize: '0.75rem', fontFamily: 'var(--mono)', color: charColor, marginTop: '0.35rem' }}>
              {chars} chars · {segs} segment{segs !== 1 ? 's' : ''}
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
}