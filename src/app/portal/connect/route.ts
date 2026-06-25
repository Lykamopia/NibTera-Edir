import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { resolvePayResumePath } from '@/lib/nib-pay-session';
import { NIB_CONFIG } from '@/lib/nib-config';
import { debugLog } from '@/lib/debug';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) { return handleRequest(request); }
export async function POST(request: Request) { return handleRequest(request); }

async function handleRequest(request: Request) {
  const requestId = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  try {
    let authHeader = request.headers.get('Authorization') || request.headers.get('authorization');

    if (!authHeader && request.method === 'POST') {
      try {
        const body = await request.clone().json();
        if (body?.token) authHeader = `Bearer ${body.token}`;
      } catch { /* no body */ }
    }
    if (!authHeader) {
      const url = new URL(request.url);
      const q = url.searchParams.get('token') || url.searchParams.get('Authorization');
      if (q) authHeader = q.startsWith('Bearer ') ? q : `Bearer ${q}`;
    }
    if (!authHeader && NIB_CONFIG.MOCK_TOKEN) authHeader = `Bearer ${NIB_CONFIG.MOCK_TOKEN}`;

    if (!authHeader) {
      return NextResponse.json({ status: 'error', message: 'Authorization required' }, { status: 401 });
    }

    const token = authHeader.replace(/^Bearer\s+/i, '').trim();

    const validate = await fetch(NIB_CONFIG.VALIDATE_TOKEN_URL, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!validate.ok) {
      debugLog(`[PORTAL] [${requestId}] token validation failed`, validate.status);
      return NextResponse.json({ status: 'error', message: 'Token validation failed' }, { status: 401 });
    }
    const result = await validate.json();
    const phoneNumber = result.phone;

    const cookieStore = await cookies();
    const cookieOpts = { path: '/', httpOnly: true, secure: true, sameSite: 'none' as const, maxAge: 60 * 60 };
    cookieStore.set('miniapp_token', token, cookieOpts);
    cookieStore.set('miniapp_phone', phoneNumber || '', cookieOpts);

    const url = new URL(request.url);
    const resumePath = resolvePayResumePath(cookieStore.get('nib_payment_handoff')?.value, cookieStore.get('last_searched_path')?.value);
    let redirectUrl = resumePath ? `${url.protocol}//${url.host}${resumePath}` : `${url.protocol}//${url.host}/pay`;
    if (!resumePath && phoneNumber) redirectUrl += `?phone=${encodeURIComponent(phoneNumber)}`;

    return NextResponse.redirect(redirectUrl);
  } catch (error) {
    console.error('[PORTAL] unexpected error', error);
    return NextResponse.json({ status: 'error', message: 'Internal server error' }, { status: 500 });
  }
}
