/**
 * Encrypt existing data at rest with DATA_ENCRYPTION_KEY (AES-256-GCM).
 *
 *   npx tsx scripts/migrate-data-encryption.ts           # dry run (report only)
 *   npx tsx scripts/migrate-data-encryption.ts --apply   # encrypt in place
 *
 * 1. Files in uploads/documents and uploads/rules:
 *    - already encrypted (v2)       → tag verified, left untouched
 *    - plain PDF / image            → encrypted (only if its bytes really are
 *                                     the type its extension says)
 *    - anything else                → reported, never modified
 *    Writes are atomic (temp file + rename).
 * 2. Member.nationalId: plain values are encrypted; encrypted ones are verified.
 *
 * Idempotent — safe to re-run. Run it with the same DATA_ENCRYPTION_KEY the app
 * uses; losing that key makes the encrypted data unrecoverable.
 */
import 'dotenv/config';
import { readdir, readFile, writeFile, rename, stat } from 'fs/promises';
import { join, extname } from 'path';
import { PrismaClient } from '@prisma/client';
import { decryptFile, encryptFile, isEncryptedFile, encryptField, decryptField, isEncryptedField } from '../src/lib/encryption';
import { detectFileType } from '../src/lib/file-validation';

const apply = process.argv.includes('--apply');
const prisma = new PrismaClient();

async function migrateDir(kind: 'documents' | 'rules') {
  const dir = join(process.cwd(), 'uploads', kind);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    console.log(`[${kind}] no directory at ${dir} — skipped.`);
    return { ok: 0, encrypted: 0, failed: 0 };
  }
  const counts = { ok: 0, encrypted: 0, failed: 0 };
  for (const name of names) {
    const path = join(dir, name);
    if (!(await stat(path)).isFile() || name.endsWith('.tmp')) continue;
    const buf = await readFile(path);
    if (isEncryptedFile(buf)) {
      try { decryptFile(buf); counts.ok++; }
      catch (e) { console.error(`FAIL  ${kind}/${name}: authentication failed (${(e as Error).message})`); counts.failed++; }
      continue;
    }
    const detected = detectFileType(buf);
    if (!detected || !detected.extensions.includes(extname(name).toLowerCase())) {
      console.error(`SKIP  ${kind}/${name}: content does not match its extension — left untouched.`);
      counts.failed++;
      continue;
    }
    if (apply) {
      const tmp = `${path}.tmp`;
      await writeFile(tmp, encryptFile(buf));
      await rename(tmp, path);
    }
    counts.encrypted++;
    console.log(`${apply ? 'ENC ' : 'WOULD ENC'}  ${kind}/${name}`);
  }
  return counts;
}

async function migrateNationalIds() {
  const counts = { ok: 0, encrypted: 0, failed: 0 };
  const rows = await prisma.member.findMany({ where: { nationalId: { not: null } }, select: { id: true, nationalId: true } });
  for (const r of rows) {
    if (!r.nationalId) continue;
    if (isEncryptedField(r.nationalId)) {
      try { decryptField('Member.nationalId', r.nationalId); counts.ok++; }
      catch { console.error(`FAIL  Member ${r.id}: nationalId failed authentication`); counts.failed++; }
      continue;
    }
    if (apply) {
      await prisma.member.update({ where: { id: r.id }, data: { nationalId: encryptField('Member.nationalId', r.nationalId) } });
    }
    counts.encrypted++;
  }
  return counts;
}

async function main() {
  console.log(apply ? 'Applying data encryption…' : 'Dry run — no changes will be written (pass --apply).');
  const docs = await migrateDir('documents');
  const rules = await migrateDir('rules');
  const ids = await migrateNationalIds();
  console.log('\nSummary');
  console.log(`  documents : ${docs.encrypted} ${apply ? 'encrypted' : 'to encrypt'}, ${docs.ok} already encrypted, ${docs.failed} problems`);
  console.log(`  rules     : ${rules.encrypted} ${apply ? 'encrypted' : 'to encrypt'}, ${rules.ok} already encrypted, ${rules.failed} problems`);
  console.log(`  nationalId: ${ids.encrypted} ${apply ? 'encrypted' : 'to encrypt'}, ${ids.ok} already encrypted, ${ids.failed} problems`);
  if (docs.failed + rules.failed + ids.failed > 0) process.exitCode = 1;
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
