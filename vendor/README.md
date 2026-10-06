# Vendored, security-patched packages

## braces 3.0.3-nib.1

- **Why:** GHSA-vfj7-8cjw-p6xm (high, CVSS 7.5). braces ≤ 3.0.3 walks its AST recursively with
  no depth limit, so a short, deeply nested pattern (e.g. `{a,{a,{a,…}}}`) throws an uncaught
  `RangeError` and kills the process. There is **no patched upstream release** (3.0.3 is latest).
  It reaches us via tailwindcss (chokidar, micromatch) and eslint-config-next (fast-glob).
- **Patch:** `braces/lib/parse.js` rejects patterns nested deeper than `MAX_DEPTH` (100,
  in `lib/constants.js`) with a `SyntaxError` — the same way braces already rejects inputs over
  `MAX_LENGTH`. Output for every pattern below that depth is identical to upstream 3.0.3.
- **Wiring:** `package.json` → `devDependencies.braces: file:vendor/braces-3.0.3-nib.1.tgz` and
  `overrides.braces: "$braces"` (npm resolves relative `file:` paths in overrides from each
  dependent's folder, so the override must reference the root dependency).
- **To change the patch:** edit `vendor/braces/`, bump `version` there, run
  `npm pack ./vendor/braces --pack-destination vendor`, update the tgz name in `package.json`,
  `npm install`.
- **Remove** this once micromatch/braces publish a fixed version: delete `vendor/braces*`, the
  `braces` devDependency and the override, then `npm install`.
