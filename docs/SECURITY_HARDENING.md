# Security hardening — deployment notes

These complement the in-app fixes. Items marked **Ops** must be done on the server.

## VA-004 — Server information exposure

In the app (automatic):
- `src/lib/response-header-guard.ts` strips `Server`, `X-Powered-By`, `x-nextjs-cache`,
  `x-nextjs-matched-path`, `x-nextjs-deployment-id` from every Node response.
- `scripts/strip-framework-version.cjs` (runs on `postinstall` and `prebuild`) blanks the
  Next.js version string that would otherwise ship to browsers as `window.next.version`.

**Ops** — whatever sits in front of the app (reverse proxy / load balancer) adds its own
`Server` header with a version. Turn it off there:

| Front end | Setting |
|---|---|
| nginx | `server_tokens off;` (and with headers-more: `more_clear_headers Server;`) |
| Apache | `ServerTokens Prod` + `ServerSignature Off` |
| IIS | `<security><requestFiltering removeServerHeader="true" /></security>` and remove `X-Powered-By` under `<httpProtocol><customHeaders>` |
| F5 / other LB | strip/override the `Server` response header in the HTTP profile |

Verify: `curl -sI https://<host>/login` must show no `Server` / `X-Powered-By` header.

## VA-006 — Concurrent sessions

One active session per user: a new sign-in revokes all other sessions; logout revokes
all of the user's sessions. `src/proxy.ts` checks the session row in the database on
every request. No configuration required.

## VA-030 — Cipher without integrity protection

All encryption is AES-256-GCM. Legacy AES-CBC ciphertext is **refused by default**.
**Ops**, once per environment that has signature files from older releases:

```
npx tsx scripts/migrate-signature-encryption.ts          # dry run
npx tsx scripts/migrate-signature-encryption.ts --apply  # re-encrypt to GCM
```

Remove any `ENCRYPTION_ALLOW_LEGACY_CBC=true` from the environment.

## Dependencies

`next@16.3.8` (≥ 16.1.7 required) and `nodemailer@10.0.15` (≥ 10.0.9 required).
Verify on the server: `npm ls next nodemailer`.
