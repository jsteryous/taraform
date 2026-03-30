export function formatPhone(raw) {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits[0] === '1') return `(${digits.slice(1,4)}) ${digits.slice(4,7)}-${digits.slice(7)}`;
  return raw;
}

export function normalizePhone(phone) {
  return phone.replace(/\D/g, '').slice(-10);
}

const COUNTY_ALIASES = {
  'gvl': 'Greenville', 'greer': 'Greenville', 'greenville': 'Greenville', 'greenville county': 'Greenville',
  'sptbg': 'Spartanburg', 'spartanburg': 'Spartanburg', 'spartanburg county': 'Spartanburg',
  'anderson': 'Anderson', 'anderson county': 'Anderson',
  'pickens': 'Pickens', 'pickens county': 'Pickens',
  'cherokee': 'Cherokee', 'cherokee county': 'Cherokee',
  'laurens': 'Laurens', 'laurens county': 'Laurens',
  'union': 'Union', 'union county': 'Union',
  'york': 'York', 'york county': 'York',
  'chester': 'Chester', 'chester county': 'Chester',
  'oconee': 'Oconee', 'oconee county': 'Oconee',
};

export function normalizeCounty(county) {
  if (!county) return county;
  const key = county.trim().toLowerCase();
  return COUNTY_ALIASES[key] || county.trim().replace(/\b\w/g, l => l.toUpperCase());
}

export function toTitleCase(str) {
  if (!str) return str;
  return str.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

export function getBarClass(status) {
  const map = {
    'New Lead': 'bar-new-lead',
    'Contacted': 'bar-contacted',
    'Offer Made': 'bar-offer-made',
    'Offer Rejected/NFS': 'bar-offer-rejected',
    'UC': 'bar-uc',
    'Closed': 'bar-closed',
    'Dead/Pass': 'bar-dead-pass',
  };
  return map[status] || 'bar-new-lead';
}

export function getStatusClass(status) {
  const map = {
    'New Lead': 'status-new-lead',
    'Contacted': 'status-contacted',
    'Offer Made': 'status-offer-made',
    'Offer Rejected/NFS': 'status-offer-rejected',
    'UC': 'status-uc',
    'Closed': 'status-closed',
    'Dead/Pass': 'status-dead-pass',
  };
  return map[status] || 'status-new-lead';
}

export function mapDbContact(d) {
  return {
    id: d.id,
    firstName: d.first_name,
    lastName: d.last_name,
    phones: d.phones || [],
    email: d.email || '',
    ownerAddress: d.owner_address,
    propertyAddresses: d.property_addresses || [],
    county: normalizeCounty(d.county),
    taxMapIds: d.tax_map_ids || [],
    status: d.status,
    smsStatus: d.sms_status || 'eligible',
    lastSmsAt: d.last_sms_at || null,
    leadSource: d.lead_source || '',
    contactMethod: d.contact_method || '',
    acreage: d.acreage || '',
    notes: d.notes,
    offers: d.offers || [],
    activityLog: d.activity_log || [],
    customFields: d.custom_fields || {},
    createdAt: d.created_at,
    updatedAt: d.updated_at,
  };
}

export function mapContactToDb(contact, userId, clientId) {
  return {
    id: contact.id,
    user_id: userId,
    client_id: clientId,
    first_name: contact.firstName,
    last_name: contact.lastName,
    phones: contact.phones,
    email: contact.email || null,
    lead_source:    contact.leadSource    || null,
    contact_method: contact.contactMethod || null,
    acreage:        contact.acreage       || null,
    owner_address: contact.ownerAddress,
    property_addresses: contact.propertyAddresses,
    county: contact.county,
    tax_map_ids: contact.taxMapIds,
    status: contact.status,
    notes: contact.notes,
    offers: contact.offers,
    activity_log: contact.activityLog,
    custom_fields: contact.customFields || {},
    created_at: contact.createdAt,
    updated_at: contact.updatedAt,
  };
}

export function parseCSV(text) {
  const lines = text.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  return {
    headers,
    rows: lines.slice(1).map(line => {
      const values = [];
      let current = '', inQuotes = false;
      for (const char of line) {
        if (char === '"') { inQuotes = !inQuotes; }
        else if (char === ',' && !inQuotes) { values.push(current.trim()); current = ''; }
        else { current += char; }
      }
      values.push(current.trim());
      return headers.reduce((obj, h, i) => ({ ...obj, [h]: values[i] || '' }), {});
    }),
  };
}