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

All at-rest encryption is AES-256-GCM (authenticated). The application contains no
CBC code path: any stored file that is not valid GCM ciphertext, or whose
authentication tag fails, is refused (HTTP 422) and a CRITICAL
`FILE_INTEGRITY_FAILURE` security event is logged. No configuration required.

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

## Resource limits (DoS hardening)

| Resource | Limit | Where |
|---|---|---|
| Server Action body | 2 MB | `next.config.ts` → `experimental.serverActions.bodySizeLimit` |
| Upload body | largest per-kind cap (10 MB) + 1 MB multipart overhead, checked on `Content-Length` before buffering | `src/app/api/upload/route.ts` |
| Form fields | every string `.max()`-bounded; arrays only via `zArray`/`zIdList` | `src/lib/validation.ts` |
| Image processing | Next image optimizer disabled (`images.unoptimized`); no app code calls `sharp`; SVG never rasterized | `next.config.ts` |
| WebSocket | none exposed — every protocol upgrade gets `400` and the socket is closed (production) | `src/lib/upgrade-guard.ts` |
| SSE streams | 32 KB/frame, bounded URL, per-caller and global connection caps | `src/lib/sse.ts` |
| Disk | uploads store total cap, free-space floor, per-user rolling 24 h quota (`413/429/507`) | `src/lib/resource-limits.ts` |
| Memory | V8 heap capped at 1536 MB (`npm start`; `NODE_OPTIONS` on App Hosting) | `package.json`, `apphosting.yaml` |
| CPU / concurrency | App Hosting: 1 vCPU, 2048 MiB, 80 concurrent requests per instance | `apphosting.yaml` |

Disk thresholds are configurable (MB):

| Variable | Default | Meaning |
|---|---|---|
| `UPLOADS_MAX_TOTAL_MB` | 10240 | Max total size of `uploads/` |
| `UPLOADS_MIN_FREE_MB` | 1024 | Free space that must remain on the volume |
| `UPLOAD_USER_DAILY_MB` | 200 | Per-user upload allowance per rolling 24 h |

For self-hosted deployments, also cap the service at the OS level (e.g. systemd
`MemoryMax=2G`, `CPUQuota=100%`, or Docker `--memory 2g --cpus 1`) and put the
uploads directory on its own volume/quota so it cannot fill the system disk.

### Monitoring

- **Log monitor:** every `RESOURCE_MONITOR_INTERVAL_SEC` (default 60) the server logs
  `[resources] …` warnings when heap > 85 % of its limit, load average > CPU cores,
  free disk < 2 × `UPLOADS_MIN_FREE_MB`, or the uploads store > 90 % of its cap.
  Alert on that prefix in your log collector.
- **Health endpoint:** `GET /api/health` with `Authorization: Bearer $MONITORING_SECRET`
  returns memory / CPU / disk / DB figures; `200` when healthy, `503` when the DB is
  unreachable or any threshold is crossed. Disabled (`503`) until `MONITORING_SECRET`
  is set. Poll it from an uptime monitor every 1–5 minutes.

### Caching and Server Actions review

- No server data cache is used (`unstable_cache`, `'use cache'`, `force-cache`,
  route-level `revalidate` are absent); session-reading pages render dynamically, so
  one user's data can never be served from cache to another. `revalidatePath` calls
  only invalidate. Keep it that way, or follow the rule in `src/lib/tenant-scope.ts`
  (authorize first, key cached data by tenant).
- Sensitive responses (`/uploads/*`, `/api/signature`, `/api/csrf`, streams, health)
  send `Cache-Control: no-store`.
- Server Actions: 2 MB body cap; `serverActions.allowedOrigins` deliberately unset, so
  Next's Origin-vs-Host check accepts same-origin only; the host allowlist
  (`ALLOWED_HOSTS`) rejects spoofed Host headers; every action self-authenticates.
