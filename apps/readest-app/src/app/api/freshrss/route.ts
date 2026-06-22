import { NextRequest, NextResponse } from 'next/server';

// Server-side proxy to a FreshRSS GReader API. Keeps the user's API password /
// auth token server-side and sidesteps CORS. Trust model mirrors the existing
// OPDS proxy (src/app/api/opds/proxy): the authenticated app user supplies the
// target host (their own FreshRSS), and we only enforce an http(s) scheme.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(request: NextRequest) {
  let payload: { url?: string; method?: 'GET' | 'POST'; auth?: string; body?: string };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400, headers: CORS });
  }

  const { url, method = 'GET', auth, body } = payload;
  if (!url || typeof url !== 'string') {
    return NextResponse.json({ error: 'missing url' }, { status: 400, headers: CORS });
  }

  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return NextResponse.json({ error: 'bad url' }, { status: 400, headers: CORS });
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return NextResponse.json({ error: 'bad scheme' }, { status: 400, headers: CORS });
  }

  const headers = new Headers();
  if (auth) headers.set('Authorization', `GoogleLogin auth=${auth}`);
  if (method === 'POST') headers.set('Content-Type', 'application/x-www-form-urlencoded');

  try {
    const upstream = await fetch(target.toString(), {
      method,
      headers,
      body: method === 'POST' ? (body ?? '') : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: { ...CORS, 'Content-Type': upstream.headers.get('content-type') ?? 'text/plain' },
    });
  } catch (e) {
    return NextResponse.json({ error: `upstream fetch failed: ${String(e)}` }, { status: 502, headers: CORS });
  }
}
