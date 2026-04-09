#!/usr/bin/env node
/**
 * check-css.mjs
 *
 * Audits className references across all JSX/JS files against class definitions
 * in src/index.css. Reports:
 *   - Classes used in JSX but not defined in CSS  (exit 1 — these are bugs)
 *   - Classes defined in CSS but not found in JSX (informational — may be dead)
 *
 * Usage:  node scripts/check-css.mjs
 * Flags:  --missing-only   Skip the dead-CSS section
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname, relative } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..');
const SRC       = join(ROOT, 'src');
const CSS_FILE  = join(SRC, 'index.css');
const MISSING_ONLY = process.argv.includes('--missing-only');

// ─── Classes that are genuinely dynamic (built at runtime from data) ──────────
// Script can't know the full set of generated names — suppress false positives.
const DYNAMIC_PREFIXES = [
  'status-',  // getStatusClass() generates e.g. status-new-lead
  'sms-',     // sms-${contact.smsStatus} generates e.g. sms-do-not-contact
];

// Applied to <body> or <html> by JS, never appear in JSX className
const APPLIED_TO_BODY = new Set(['theme-light', 'theme-dark']);

// ─── Helpers ──────────────────────────────────────────────────────────────────
function isValidClassName(str) {
  // Must start with a letter, contain only letters/digits/hyphens (no underscores),
  // and not end with a hyphen (filters partial dynamic prefixes like "sms-")
  return /^[a-zA-Z][a-zA-Z\d-]*[a-zA-Z\d]$|^[a-zA-Z\d]$/.test(str);
}

function isDynamic(cls) {
  return DYNAMIC_PREFIXES.some(p => cls.startsWith(p)) || APPLIED_TO_BODY.has(cls);
}

function splitAndAdd(str, target, file) {
  for (const cls of str.trim().split(/\s+/)) {
    if (cls && isValidClassName(cls) && !isDynamic(cls)) {
      if (!target.has(cls)) target.set(cls, new Set());
      target.get(cls).add(file);
    }
  }
}

// ─── Extract all class selectors defined in CSS ───────────────────────────────
function extractCssClasses(css) {
  const classes = new Set();
  // Only match selectors that start with a letter — avoids matching numeric
  // values like 0.5rem, 0.02em, etc. which also contain a dot.
  const re = /\.([a-zA-Z][a-zA-Z\d-]*)/g;
  let m;
  while ((m = re.exec(css)) !== null) {
    classes.add(m[1]);
  }
  return classes;
}

// ─── Extract statically-knowable className values from a JSX/JS file ─────────
function extractUsedClasses(src, filePath, target) {
  function add(str) { splitAndAdd(str, target, filePath); }

  function extractFromExpr(expr) {
    // Strip comparison operands — e.g. `entry.type === 'offer'` should not
    // yield 'offer' as a class name. Remove strings that are the RHS/LHS of
    // === !== == != so only ternary result values remain.
    const stripped = expr
      .replace(/[!=]=+\s*['"][^'"]*['"]/g, '')  // after === or !==
      .replace(/['"][^'"]*['"]\s*[!=]=+/g, ''); // before === or !==
    const qRe = /['"]([^'"]*)['"]/g;
    let m;
    while ((m = qRe.exec(stripped)) !== null) add(m[1]);
  }

  let m;

  // 1. className="foo bar"  or  className='foo bar'
  const staticRe = /className=["']([^"']+)["']/g;
  while ((m = staticRe.exec(src)) !== null) add(m[1]);

  // 2. className={`template ${expr} literal`}
  const tplRe = /className=\{`([\s\S]*?)`\}/g;
  while ((m = tplRe.exec(src)) !== null) {
    const tpl = m[1];
    // Static string fragments between ${...} interpolations
    for (const part of tpl.split(/\$\{[^}]+\}/)) add(part);
    // String literals inside ${...} (ternary branches, etc.)
    const exprRe = /\$\{([^}]+)\}/g;
    let em;
    while ((em = exprRe.exec(tpl)) !== null) extractFromExpr(em[1]);
  }

  // 3. className={expr}  — non-template brace expressions
  //    Catches: className={cond ? 'foo' : 'bar'}, className={'foo bar'}
  //    The [^`] guard avoids re-matching template literals already handled above.
  const exprRe = /className=\{([^`\n][^}]*)\}/g;
  while ((m = exprRe.exec(src)) !== null) extractFromExpr(m[1]);
}

// ─── Walk src directory for JSX/JS files ─────────────────────────────────────
function collectFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...collectFiles(full));
    } else if (['.jsx', '.js'].includes(extname(entry))) {
      files.push(full);
    }
  }
  return files;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
const css     = readFileSync(CSS_FILE, 'utf-8');
const defined = extractCssClasses(css);

// Map<className → Set<filePath>>
const used = new Map();
for (const file of collectFiles(SRC)) {
  extractUsedClasses(readFileSync(file, 'utf-8'), relative(ROOT, file), used);
}

// Missing: in JSX but not in CSS
const missing = [...used.entries()]
  .filter(([cls]) => !defined.has(cls))
  .sort(([a], [b]) => a.localeCompare(b));

// Dead: in CSS but not in JSX (informational only)
const usedSet = new Set(used.keys());
const dead = [...defined]
  .filter(cls => !usedSet.has(cls) && !isDynamic(cls) && !APPLIED_TO_BODY.has(cls))
  .sort();

// ─── Output ───────────────────────────────────────────────────────────────────
let exitCode = 0;

if (missing.length > 0) {
  exitCode = 1;
  console.log(`\n❌  ${missing.length} class(es) used in JSX but not defined in CSS:\n`);
  for (const [cls, files] of missing) {
    console.log(`  .${cls}`);
    for (const f of [...files].sort()) console.log(`    ↳ ${f}`);
  }
}

if (!MISSING_ONLY && dead.length > 0) {
  console.log(`\n⚠️   ${dead.length} class(es) defined in CSS with no JSX reference (may be dead):\n`);
  // Print in columns of 4 for readability
  const col = 30;
  for (let i = 0; i < dead.length; i += 4) {
    console.log('  ' + dead.slice(i, i + 4).map(c => (`.${c}`).padEnd(col)).join(''));
  }
}

if (missing.length === 0) {
  console.log(`\n✅  No missing CSS classes — all JSX className references are defined.\n`);
}

process.exit(exitCode);
