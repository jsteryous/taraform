import { supabase } from './supabase';

// Groups: clubs, schools, teams, boards, interests (PLAN.md, Connections & Ways In;
// db/20261118_connections.sql). A group belongs to a workspace and any member may
// create, rename or delete it. Membership is either a contact ("they're in it") or a
// teammate ("Your groups"); a teammate row can only be your own, which the database
// enforces. Same-workspace checks and stamping are triggers, not code here.

export const GROUP_KINDS = [
  { value: 'club',     label: 'Club' },
  { value: 'school',   label: 'School' },
  { value: 'faith',    label: 'Faith' },
  { value: 'interest', label: 'Interest' },
  { value: 'other',    label: 'Other' },
];

// Faith groups stay off in banking workspaces until compliance answers (PLAN.md). The
// database refuses them too; this keeps the choice from being offered at all.
export function kindOptions(cfg) {
  return GROUP_KINDS.filter(k => !(k.value === 'faith' && cfg?.type === 'banking'));
}

export function kindLabel(kind) {
  return GROUP_KINDS.find(k => k.value === kind)?.label || 'Other';
}

// "GCC, Glen CC" → ['GCC', 'Glen CC']. Trimmed, blanks and repeats (any case) dropped,
// and the group's own name left out. The trigger does the same; doing it here too keeps
// the form honest about what will be saved.
export function parseAliases(text, name = '') {
  const seen = new Set([name.trim().toLowerCase()]);
  const out = [];
  for (const raw of String(text || '').split(',')) {
    const a = raw.trim().replace(/\s+/g, ' ');
    if (!a || seen.has(a.toLowerCase())) continue;
    seen.add(a.toLowerCase());
    out.push(a);
  }
  return out;
}

// A group name typed into a picker that matches an existing group, by name or alias.
export function findGroupByName(groups, text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return null;
  return groups.find(g => g.name.toLowerCase() === t || g.aliases.some(a => a.toLowerCase() === t)) || null;
}

function friendly(error) {
  if (error?.code === '23505') return new Error('A group with that name already exists.');
  return error;
}

// Every group in the workspace, with who is in it. `mine` is whether the signed-in user
// has put themselves in it.
export async function fetchGroups(clientId, userId) {
  if (!clientId) return [];
  const { data, error } = await supabase
    .from('contact_groups')
    .select('id,name,aliases,kind,members:contact_group_members(contact_id,user_id)')
    .eq('client_id', clientId)
    .order('name');
  if (error) throw error;
  return (data || []).map(g => {
    const members = g.members || [];
    const teammates = members.filter(m => m.user_id).map(m => m.user_id);
    return {
      id: g.id,
      name: g.name,
      aliases: g.aliases || [],
      kind: g.kind,
      contactCount: members.filter(m => m.contact_id).length,
      contactIds: members.filter(m => m.contact_id).map(m => m.contact_id),
      teammates,
      mine: !!userId && teammates.includes(userId),
    };
  });
}

export async function createGroup(clientId, { name, kind = 'other', aliases = [] }) {
  const { data, error } = await supabase
    .from('contact_groups')
    .insert({ client_id: clientId, name: name.trim(), kind, aliases })
    .select('id,name,aliases,kind')
    .single();
  if (error) throw friendly(error);
  return data;
}

export async function updateGroup(id, { name, kind, aliases }) {
  const { error } = await supabase
    .from('contact_groups')
    .update({ name: name.trim(), kind, aliases })
    .eq('id', id);
  if (error) throw friendly(error);
}

export async function deleteGroup(id) {
  const { error } = await supabase.from('contact_groups').delete().eq('id', id);
  if (error) throw error;
}

// Put yourself in a group, or take yourself out.
export async function joinGroup(groupId, userId) {
  const { error } = await supabase.from('contact_group_members').insert({ group_id: groupId, user_id: userId });
  if (error && error.code !== '23505') throw error;
}

export async function leaveGroup(groupId, userId) {
  const { error } = await supabase.from('contact_group_members').delete()
    .eq('group_id', groupId).eq('user_id', userId);
  if (error) throw error;
}

// Put a contact in a group, or take them out. Returns false when they were already in it.
// sourceNoteId: the note that named the group (the note finder).
export async function addContactToGroup(groupId, contactId, sourceNoteId = null) {
  const { error } = await supabase.from('contact_group_members')
    .insert({ group_id: groupId, contact_id: contactId, ...(sourceNoteId ? { source_note_id: sourceNoteId } : {}) });
  if (error?.code === '23505') return false;
  if (error) throw error;
  return true;
}

export async function removeContactFromGroup(groupId, contactId) {
  const { error } = await supabase.from('contact_group_members').delete()
    .eq('group_id', groupId).eq('contact_id', contactId);
  if (error) throw error;
}

// A first guess at a new group's kind from its name, for the create form to start on.
// Only a guess: the person picks. Never guesses a kind the workspace doesn't offer.
const KIND_WORDS = [
  ['school',   /\b(school|university|college|academy|institute|high|elementary|alumni|class of)\b/i],
  ['club',     /\b(club|cc|country club|golf|lodge|rotary|lions|kiwanis|association|society|chamber)\b/i],
  ['faith',    /\b(church|parish|chapel|synagogue|temple|mosque|ministry|congregation|fellowship)\b/i],
];

// A name that reads as a church, synagogue, etc. In a banking workspace the note finder
// must not offer to make a group of it under another kind (PLAN.md, compliance questions).
export function isFaithName(name) {
  return KIND_WORDS.find(([k]) => k === 'faith')[1].test(name || '');
}

export function guessKind(name, cfg) {
  const allowed = new Set(kindOptions(cfg).map(k => k.value));
  for (const [kind, re] of KIND_WORDS) {
    if (re.test(name || '') && allowed.has(kind)) return kind;
  }
  return 'other';
}
