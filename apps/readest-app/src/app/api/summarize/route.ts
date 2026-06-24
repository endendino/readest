import { NextRequest, NextResponse } from 'next/server';

// Server-side summary generator for the FreshRSS quick view. Calls the Claude
// Messages API to produce a 1–2 sentence sub-headline for articles that have no
// real blurb. The API key stays server-side (env) and never reaches the
// browser; the route is reachable only behind the app's auth gate.
//
//   ANTHROPIC_API_KEY   required — your Claude API key
//   ANTHROPIC_MODEL     optional — defaults to claude-haiku-4-5 (fast/cheap,
//                       right for high-volume summarization). Set to
//                       claude-opus-4-8 (or any model id) for richer summaries.

const DEFAULT_MODEL = 'claude-haiku-4-5';
const MAX_INPUT_CHARS = 6000;

export async function POST(request: NextRequest) {
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Summaries are not configured on the server (set ANTHROPIC_API_KEY)' },
      { status: 501 },
    );
  }
  const model = process.env['ANTHROPIC_MODEL'] || DEFAULT_MODEL;

  let payload: { text?: string };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }
  const text = (payload.text ?? '').trim().slice(0, MAX_INPUT_CHARS);
  if (!text) {
    return NextResponse.json({ error: 'missing text' }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 300,
        system:
          'You write a concise 1–2 sentence summary (a sub-headline) of a news article. ' +
          'Always respond in the SAME language as the article. ' +
          'Output ONLY the summary text — no preamble, no quotes, no labels, no markdown.',
        messages: [{ role: 'user', content: `Summarize this article:\n\n${text}` }],
      }),
      signal: AbortSignal.timeout(25_000),
    });
  } catch (e) {
    return NextResponse.json({ error: `upstream fetch failed: ${String(e)}` }, { status: 502 });
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '');
    return NextResponse.json(
      { error: `Claude API ${upstream.status}`, detail: detail.slice(0, 300) },
      { status: 502 },
    );
  }

  const data = (await upstream.json().catch(() => null)) as {
    stop_reason?: string;
    content?: { type: string; text?: string }[];
  } | null;
  if (!data) {
    return NextResponse.json({ error: 'bad upstream response' }, { status: 502 });
  }
  if (data.stop_reason === 'refusal') {
    return NextResponse.json({ error: 'summary refused' }, { status: 502 });
  }
  const summary = (data.content ?? [])
    .filter((b) => b.type === 'text' && b.text)
    .map((b) => b.text)
    .join('')
    .trim();
  if (!summary) {
    return NextResponse.json({ error: 'empty summary' }, { status: 502 });
  }
  return NextResponse.json({ summary });
}
