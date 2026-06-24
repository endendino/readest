import { NextRequest, NextResponse } from 'next/server';

// Server-side summary generator for the FreshRSS quick view. Calls an
// OpenAI-compatible chat-completions endpoint, so the provider and model can be
// swapped with env vars alone — no code change, no rebuild, just edit the env
// file and recreate the container.
//
//   SUMMARY_API_KEY   required — the provider's API key
//   SUMMARY_MODEL     optional — default gemini-3.1-flash-lite
//   SUMMARY_BASE_URL  optional — default Google Gemini's OpenAI-compat base.
//                     To switch providers, point this at any OpenAI-compatible
//                     API and set SUMMARY_MODEL + SUMMARY_API_KEY to match:
//                       Gemini (default): https://generativelanguage.googleapis.com/v1beta/openai
//                       OpenAI:           https://api.openai.com/v1
//                       OpenRouter:       https://openrouter.ai/api/v1
//                       Groq:             https://api.groq.com/openai/v1
//                       local (Ollama):   http://host:11434/v1
//
// The key stays server-side and the route is only reachable behind the app gate.

const DEFAULT_MODEL = 'gemini-3.1-flash-lite';
const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';
const MAX_INPUT_CHARS = 6000;

export async function POST(request: NextRequest) {
  const apiKey = process.env['SUMMARY_API_KEY'];
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Summaries are not configured on the server (set SUMMARY_API_KEY)' },
      { status: 501 },
    );
  }
  const model = process.env['SUMMARY_MODEL'] || DEFAULT_MODEL;
  const baseUrl = (process.env['SUMMARY_BASE_URL'] || DEFAULT_BASE_URL).replace(/\/+$/, '');

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
    upstream = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        max_tokens: 300,
        messages: [
          {
            role: 'system',
            content:
              'You write a concise 1–2 sentence summary (a sub-headline) of a news article. ' +
              'Always respond in the SAME language as the article. ' +
              'Output ONLY the summary text — no preamble, no quotes, no labels, no markdown.',
          },
          { role: 'user', content: `Summarize this article:\n\n${text}` },
        ],
      }),
      signal: AbortSignal.timeout(25_000),
    });
  } catch (e) {
    return NextResponse.json({ error: `upstream fetch failed: ${String(e)}` }, { status: 502 });
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '');
    return NextResponse.json(
      { error: `summary API ${upstream.status}`, detail: detail.slice(0, 300) },
      { status: 502 },
    );
  }

  const data = (await upstream.json().catch(() => null)) as {
    choices?: { message?: { content?: string } }[];
  } | null;
  const summary = data?.choices?.[0]?.message?.content?.trim() ?? '';
  if (!summary) {
    return NextResponse.json({ error: 'empty summary' }, { status: 502 });
  }
  return NextResponse.json({ summary });
}
