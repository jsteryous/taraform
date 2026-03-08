// ─────────────────────────────────────────────
// Default config used when a client has none set
// ─────────────────────────────────────────────

export const LAND_CONFIG = {
    type: 'land',
    terminology: { contact: 'Contact', contacts: 'Contacts' },
    statuses: [
      { value: 'New Lead',           color: '#6b7280' },
      { value: 'Contacted',          color: '#3b82f6' },
      { value: 'Offer Made',         color: '#f59e0b' },
      { value: 'Offer Rejected/NFS', color: '#a855f7' },
      { value: 'UC',                 color: '#10b981' },
      { value: 'Closed',             color: '#059669' },
      { value: 'Dead/Pass',          color: '#ef4444' },
    ],
    statsPills: [
      { label: 'total',          status: null,         color: 'var(--text)' },
      { label: 'offers',         status: 'Offer Made', color: '#fbbf24' },
      { label: 'under contract', status: 'UC',         color: '#34d399' },
      { label: 'closed',         status: 'Closed',     color: '#10b981' },
    ],
    tabs: ['notes', 'sms', 'offers'],
    visibleFields: ['county', 'taxMapIds', 'ownerAddress', 'propertyAddresses'],
    listColumns: ['name', 'phone', 'county', 'status'],
  };
  
  export const RESTAURANT_CONFIG = {
    type: 'restaurant',
    terminology: { contact: 'Customer', contacts: 'Customers' },
    statuses: [
      { value: 'New',      color: '#6b7280' },
      { value: 'Regular',  color: '#3b82f6' },
      { value: 'VIP',      color: '#f59e0b' },
      { value: 'Inactive', color: '#ef4444' },
    ],
    statsPills: [
      { label: 'total',    status: null,      color: 'var(--text)' },
      { label: 'regular',  status: 'Regular', color: '#60a5fa' },
      { label: 'vip',      status: 'VIP',     color: '#fbbf24' },
      { label: 'inactive', status: 'Inactive',color: '#f87171' },
    ],
    tabs: ['notes', 'sms'],
    visibleFields: [],
    listColumns: ['name', 'phone', 'status'],
  };
  
  export const GENERIC_CONFIG = {
    type: 'generic',
    terminology: { contact: 'Contact', contacts: 'Contacts' },
    statuses: [
      { value: 'New Lead',   color: '#6b7280' },
      { value: 'Contacted',  color: '#3b82f6' },
      { value: 'Interested', color: '#f59e0b' },
      { value: 'Converted',  color: '#10b981' },
      { value: 'Dead',       color: '#ef4444' },
    ],
    statsPills: [
      { label: 'total',     status: null,        color: 'var(--text)' },
      { label: 'interested',status: 'Interested', color: '#fbbf24' },
      { label: 'converted', status: 'Converted',  color: '#34d399' },
    ],
    tabs: ['notes', 'sms'],
    visibleFields: [],
    listColumns: ['name', 'phone', 'status'],
  };
  
  export const PRESET_TYPES = [
    { value: 'land',       label: '🌲 Land Acquisition' },
    { value: 'restaurant', label: '🍽️  Restaurant / Hospitality' },
    { value: 'generic',    label: '📋 General Marketing' },
  ];
  
  const PRESETS = { land: LAND_CONFIG, restaurant: RESTAURANT_CONFIG, generic: GENERIC_CONFIG };
  
  // Merge saved client config with defaults so missing keys always fall back cleanly
  export function resolveConfig(client) {
    if (!client) return LAND_CONFIG;
    const base = PRESETS[client.config?.type] || LAND_CONFIG;
    if (!client.config) return base;
    return {
      ...base,
      ...client.config,
      statuses:    client.config.statuses    || base.statuses,
      statsPills:  client.config.statsPills  || base.statsPills,
      tabs:        client.config.tabs        || base.tabs,
      visibleFields: client.config.visibleFields ?? base.visibleFields,
      listColumns: client.config.listColumns || base.listColumns,
      terminology: { ...base.terminology, ...(client.config.terminology || {}) },
    };
  }
  
  // For bar/badge color lookup by status value
  export function getStatusColor(config, statusValue) {
    const s = config.statuses.find(s => s.value === statusValue);
    return s?.color || '#6b7280';
  }