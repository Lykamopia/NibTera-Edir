/**
 * Re-encrypt stored signature files into the authenticated AES-256-GCM format.
 *
 *   npx tsx scripts/migrate-signature-encryption.ts           # dry run (report only)
 *   npx tsx scripts/migrate-signature-encryption.ts --apply   # re-encrypt in place
 *
 * For every file in uploads/signatures:
 *   - already GCM (v1)              → tag verified, left untouched
 *   - legacy AES-256-CBC (no MAC)   → decrypted, and only if the plaintext is a
 *                                     real image (magic bytes) re-encrypted as GCM
 *   - plain unencrypted image       → encrypted as GCM
 *   - anything else                 → reported, never modified
 *
 * Writes are atomic (temp file + rename). Run it with the same
 * SIGNATURE_ENCRYPTION_KEY the app uses, then set ENCRYPTION_ALLOW_LEGACY_CBC=false
 * so unauthenticated ciphertext is refused from then on.
 */
import 'dotenv/config';
import { readdir, readFile, writeFile, rename, stat } from 'fs/promises';
import { join } from 'path';
import { decryptBufferDetailed, encryptBuffer, isAuthenticatedFormat, DecryptionError } from '../src/lib/encryption';
import { detectFileType } from '../src/lib/file-validation';

const apply = process.argv.includes('--apply');
const dir = join(process.cwd(), 'uploads', 'signatures');

async function main() {
  // Legacy reads must be possible for the migration itself.
  process.env.ENCRYPTION_ALLOW_LEGACY_CBC = 'true';

  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    console.log(`No signatures directory at ${dir} — nothing to migrate.`);
    return;
  }

  const counts = { gcmOk: 0, fromCbc: 0, fromPlain: 0, failed: 0 };
  for (const name of names) {
    const path = join(dir, name);
    if (!(await stat(path)).isFile() || name.endsWith('.tmp')) continue;
    const buf = await readFile(path);

    let plaintext: Buffer | null = null;
    let kind: 'gcm' | 'cbc' | 'plain' | 'unknown' = 'unknown';
    if (isAuthenticatedFormat(buf)) {
      try { decryptBufferDetailed(buf); counts.gcmOk++; continue; }
      catch (e) { console.error(`FAIL  ${name}: GCM authentication failed (${(e as Error).message})`); counts.failed++; continue; }
    }
    try {
      const res = decryptBufferDetailed(buf);
      // CBC has no MAC: only trust a result that is a genuine image.
      if (detectFileType(res.data)?.mime.startsWith('image/')) { plaintext = res.data; kind = 'cbc'; }
    } catch (e) {
      if (!(e instanceof DecryptionError)) throw e;
    }
    if (!plaintext && detectFileType(buf)?.mime.startsWith('image/')) { plaintext = buf; kind = 'plain'; }

    if (!plaintext) {
      console.error(`FAIL  ${name}: neither valid legacy ciphertext nor a plain image — left untouched`);
      counts.failed++;
      continue;
    }

    if (apply) {
      const tmp = `${path}.tmp`;
      await writeFile(tmp, encryptBuffer(plaintext));
      await rename(tmp, path);
    }
    console.log(`${apply ? 'DONE ' : 'WOULD'} ${name}: ${kind} → aes-256-gcm`);
    if (kind === 'cbc') counts.fromCbc++; else counts.fromPlain++;
  }

  console.log(`\n${apply ? 'Migrated' : 'Dry run'}: ${counts.gcmOk} already GCM, ${counts.fromCbc} from CBC, ${counts.fromPlain} from plaintext, ${counts.failed} failed.`);
  if (!apply && counts.fromCbc + counts.fromPlain > 0) console.log('Re-run with --apply to re-encrypt.');
  if (apply && counts.failed === 0) console.log('All files are authenticated. Set ENCRYPTION_ALLOW_LEGACY_CBC=false.');
  if (counts.failed > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
