import { NextRequest, NextResponse } from 'next/server';
import { tryGetActor } from '@/lib/tenant-scope';

export async function GET(request: NextRequest) {
  // Authenticate in the handler itself — not only via the middleware matcher —
  // and BEFORE the cached upstream fetch below, so the shared (non-user-specific)
  // geocoding cache is only reachable by signed-in users.
  if (!(await tryGetActor())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }
  const q = request.nextUrl.searchParams.get('q');
  if (!q || q.trim().length < 2) {
    return NextResponse.json([]);
  }

  try {
    // Ethiopia bounding box: roughly lat 3–15, lon 33–48
    const params = new URLSearchParams({
      q: q.trim(),
      format: 'json',
      limit: '8',
      addressdetails: '1',
      countrycodes: 'et',
      'accept-language': 'en',
      viewbox: '33,3,48,15',
      bounded: '0',
    });

    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?${params.toString()}`,
      {
        headers: {
          'User-Agent': 'NIBDigitalAttendance/1.0 (nibpmo10@gmail.com)',
          'Accept-Language': 'en',
          Referer: 'https://nibdigitalattendance.com',
        },
        next: { revalidate: 60 },
      }
    );

    if (!res.ok) {
      return NextResponse.json([]);
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json([]);
  }
}
