import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';

// Server-side image proxy for the FreshRSS article view. The browser can't
// fetch third-party article images (CORS), so the asset bundler routes its
// fetches through here when building the article EPUB. Raster images are
// downscaled + re-encoded to WebP server-side so the (mobile) client only ever
// downloads a small version — high enough quality for a phone screen, no larger.
//
// Reachable only behind the app's auth gate (Caddy basic_auth), so it isn't a
// public open proxy; we still enforce http(s) + an image content-type + a size
// cap + a block-list for private/link-local hosts (basic SSRF hygiene).

const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
// Mobile-first defaults: cap the long edge and re-encode at a quality that's
// crisp on a phone (incl. hi-DPI) without shipping desktop-sized originals.
// Override the width per-request with ?w= (clamped). Tune via env if needed.
const DEFAULT_MAX_WIDTH = Number(process.env['IMG_MAX_WIDTH']) || 1080;
const WEBP_QUALITY = Number(process.env['IMG_QUALITY']) || 72;
// Only raster formats sharp can resize cleanly; SVG (vector) and GIF (possibly
// animated) pass through untouched.
const RESIZABLE = /^image\/(jpe?g|png|webp|avif)$/;

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
  const wParam = Number(request.nextUrl.searchParams.get('w'));
  const maxWidth = Number.isFinite(wParam) && wParam >= 64 ? Math.min(wParam, 2000) : DEFAULT_MAX_WIDTH;

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

  // Downscale + re-encode raster images to WebP so the client gets a small,
  // phone-appropriate file. SVG/GIF pass through; any sharp failure falls back
  // to the original bytes so a quirky image never breaks the article.
  if (RESIZABLE.test(contentType)) {
    try {
      const out = await sharp(Buffer.from(buf), { failOn: 'none' })
        .rotate() // honor EXIF orientation before stripping metadata
        .resize({ width: maxWidth, withoutEnlargement: true })
        .webp({ quality: WEBP_QUALITY })
        .toBuffer();
      return new NextResponse(new Uint8Array(out), {
        status: 200,
        headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'private, max-age=86400' },
      });
    } catch {
      /* fall through to returning the original bytes */
    }
  }

  return new NextResponse(buf, {
    status: 200,
    headers: { 'Content-Type': contentType, 'Cache-Control': 'private, max-age=86400' },
  });
}
