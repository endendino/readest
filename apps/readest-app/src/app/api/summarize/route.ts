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

// Input budget. This used to be 6,000 chars (~1,000 English words, fewer in
// Hebrew), which meant an 8,000-word feature was summarized from its first
// ~12% — the model never saw the rest, so coverage was structurally impossible
// no matter how the prompt was worded. Modern flash-tier models carry
// six-figure token contexts, so the cap exists only for cost/latency control.
// Override with SUMMARY_MAX_INPUT_CHARS.
const MAX_INPUT_CHARS = Number(process.env['SUMMARY_MAX_INPUT_CHARS']) || 200_000;

/**
 * Keep the whole article when it fits. Above the cap, take the opening and the
 * ending rather than a hard head-only cut: news and essays put the thesis up
 * front and the conclusion/implications at the end, and a head-only truncation
 * loses the latter entirely.
 */
export const fitToBudget = (text: string, budget: number): string => {
  if (text.length <= budget) return text;
  const head = Math.floor(budget * 0.65);
  const tail = budget - head;
  return `${text.slice(0, head)}\n\n[…]\n\n${text.slice(-tail)}`;
};

/**
 * How much summary a piece deserves, scaled SUB-linearly with its length: a
 * 10x longer article gets a fuller digest, not a 10x longer one. `words` is
 * counted on the original article, before any budget trimming.
 */
export const summaryShapeFor = (words: number) => {
  if (words < 600) {
    return { instruction: '1–2 sentences', maxTokens: 220, format: 'prose' as const };
  }
  if (words < 2000) {
    return { instruction: '3–4 sentences', maxTokens: 400, format: 'prose' as const };
  }
  if (words < 5000) {
    return {
      instruction: '4–6 short bullet points, each one line',
      maxTokens: 700,
      format: 'bullets' as const,
    };
  }
  return {
    instruction:
      '6–9 short bullet points, each one line, ordered to follow the article and covering its distinct sections or arguments',
    maxTokens: 1100,
    format: 'bullets' as const,
  };
};

export const countWords = (s: string): number => (s ? s.split(/\s+/).filter(Boolean).length : 0);

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

  let payload: { text?: string; blurb?: string };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }
  const fullText = (payload.text ?? '').trim();
  if (!fullText) {
    return NextResponse.json({ error: 'missing text' }, { status: 400 });
  }
  // Shape is decided on the REAL length, then the text is fitted to the budget —
  // so a very long article still asks for (and gets) a fuller digest even if the
  // body had to be trimmed to fit.
  const words = countWords(fullText);
  const shape = summaryShapeFor(words);
  const text = fitToBudget(fullText, MAX_INPUT_CHARS);
  // The reader has already read the blurb; the summary should COMPLEMENT it, not
  // restate it. Pass it through so the model can skip what's already covered.
  const blurb = (payload.blurb ?? '').trim().slice(0, 1500);

  const formatRule =
    shape.format === 'bullets'
      ? 'Format as plain bullet lines, each starting with "- ". No headings, no bold, no nested bullets.'
      : 'Output ONLY the summary text — no preamble, no quotes, no labels, no markdown.';
  const lengthRule =
    `The article is about ${words} words long, so write ${shape.instruction}. ` +
    'Cover the whole article, not just its opening — include its later sections, ' +
    'conclusions and any concrete numbers, names or outcomes that matter.';

  const systemPrompt = blurb
    ? 'You summarize an article for a reader who has ALREADY read the blurb shown below. ' +
      `${lengthRule} ` +
      'Cover ONLY points the blurb does NOT already mention — new facts, context, ' +
      'consequences, or details that add to it. Do NOT repeat or rephrase the blurb. ' +
      'If the article genuinely adds nothing beyond the blurb, reply with the single word NONE. ' +
      'Always respond in the SAME language as the article. ' +
      formatRule
    : 'You write a summary of an article for a reader deciding whether to read it. ' +
      `${lengthRule} ` +
      'Always respond in the SAME language as the article. ' +
      formatRule;

  const userPrompt = blurb
    ? `BLURB the reader has already read:\n${blurb}\n\nFULL ARTICLE:\n${text}`
    : `Summarize this article:\n\n${text}`;

  let upstream: Response;
  try {
    upstream = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        max_tokens: shape.maxTokens,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
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
  // Model says the blurb already covers everything — tell the client so it can
  // skip showing a redundant box rather than printing "NONE".
  if (blurb && /^none[.!]?$/i.test(summary)) {
    return NextResponse.json({ summary: '', redundant: true });
  }
  // `format` lets the client render bullet digests as a list instead of one
  // run-on paragraph; `words` is useful for cache diagnostics.
  return NextResponse.json({ summary, format: shape.format, words });
}
