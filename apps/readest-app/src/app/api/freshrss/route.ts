import { NextRequest, NextResponse } from 'next/server';

// Server-side proxy to a FreshRSS GReader API. All connection details live in
// server-side env vars and never reach the browser or the client JS bundle:
//
//   FRESHRSS_URL           e.g. https://rss.example.com
//   FRESHRSS_USERNAME      the GReader API username
//   FRESHRSS_API_PASSWORD  the GReader API password
//
// The client sends a RELATIVE GReader path (e.g. "/reader/api/0/tag/list");
// this route builds the absolute URL from FRESHRSS_URL (so it can only ever
// reach the configured host — no open proxy) and injects the credentials on
// the ClientLogin request. This keeps the connection working on any device
// regardless of browser-storage eviction, since nothing is persisted client-side.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const trimSlash = (s: string) => s.replace(/\/+$/, '');

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(request: NextRequest) {
  const serverUrl = process.env['FRESHRSS_URL'];
  const username = process.env['FRESHRSS_USERNAME'];
  const apiPassword = process.env['FRESHRSS_API_PASSWORD'];
  if (!serverUrl || !username || !apiPassword) {
    return NextResponse.json(
      { error: 'FreshRSS is not configured on the server (set FRESHRSS_URL, FRESHRSS_USERNAME, FRESHRSS_API_PASSWORD)' },
      { status: 501, headers: CORS },
    );
  }

  let payload: { path?: string; method?: 'GET' | 'POST'; auth?: string; body?: string };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400, headers: CORS });
  }

  const { path, method = 'GET', auth, body } = payload;
  // Relative path only — reject anything that could redirect off-host.
  if (
    !path ||
    typeof path !== 'string' ||
    !path.startsWith('/') ||
    path.startsWith('//') ||
    path.includes('://') ||
    path.includes('..')
  ) {
    return NextResponse.json({ error: 'bad path' }, { status: 400, headers: CORS });
  }

  const endpointBase = `${trimSlash(serverUrl)}/api/greader.php`;
  let target: URL;
  try {
    target = new URL(endpointBase + path);
  } catch {
    return NextResponse.json({ error: 'bad url' }, { status: 400, headers: CORS });
  }
  // Belt-and-braces: the resolved target must stay on the configured host.
  if (target.host !== new URL(endpointBase).host) {
    return NextResponse.json({ error: 'host not allowed' }, { status: 400, headers: CORS });
  }

  // Inject server-side credentials on login; everything else carries the
  // client-held auth token from a prior login.
  const isLogin = path.startsWith('/accounts/ClientLogin');
  const outMethod: 'GET' | 'POST' = isLogin ? 'POST' : method;
  const outBody = isLogin
    ? new URLSearchParams({ Email: username, Passwd: apiPassword }).toString()
    : body;

  const headers = new Headers();
  if (auth) headers.set('Authorization', `GoogleLogin auth=${auth}`);
  if (outMethod === 'POST') headers.set('Content-Type', 'application/x-www-form-urlencoded');

  try {
    const upstream = await fetch(target.toString(), {
      method: outMethod,
      headers,
      body: outMethod === 'POST' ? (outBody ?? '') : undefined,
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
