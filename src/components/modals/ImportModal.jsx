import { useState, useRef } from 'react';
import Modal from '../shared/Modal';
import { useApp } from '../../context/AppContext';
import { supabase } from '../../lib/supabase';
import { normalizeCounty, mapDbContact, formatPhone } from '../../lib/utils';

const FIELDS = ['firstName','lastName','phone','email','county','ownerAddress','propertyAddress','taxMapId','acreage'];
const FIELD_LABELS = {
  firstName: 'First Name', lastName: 'Last Name', phone: 'Phone',
  email: 'Email', county: 'County', ownerAddress: 'Owner Address',
  propertyAddress: 'Property Address', taxMapId: 'Tax Map ID', acreage: 'Acreage',
};

function parseCSV(text) {
  const lines = text.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const rows = lines.slice(1).map(line => {
    const values = [];
    let current = '', inQuotes = false;
    for (const char of line) {
      if (char === '"') { inQuotes = !inQuotes; }
      else if (char === ',' && !inQuotes) { values.push(current.trim()); current = ''; }
      else { current += char; }
    }
    values.push(current.trim());
    return values;
  });
  return { headers, rows };
}

function autoMap(headers) {
  const mapping = {};
  const h = headers.map(h => h.toLowerCase().trim());
  const tries = {
    firstName:       ['first name fixed', 'matched first name', 'first name', 'firstname', 'first', 'fname', 'input first name'],
    lastName:        ['last name fixed', 'matched last name', 'last name', 'lastname', 'last', 'lname', 'input last name'],
    phone:           ['phone1', 'phone', 'phone number', 'cell', 'mobile', 'telephone'],
    email:           ['email1', 'email', 'email address', 'e-mail'],
    county:          ['input custom field 2', 'county'],
    taxMapId:        ['input custom field 1', 'tax map id', 'tax map', 'parcel id', 'parcel', 'pin', 'tax id'],
    ownerAddress:    ['confirmed mailing address', 'input mailing address', 'owner address', 'owner addr', 'mailing address', 'mailing'],
    propertyAddress: ['input property address', 'property address', 'property addr', 'situs', 'address'],
    acreage:         ['input custom field 3', 'acreage', 'acres'],
  };
  for (const [field, candidates] of Object.entries(tries)) {
    for (const candidate of candidates) {
      const idx = h.indexOf(candidate);
      if (idx >= 0) { mapping[field] = idx; break; }
    }
  }
  return mapping;
}

function findDuplicates(contact, existing) {
  return existing.filter(c => {
    const nameMatch = contact.firstName && contact.lastName &&
      c.firstName?.toLowerCase() === contact.firstName.toLowerCase() &&
      c.lastName?.toLowerCase() === contact.lastName.toLowerCase();
    const addressMatch = contact.propertyAddresses?.length && c.propertyAddresses?.length &&
      contact.propertyAddresses.some(a1 => c.propertyAddresses.some(a2 => a1.toLowerCase() === a2.toLowerCase()));
    const taxMatch = contact.taxMapIds?.length && c.taxMapIds?.length &&
      contact.taxMapIds.some(t1 => c.taxMapIds.some(t2 => t1.toLowerCase() === t2.toLowerCase()));
    return nameMatch || addressMatch || taxMatch;
  });
}

export default function ImportModal({ open, onClose }) {
  const { contacts, setContacts, currentClientId, user, showToast } = useApp();
  const [step, setStep]       = useState('upload'); // upload | map | preview | importing
  const [headers, setHeaders] = useState([]);
  const [rows, setRows]       = useState([]);
  const [mapping, setMapping] = useState({});
  const [preview, setPreview] = useState(null); // { toAdd, toUpdate, toSkip }
  const [importing, setImporting] = useState(false);
  const fileRef = useRef(null);

  function reset() {
    setStep('upload'); setHeaders([]); setRows([]); setMapping({}); setPreview(null);
  }

  function handleClose() { reset(); onClose(); }

  function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const { headers, rows } = parseCSV(ev.target.result);
      setHeaders(headers);
      setRows(rows);
      setMapping(autoMap(headers));
      setStep('map');
    };
    reader.readAsText(file);
  }

  function buildContacts() {
    // Find all phone column indices (Phone1 through Phone7)
    const phoneIndices = [];
    for (let i = 1; i <= 7; i++) {
      const idx = headers.map(h => h.toLowerCase().trim()).indexOf(`phone${i}`);
      if (idx >= 0) phoneIndices.push(idx);
    }
    // Find city/state/zip columns for address assembly
    const h = headers.map(h => h.toLowerCase().trim());
    const mailingCityIdx  = h.indexOf('confirmed mailing city')  >= 0 ? h.indexOf('confirmed mailing city')  : h.indexOf('input mailing city');
    const mailingStateIdx = h.indexOf('confirmed mailing state') >= 0 ? h.indexOf('confirmed mailing state') : h.indexOf('input mailing state');
    const mailingZipIdx   = h.indexOf('confirmed mailing zip')   >= 0 ? h.indexOf('confirmed mailing zip')   : h.indexOf('input mailing zip');
    const propCityIdx     = h.indexOf('input property city');
    const propStateIdx    = h.indexOf('input property state');
    const propZipIdx      = h.indexOf('input property zip');

    return rows.map(row => {
      // Collect all non-empty phones, deduplicate
      let phones = [];
      if (phoneIndices.length > 0) {
        phones = [...new Set(
          phoneIndices.map(i => (row[i] || '').trim()).filter(Boolean).map(formatPhone)
        )];
      } else if (mapping.phone !== undefined && row[mapping.phone]) {
        phones = [formatPhone(row[mapping.phone].trim())];
      }

      // Assemble owner address
      let ownerAddress = mapping.ownerAddress !== undefined ? (row[mapping.ownerAddress] || '').trim() : '';
      if (ownerAddress && mailingCityIdx >= 0) {
        const city  = (row[mailingCityIdx]  || '').trim();
        const state = (row[mailingStateIdx] || '').trim();
        const zip   = (row[mailingZipIdx]   || '').trim();
        if (city) ownerAddress = `${ownerAddress}, ${city}, ${state} ${zip}`.trim().replace(/,\s*$/, '');
      }

      // Assemble property address
      let propertyAddr = mapping.propertyAddress !== undefined ? (row[mapping.propertyAddress] || '').trim() : '';
      if (propertyAddr && propCityIdx >= 0) {
        const city  = (row[propCityIdx]  || '').trim();
        const state = (row[propStateIdx] || '').trim();
        const zip   = (row[propZipIdx]   || '').trim();
        if (city) propertyAddr = `${propertyAddr}, ${city}, ${state} ${zip}`.trim().replace(/,\s*$/, '');
      }

      const acreage = mapping.acreage !== undefined ? (row[mapping.acreage] || '').trim() : '';

      return {
        firstName:         mapping.firstName !== undefined ? (row[mapping.firstName] || '').trim() : '',
        lastName:          mapping.lastName  !== undefined ? (row[mapping.lastName]  || '').trim() : '',
        phones,
        email:             mapping.email !== undefined ? (row[mapping.email] || '').trim() : '',
        county:            normalizeCounty(mapping.county !== undefined ? (row[mapping.county] || '').trim() : ''),
        ownerAddress,
        propertyAddresses: propertyAddr ? [propertyAddr] : [],
        taxMapIds:         mapping.taxMapId !== undefined && row[mapping.taxMapId] ? [row[mapping.taxMapId].trim()] : [],
        acreage:           acreage || '',
        customFields:      {},
        status: 'New Lead', offers: [], activityLog: [],
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
    }).filter(c => c.firstName || c.lastName);
  }

  function handlePreview() {
    const parsed = buildContacts();
    const toAdd = [], toUpdate = [], toSkip = [];
    for (const c of parsed) {
      const dupes = findDuplicates(c, contacts);
      if (dupes.length === 0) {
        toAdd.push(c);
      } else {
        const existing = dupes[0];
        const newPhones = c.phones.filter(p => !(existing.phones || []).includes(p));
        if (newPhones.length > 0) {
          toUpdate.push({ existing, newPhones });
        } else {
          toSkip.push({ incoming: c, existing });
        }
      }
    }
    setPreview({ toAdd, toUpdate, toSkip });
    setStep('preview');
  }

  async function handleImport() {
    if (!preview) return;
    setImporting(true);
    try {
      const { toAdd, toUpdate } = preview;

      // Bulk insert new contacts
      if (toAdd.length > 0) {
        const baseTime = Date.now();
        const records = toAdd.map((c, i) => ({
          id: baseTime + i,
          user_id: user.id,
          client_id: currentClientId,
          first_name: c.firstName,
          last_name: c.lastName,
          phones: c.phones,
          email: c.email || null,
          owner_address: c.ownerAddress,
          property_addresses: c.propertyAddresses,
          county: c.county,
          tax_map_ids: c.taxMapIds,
          acreage: c.acreage || null,
          status: c.status,
          offers: [],
          activity_log: [],
          custom_fields: c.customFields || {},
          created_at: c.createdAt,
          updated_at: c.updatedAt,
        }));
        const { data, error } = await supabase.from('property_crm_contacts').insert(records).select();
        if (error) {
          console.error('Import error details:', error);
          console.error('First record sample:', JSON.stringify(records[0], null, 2));
          throw error;
        }
        setContacts(prev => [...(data || []).map(mapDbContact), ...prev]);
      }

      // Update phones on duplicates
      for (const { existing, newPhones } of toUpdate) {
        const merged = [...new Set([...(existing.phones || []), ...newPhones])];
        const { error } = await supabase
          .from('property_crm_contacts')
          .update({ phones: merged, updated_at: new Date().toISOString() })
          .eq('id', existing.id);
        if (error) throw error;
        setContacts(prev => prev.map(c => c.id === existing.id ? { ...c, phones: merged } : c));
      }

      showToast(`✓ ${toAdd.length} added · ${toUpdate.length} updated · ${preview.toSkip.length} skipped`);
      handleClose();
    } catch (err) {
      console.error(err);
      showToast('Import failed — check console');
    } finally {
      setImporting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={step === 'upload' ? 'Import CSV' : step === 'map' ? 'Map Columns' : 'Import Preview'}
      width="620px"
      footer={
        step === 'map' ? (
          <><button onClick={reset}>← Back</button><button className="btn-primary" onClick={handlePreview}>Preview Import →</button></>
        ) : step === 'preview' ? (
          <><button onClick={() => setStep('map')}>← Back</button><button className="btn-primary" onClick={handleImport} disabled={importing}>{importing ? 'Importing…' : `Import ${preview.toAdd.length + preview.toUpdate.length} contacts`}</button></>
        ) : null
      }
    >
      {/* Step 1: Upload */}
      {step === 'upload' && (
        <div style={{ textAlign: 'center', padding: '2rem 1rem' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📄</div>
          <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem', fontSize: '0.875rem' }}>
            Upload a CSV file. Column headers will be auto-detected where possible.
          </p>
          <input ref={fileRef} type="file" accept=".csv" onChange={handleFile} style={{ display: 'none' }} />
          <button className="btn-primary" onClick={() => fileRef.current.click()}>Choose CSV File</button>
        </div>
      )}

      {/* Step 2: Column mapping */}
      {step === 'map' && (
        <div>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
            {rows.length} rows detected. Map your CSV columns to Taraform fields.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            {FIELDS.map(field => (
              <div key={field} className="form-group">
                <label>{FIELD_LABELS[field]}</label>
                <select
                  value={mapping[field] !== undefined ? mapping[field] : ''}
                  onChange={e => setMapping(m => ({ ...m, [field]: e.target.value === '' ? undefined : parseInt(e.target.value) }))}
                >
                  <option value="">— Skip —</option>
                  {headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i+1}`}</option>)}
                </select>
              </div>
            ))}
          </div>

          {/* Sample preview */}
          {rows.length > 0 && (
            <div style={{ marginTop: '1.25rem', padding: '0.75rem', background: 'var(--bg)', borderRadius: '6px', fontSize: '0.8rem' }}>
              <div style={{ color: 'var(--text-muted)', marginBottom: '0.5rem', fontWeight: 600 }}>Sample row:</div>
              {FIELDS.filter(f => mapping[f] !== undefined).map(f => (
                <div key={f} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.2rem' }}>
                  <span style={{ color: 'var(--text-muted)', minWidth: '130px' }}>{FIELD_LABELS[f]}:</span>
                  <span style={{ color: 'var(--text)' }}>{rows[0]?.[mapping[f]] || '—'}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Step 3: Preview */}
      {step === 'preview' && preview && (
        <div>
          {/* Summary cards */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem', marginBottom: '1.5rem' }}>
            {[
              { label: 'New contacts', count: preview.toAdd.length, color: 'var(--success)' },
              { label: 'Phone updates', count: preview.toUpdate.length, color: 'var(--accent)' },
              { label: 'Skipped (dupes)', count: preview.toSkip.length, color: 'var(--text-muted)' },
            ].map(({ label, count, color }) => (
              <div key={label} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '8px', padding: '0.875rem', textAlign: 'center' }}>
                <div style={{ fontSize: '1.75rem', fontWeight: 700, color }}>{count}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>{label}</div>
              </div>
            ))}
          </div>

          {/* Details */}
          {preview.toUpdate.length > 0 && (
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '0.5rem' }}>Phone updates</div>
              {preview.toUpdate.slice(0, 5).map(({ existing, newPhones }, i) => (
                <div key={i} style={{ fontSize: '0.8rem', padding: '0.35rem 0', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                  {existing.firstName} {existing.lastName} — adding {newPhones.join(', ')}
                </div>
              ))}
              {preview.toUpdate.length > 5 && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>+{preview.toUpdate.length - 5} more</div>}
            </div>
          )}

          {preview.toSkip.length > 0 && (
            <div>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '0.5rem' }}>Skipped duplicates</div>
              {preview.toSkip.slice(0, 5).map(({ incoming }, i) => (
                <div key={i} style={{ fontSize: '0.8rem', padding: '0.35rem 0', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                  {incoming.firstName} {incoming.lastName} — already exists
                </div>
              ))}
              {preview.toSkip.length > 5 && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>+{preview.toSkip.length - 5} more</div>}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}