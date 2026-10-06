#!/usr/bin/env node
/**
 * VA-004 (Server Information Exposure) — remove the framework version string
 * that Next.js ships to every browser.
 *
 * Next's client bootstrap does `window.next = { version: "<x.y.z>", ... }`.
 * Fingerprinting tools (Wappalyzer, ZAP, Nuclei, …) read that global to report
 * the exact Next.js version and look up version-specific CVEs. Nothing in Next
 * or in this app reads it back, so it is blanked here.
 *
 * Version-agnostic (matches any `const version = "…";` in the known bootstrap
 * files), idempotent, and run from `postinstall` and `prebuild` so a fresh
 * `npm install` or an upgrade can never bring the string back. Exits non-zero
 * if a bootstrap file is missing so a Next.js layout change is noticed.
 */
const fs = require('fs');
const path = require('path');

const NEXT_DIR = path.join(__dirname, '..', 'node_modules', 'next', 'dist');
const FILES = [
  'client/app-bootstrap.js',
  'client/index.js',
  'esm/client/app-bootstrap.js',
  'esm/client/index.js',
];
const VERSION_DECL = /const version = "[^"]*";/g;

let changed = 0;
let missing = 0;
for (const rel of FILES) {
  const file = path.join(NEXT_DIR, rel);
  if (!fs.existsSync(file)) {
    console.warn(`[strip-framework-version] not found: ${rel}`);
    missing++;
    continue;
  }
  const src = fs.readFileSync(file, 'utf8');
  const out = src.replace(VERSION_DECL, 'const version = "";');
  if (out !== src) {
    fs.writeFileSync(file, out);
    changed++;
  }
}
console.log(`[strip-framework-version] blanked client version string in ${changed} file(s).`);
if (missing === FILES.length) process.exit(1);
