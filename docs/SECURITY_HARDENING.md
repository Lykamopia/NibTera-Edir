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

## Application-level encryption of sensitive data

| Data | Protection |
|---|---|
| Signature images | AES-256-GCM, `SIGNATURE_ENCRYPTION_KEY` (above) |
| Uploaded documents (`uploads/documents`, `uploads/rules` — ID scans, receipts, agreements) | AES-256-GCM, `DATA_ENCRYPTION_KEY` (HKDF sub-key "files") |
| `Member.nationalId` | AES-256-GCM per value, `DATA_ENCRYPTION_KEY` (HKDF sub-key "fields"), column name bound as AAD |
| Password-reset / set-password tokens | stored only as SHA-256 hash; raw token exists only in the emailed link |
| Passwords | bcrypt (unchanged) |

Files are decrypted only by `src/app/uploads/[...path]` after its authorization check
and are served `Cache-Control: private, no-store`. Tampered ciphertext is refused (422)
and logged as a CRITICAL `FILE_INTEGRITY_FAILURE`.

**Ops**, once per environment:

1. Set `DATA_ENCRYPTION_KEY` (≥ 32 chars, e.g. `openssl rand -hex 32`) — a value
   **different** from `SIGNATURE_ENCRYPTION_KEY`. Store it in the secrets manager and
   back it up: losing it makes encrypted documents and national IDs unrecoverable.
2. `npx prisma migrate deploy` (adds the `Upload` registry table).
3. `npx tsx scripts/migrate-data-encryption.ts` (dry run), then `--apply` to encrypt
   existing documents / rules files and national IDs. Re-runnable.

Set-password links issued before this release stop working (only hashes are matched
now); affected users simply request a new link.

## Upload ownership (file references in forms)

`/api/upload` records every accepted file in the `Upload` table (owner, detected type,
sanitized name). Server Actions accept a file path only if the **same user** uploaded it,
as the expected kind, and take the file name/type from that record — a tampered request
can neither attach another user's file nor relabel a PDF as `something.exe`.

## Dependencies

`next@16.3.8` (≥ 16.1.7 required) and `nodemailer@10.0.15` (≥ 10.0.9 required).
Verify on the server: `npm ls next nodemailer`.
