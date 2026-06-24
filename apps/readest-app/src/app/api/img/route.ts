import { NextRequest, NextResponse } from 'next/server';

// Server-side image proxy for the FreshRSS article view. The browser can't
// fetch third-party article images (CORS), so the asset bundler routes its
// fetches through here when building the article EPUB. Returns the raw image
// bytes with the upstream content-type.
//
// Reachable only behind the app's auth gate (Caddy basic_auth), so it isn't a
// public open proxy; we still enforce http(s) + an image content-type + a size
// cap + a block-list for private/link-local hosts (basic SSRF hygiene).

const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 10_000;

const isBlockedHost = (host: string): boolean => {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h === '0.0.0.0' || h === '::1' || h === '::') return true;
  if (/^127\./.test(h)) return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true; // link-local + cloud metadata
  if (/^(fc|fd)[0-9a-f]{2}:/.test(h)) return true; // ULA IPv6
  if (/^fe80:/.test(h)) return true; // link-local IPv6
  return false;
};

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url');
  const referer = request.nextUrl.searchParams.get('referer') || undefined;
  if (!url) return NextResponse.json({ error: 'missing url' }, { status: 400 });

  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return NextResponse.json({ error: 'bad url' }, { status: 400 });
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return NextResponse.json({ error: 'bad scheme' }, { status: 400 });
  }
  if (isBlockedHost(target.hostname)) {
    return NextResponse.json({ error: 'blocked host' }, { status: 400 });
  }

  const headers: Record<string, string> = {
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
  };
  // Some CDNs (NYT/WSJ) gate images on a same-origin Referer.
  if (referer) {
    try {
      headers['Referer'] = new URL(referer).origin + '/';
    } catch {
      /* ignore unparseable referer */
    }
  }

  let upstream: Response;
  try {
    upstream = await fetch(target.toString(), {
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    return NextResponse.json({ error: `fetch failed: ${String(e)}` }, { status: 502 });
  }
  if (!upstream.ok) {
    return NextResponse.json({ error: `upstream ${upstream.status}` }, { status: 502 });
  }
  const contentType = (upstream.headers.get('content-type') || '').toLowerCase();
  if (!contentType.startsWith('image/')) {
    return NextResponse.json({ error: 'not an image' }, { status: 415 });
  }
  const buf = await upstream.arrayBuffer();
  if (buf.byteLength === 0 || buf.byteLength > MAX_BYTES) {
    return NextResponse.json({ error: 'bad size' }, { status: 502 });
  }
  return new NextResponse(buf, {
    status: 200,
    headers: { 'Content-Type': contentType, 'Cache-Control': 'private, max-age=86400' },
  });
}
