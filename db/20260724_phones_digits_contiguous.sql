-- 20260724_phones_digits_contiguous.sql
-- Fix phone search: make each number's digits contiguous in phones_digits.
--
-- Problem: 20260622_phone_search.sql generated phones_digits by replacing every
--   non-digit RUN with a space. Phones are stored formatted ("919-271-2902"),
--   so the separators INSIDE a number became internal spaces:
--     ["919-271-2902","(980) 207-2469"] -> " 919 271 2902 980 207 2469 "
--   A contiguous digit query ("9192712902", "2712902") could therefore never
--   match — only fragments that happened to fall inside one formatted segment
--   ("2902", "271") worked. This defeated the whole point of the column.
--
-- Fix: strip everything except digits and the commas separating jsonb array
--   elements, then turn the commas into spaces. Digits of one number stay
--   contiguous; a space still separates different numbers so a partial ilike
--   can't match across two numbers:
--     ["919-271-2902","(980) 207-2469"] -> " 9192712902 9802072469 "
--   (Formatted phones never contain commas — formatPhone emits only digits,
--   parens, spaces, and hyphens — so commas only ever mark element boundaries.)
--
-- A generated column's expression can't be altered in place, so drop & re-add
-- (re-populates every row) and rebuild the trigram index.

BEGIN;

DROP INDEX IF EXISTS idx_property_crm_contacts_phones_digits;
ALTER TABLE property_crm_contacts DROP COLUMN IF EXISTS phones_digits;

ALTER TABLE property_crm_contacts
  ADD COLUMN phones_digits text
  GENERATED ALWAYS AS (
    ' ' || replace(regexp_replace((phones)::text, '[^0-9,]+', '', 'g'), ',', ' ') || ' '
  ) STORED;

CREATE INDEX idx_property_crm_contacts_phones_digits
  ON property_crm_contacts USING gin (phones_digits gin_trgm_ops);

COMMIT;

-- Rollback: re-run the ADD COLUMN / CREATE INDEX block from
-- db/20260622_phone_search.sql after dropping this column + index.
