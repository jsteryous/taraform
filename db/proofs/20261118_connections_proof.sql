-- Role-simulation proof for db/20261118_connections.sql. Run as postgres (SQL editor or
-- the Supabase MCP). Safe on production: it builds its own throwaway users, workspaces
-- and contacts, and ALWAYS ends by raising an exception, which rolls everything back.
-- The exception message is the report: one line per check, then a PASS/FAIL count.
--
-- Actors: u1 + u2 are members of a throwaway banking workspace W1; u3 is a member of a
-- different workspace W2 only; u4 signed up and belongs to nothing; anon has no login.

do $proof$
declare
  w1 uuid := gen_random_uuid();  w2 uuid := gen_random_uuid();
  u1 uuid := gen_random_uuid();  u2 uuid := gen_random_uuid();
  u3 uuid := gen_random_uuid();  u4 uuid := gen_random_uuid();
  p1 bigint; p2 bigint; p3 bigint; p4 bigint; co1 bigint; q1 bigint; g1 bigint;
  t text[]; actor text; label text; q text; expect text; got text; n bigint;
  report text := ''; passes int := 0; fails int := 0;
  tests text[][] := array[
    -- actor, label, sql, expect ('rows:N' | 'ok' | 'val:X' | 'err:substring')
    ['u1','connection: insert, either order',      'insert into public.contact_connections (a_id,b_id,description) values ({P2},{P1},''college'')', 'rows:1'],
    ['u1','connection: stored sorted, stamped',     'select (a_id<b_id and client_id=''{W1}'' and created_by=''{U1}'')::text from public.contact_connections where description=''college''', 'val:true'],
    ['u1','connection: not to itself',              'insert into public.contact_connections (a_id,b_id) values ({P1},{P1})', 'err:itself'],
    ['u1','connection: not to a company',           'insert into public.contact_connections (a_id,b_id) values ({P1},{CO1})', 'err:two people'],
    ['u1','connection: not across workspaces',      'insert into public.contact_connections (a_id,b_id) values ({P1},{Q1})', 'err:not found'],
    ['u1','connection: client_id not writable',     'insert into public.contact_connections (client_id,a_id,b_id) values (''{W2}'',{P1},{P3})', 'err:permission denied'],
    ['u1','connection: referred_by must be a or b', 'insert into public.contact_connections (a_id,b_id,referred_by) values ({P1},{P3},{P2})', 'err:check constraint'],
    ['u1','familiarity: set own',                   'select public.set_familiarity({P2},''know_well'')', 'ok'],
    ['u1','familiarity: user_id not writable',      'insert into public.contact_familiarity (contact_id,user_id,level) values ({P3},''{U2}'',''met'')', 'err:permission denied'],
    ['u1','familiarity: not with a company',        'select public.set_familiarity({CO1},''met'')', 'err:person'],
    ['u1','group: no faith groups in a bank',       'insert into public.contact_groups (client_id,name,kind) values (''{W1}'',''Some Church'',''faith'')', 'err:faith'],
    ['u1','group: create',                          'insert into public.contact_groups (client_id,name,aliases,kind) values (''{W1}'','' Glen Club '',array['' GCC '','''',''glen club'',''GCC''],''club'')', 'rows:1'],
    ['u1','group: name trimmed, aliases cleaned',   'select name||''|''||aliases::text from public.contact_groups where client_id=''{W1}''', 'val:Glen Club|{GCC}'],
    ['u1','group: name unique per workspace',       'insert into public.contact_groups (client_id,name) values (''{W1}'',''glen club'')', 'err:duplicate'],
    ['u1','group: not in a workspace you are not in','insert into public.contact_groups (client_id,name) values (''{W2}'',''X'')', 'err:row-level security'],
    ['u1','group member: add a contact',            'insert into public.contact_group_members (group_id,contact_id) values ({G1},{P3})', 'rows:1'],
    ['u1','group member: add yourself',             'insert into public.contact_group_members (group_id,user_id) values ({G1},''{U1}'')', 'rows:1'],
    ['u1','group member: not a teammate',           'insert into public.contact_group_members (group_id,user_id) values ({G1},''{U2}'')', 'err:row-level security'],
    ['u1','ignored: add',                           'insert into public.finder_ignored (client_id,term) values (''{W1}'',''  LinkedIn '')', 'rows:1'],
    ['u1','ignored: lowercased and trimmed',        'select term from public.finder_ignored where client_id=''{W1}''', 'val:linkedin'],
    ['u1','note: write one',                        'insert into public.contact_notes (contact_id,body) values ({P1},''Lunch with P3'')', 'rows:1'],
    ['u1','connection: from a note',                'insert into public.contact_connections (a_id,b_id,source_note_id) values ({P3},{P1},(select id from public.contact_notes where body=''Lunch with P3''))', 'rows:1'],
    ['u1','connection: note must be on a or b',     'insert into public.contact_connections (a_id,b_id,source_note_id) values ({P2},{P3},(select id from public.contact_notes where body=''Lunch with P3''))', 'err:source note'],
    ['u1','ways_in: warm (you know them)',          'select public.contact_ways_in({P2})->>''warmth''', 'val:warm'],
    ['u1','ways_in: 1 intro away',                  'select public.contact_ways_in({P1})->>''warmth''', 'val:intro'],
    ['u1','ways_in: warmest connection first',      'select public.contact_ways_in({P1})->''connections''->0->>''contact_id''', 'val:{P2}'],
    ['u1','ways_in: connection quotes its note',    'select c->>''note_body'' from jsonb_array_elements(public.contact_ways_in({P1})->''connections'') c where c->>''contact_id''=''{P3}''', 'val:Lunch with P3'],
    ['u1','ways_in: common ground (shared group)',  'select public.contact_ways_in({P3})->>''warmth''', 'val:common'],
    ['u1','ways_in: group lists the teammate',      'select public.contact_ways_in({P3})->''groups''->0->''teammates''->>0', 'val:{U1}'],
    ['u1','ways_in: cold',                          'select public.contact_ways_in({P4})->>''warmth''', 'val:cold'],
    ['u1','ways_in: met counts as common ground',   'select public.set_familiarity({P4},''met''); select public.contact_ways_in({P4})->>''warmth''', 'val:common'],
    ['u1','ways_in: other workspace reads as NULL', 'select coalesce(public.contact_ways_in({Q1})::text,''NULL'')', 'val:NULL'],

    ['u2','familiarity: sees a teammate''s',        'select count(*)::text from public.contact_familiarity where user_id=''{U1}''', 'val:2'],
    ['u2','familiarity: cannot change a teammate''s','update public.contact_familiarity set level=''met'' where user_id=''{U1}''', 'rows:0'],
    ['u2','familiarity: cannot delete a teammate''s','delete from public.contact_familiarity where user_id=''{U1}''', 'rows:0'],
    ['u2','familiarity: set own beside it',         'select public.set_familiarity({P2},''met''); select count(*)::text from public.contact_familiarity where contact_id={P2}', 'val:2'],
    ['u2','familiarity: change own (upsert)',       'select public.set_familiarity({P2},''know''); select level from public.contact_familiarity where contact_id={P2} and user_id=''{U2}''', 'val:know'],
    ['u2','familiarity: clear own',                 'select public.set_familiarity({P2},null); select count(*)::text from public.contact_familiarity where contact_id={P2}', 'val:1'],
    ['u2','familiarity: teammate''s untouched',     'select level from public.contact_familiarity where contact_id={P2} and user_id=''{U1}''', 'val:know_well'],
    ['u2','group member: cannot remove a teammate', 'delete from public.contact_group_members where user_id=''{U1}''', 'rows:0'],
    ['u2','connection: any member may edit',        'update public.contact_connections set description=''college roommates'' where description=''college''', 'rows:1'],
    ['u2','connection: cannot re-point',            'update public.contact_connections set a_id={P3}', 'err:permission denied'],
    ['u2','setup: a note, a link, a group row',     'insert into public.contact_notes (contact_id,body) values ({P2},''u2 note''); insert into public.contact_links (company_id,person_id) values ({CO1},{P2}); insert into public.contact_group_members (group_id,user_id) values ({G1},''{U2}'')', 'ok'],

    ['u3','other workspace: reads nothing',         'select ((select count(*) from public.contact_connections)+(select count(*) from public.contact_familiarity)+(select count(*) from public.contact_groups)+(select count(*) from public.contact_group_members)+(select count(*) from public.finder_ignored))::text', 'val:0'],
    ['u3','other workspace: ways_in is NULL',       'select coalesce(public.contact_ways_in({P1})::text,''NULL'')', 'val:NULL'],
    ['u3','other workspace: cannot connect',        'insert into public.contact_connections (a_id,b_id) values ({P1},{P2})', 'err:not found'],
    ['u3','other workspace: cannot set familiarity','select public.set_familiarity({P1},''know'')', 'err:not found'],
    ['u3','other workspace: cannot add a group',    'insert into public.contact_groups (client_id,name) values (''{W1}'',''Y'')', 'err:row-level security'],
    ['u3','other workspace: cannot join its group', 'insert into public.contact_group_members (group_id,contact_id) values ({G1},{Q1})', 'err:group not found'],
    ['u3','other workspace: cannot add ignored',    'insert into public.finder_ignored (client_id,term) values (''{W1}'',''z'')', 'err:row-level security'],
    ['u3','other workspace: cannot edit',           'update public.contact_connections set unsure=true', 'rows:0'],
    ['u3','other workspace: cannot delete',         'delete from public.contact_connections', 'rows:0'],

    ['u4','fresh signup: reads nothing',            'select ((select count(*) from public.contact_connections)+(select count(*) from public.contact_familiarity)+(select count(*) from public.contact_groups)+(select count(*) from public.contact_group_members)+(select count(*) from public.finder_ignored))::text', 'val:0'],
    ['u4','fresh signup: ways_in is NULL',          'select coalesce(public.contact_ways_in({P1})::text,''NULL'')', 'val:NULL'],

    ['anon','anon: contact_connections',            'select count(*) from public.contact_connections', 'err:permission denied'],
    ['anon','anon: contact_familiarity',            'select count(*) from public.contact_familiarity', 'err:permission denied'],
    ['anon','anon: contact_groups',                 'select count(*) from public.contact_groups', 'err:permission denied'],
    ['anon','anon: contact_group_members',          'select count(*) from public.contact_group_members', 'err:permission denied'],
    ['anon','anon: finder_ignored',                 'select count(*) from public.finder_ignored', 'err:permission denied'],
    ['anon','anon: contact_ways_in',                'select public.contact_ways_in({P1})', 'err:permission denied'],
    ['anon','anon: set_familiarity',                'select public.set_familiarity({P1},''met'')', 'err:permission denied'],

    ['postgres','grants: anon executes nothing',    'select (has_function_privilege(''anon'',''public.contact_ways_in(bigint)'',''execute'') or has_function_privilege(''anon'',''public.set_familiarity(bigint,text)'',''execute'') or has_function_privilege(''anon'',''public.client_users_leave_cleanup()'',''execute'') or has_function_privilege(''authenticated'',''public.client_users_leave_cleanup()'',''execute''))::text', 'val:false'],
    ['postgres','grants: members execute both',     'select (has_function_privilege(''authenticated'',''public.contact_ways_in(bigint)'',''execute'') and has_function_privilege(''authenticated'',''public.set_familiarity(bigint,text)'',''execute''))::text', 'val:true'],
    ['postgres','grants: anon has no table access', 'select bool_or(has_table_privilege(''anon'', tb, pr))::text from unnest(array[''public.contact_connections'',''public.contact_familiarity'',''public.contact_groups'',''public.contact_group_members'',''public.finder_ignored'']) tb, unnest(array[''select'',''insert'',''update'',''delete'']) pr', 'val:false'],
    ['u1','note delete: author deletes it',         'delete from public.contact_notes where body=''Lunch with P3''', 'rows:1'],
    ['postgres','note delete: connection kept, quote gone','select (count(*)=1 and bool_and(source_note_id is null))::text from public.contact_connections where a_id=least({P1},{P3}) and b_id=greatest({P1},{P3})', 'val:true'],
    ['postgres','leaving: remove u1 from W1',       'delete from public.client_users where client_id=''{W1}'' and user_id=''{U1}''', 'rows:1'],
    ['postgres','leaving: u1 familiarity + groups gone','select ((select count(*) from public.contact_familiarity where user_id=''{U1}'')+(select count(*) from public.contact_group_members where user_id=''{U1}''))::text', 'val:0'],
    ['postgres','leaving: shared facts stay',       'select ((select count(*) from public.contact_connections where client_id=''{W1}'')+(select count(*) from public.contact_groups where client_id=''{W1}''))::text', 'val:3'],
    ['postgres','user delete: u2 (note, link, group)','delete from auth.users where id=''{U2}''', 'rows:1'],
    ['postgres','user delete: their note survives', 'select (author_id is null)::text from public.contact_notes where body=''u2 note''', 'val:true'],
    ['postgres','user delete: u1 (created rows)',   'delete from auth.users where id=''{U1}''', 'rows:1'],
    ['postgres','user delete: rows kept, author gone','select ((select count(*) from public.contact_connections where client_id=''{W1}'' and created_by is null)+(select count(*) from public.contact_groups where client_id=''{W1}'' and created_by is null))::text', 'val:3']
  ];
begin
  -- Fixtures, as postgres.
  insert into auth.users (id, aud, role, email)
  select u, 'authenticated', 'authenticated', 'proof-' || u || '@example.invalid'
    from unnest(array[u1, u2, u3, u4]) u;
  insert into public.clients (id, name, config) values
    (w1, 'proof bank', '{"type":"banking"}'::jsonb),
    (w2, 'proof other', '{"type":"land"}'::jsonb);
  insert into public.client_users (client_id, user_id, role) values
    (w1, u1, 'owner'), (w1, u2, 'member'), (w2, u3, 'owner');
  insert into public.property_crm_contacts (client_id, first_name, last_name) values (w1, 'Pat', 'One')   returning id into p1;
  insert into public.property_crm_contacts (client_id, first_name, last_name) values (w1, 'Pat', 'Two')   returning id into p2;
  insert into public.property_crm_contacts (client_id, first_name, last_name) values (w1, 'Pat', 'Three') returning id into p3;
  insert into public.property_crm_contacts (client_id, first_name, last_name) values (w1, 'Pat', 'Four')  returning id into p4;
  insert into public.property_crm_contacts (client_id, first_name, kind) values (w1, 'Proof LLC', 'company') returning id into co1;
  insert into public.property_crm_contacts (client_id, first_name, last_name) values (w2, 'Quinn', 'Other') returning id into q1;

  foreach t slice 1 in array tests loop
    actor := t[1]; label := t[2]; q := t[3]; expect := t[4];

    perform set_config('role', 'postgres', true);
    perform set_config('request.jwt.claims', '{}', true);
    if g1 is null then
      select g.id into g1 from public.contact_groups g where g.client_id = w1 and g.name = 'Glen Club';
    end if;

    q := replace(replace(replace(replace(q, '{W1}', w1::text), '{W2}', w2::text), '{U1}', u1::text), '{U2}', u2::text);
    q := replace(replace(replace(replace(q, '{P1}', p1::text), '{P2}', p2::text), '{P3}', p3::text), '{P4}', p4::text);
    q := replace(replace(replace(q, '{CO1}', co1::text), '{Q1}', q1::text), '{G1}', coalesce(g1::text, 'null'));
    expect := replace(replace(replace(expect, '{P2}', p2::text), '{P3}', p3::text), '{U1}', u1::text);

    if actor = 'anon' then
      perform set_config('role', 'anon', true);
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    elsif actor <> 'postgres' then
      perform set_config('role', 'authenticated', true);
      perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub',
        case actor when 'u1' then u1 when 'u2' then u2 when 'u3' then u3 else u4 end)::text, true);
    end if;

    begin
      if expect like 'val:%' then
        -- Multi-statement checks: run all but the last, then read the last.
        if position(';' in q) > 0 then
          execute left(q, length(q) - position(';' in reverse(q)));
          q := substr(q, length(q) - position(';' in reverse(q)) + 2);
        end if;
        execute q into got;
        got := 'val:' || coalesce(got, '<null>');
      else
        execute q;
        get diagnostics n = row_count;
        got := case when expect = 'ok' then 'ok' else 'rows:' || n end;
      end if;
    exception when others then
      got := 'err:' || sqlerrm;
    end;

    if (expect like 'err:%' and got like 'err:%' and position(substr(expect, 5) in got) > 0)
       or got = expect then
      passes := passes + 1;
      report := report || E'\nPASS  ' || actor || '  ' || label;
    else
      fails := fails + 1;
      report := report || E'\nFAIL  ' || actor || '  ' || label || '  expected ' || expect || '  got ' || got;
    end if;
  end loop;

  perform set_config('role', 'postgres', true);
  raise exception 'PROOF (rolled back): % passed, % failed%', passes, fails, report;
end
$proof$;
