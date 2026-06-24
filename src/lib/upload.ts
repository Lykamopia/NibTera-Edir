'use client';

/** Upload a file to /api/upload and return its public path + name (or null on failure). */
export async function uploadFile(
  file: File,
  type: 'documents' | 'profile' | 'signatures' | 'logos' = 'documents',
): Promise<{ path: string; name: string } | null> {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('type', type);
  const res = await fetch('/api/upload', { method: 'POST', body: fd });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.success) return null;
  return { path: data.path, name: data.name ?? file.name };
}
