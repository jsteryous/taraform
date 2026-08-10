-- Add a "Buyer" status: people who buy lots rather than sell them. Not a stage of
-- the seller pipeline, so it sits last in the list and stays out of `followUp.statuses`
-- (a buyer only surfaces in the follow-up queue via a manual follow_up_on date).
--
-- The status list normally comes from LAND_CONFIG in src/lib/clientConfig.js, so
-- clients with `config IS NULL` (Personal List, TRP) pick this up from the app with
-- no DB change. Table Rock Partners saved its own copy of `config.statuses` through
-- the Manage Clients editor, and a saved copy wins over the preset in resolveConfig()
-- -- so it needs the same entry appended explicitly. Applied 2026-08-10.
--
-- No constraint on property_crm_contacts.status, so nothing else to migrate.

update clients
set config = jsonb_set(
  config,
  '{statuses}',
  config->'statuses' || '[{"value":"Buyer","color":"#06b6d4"}]'::jsonb
)
where id = 'f3a69c31-8e40-4ea0-865a-d8bd9214376d'  -- Table Rock Partners
  and not (config->'statuses' @> '[{"value":"Buyer"}]'::jsonb);

-- To undo:
-- update clients
-- set config = jsonb_set(config, '{statuses}',
--   (select jsonb_agg(s) from jsonb_array_elements(config->'statuses') s
--    where s->>'value' <> 'Buyer'))
-- where id = 'f3a69c31-8e40-4ea0-865a-d8bd9214376d';
