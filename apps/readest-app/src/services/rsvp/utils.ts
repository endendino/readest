/**
 * Utility functions for CJK (Chinese, Japanese, Korean) text processing
 */
import { cutZh, isJiebaReady } from '@/utils/jieba';

/**
 * Check if a character is a CJK character
 */
export function isCJK(char: string): boolean {
  // codePointAt (not charCodeAt) so astral ranges (CJK Ext B–E, U+20000+) match
  // instead of seeing a lone surrogate — those five ranges were dead (review B3).
  const code = char.codePointAt(0) ?? 0;
  return (
    (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified Ideographs
    (code >= 0x3400 && code <= 0x4dbf) || // CJK Extension A
    (code >= 0x20000 && code <= 0x2a6df) || // CJK Extension B
    (code >= 0x2a700 && code <= 0x2b73f) || // CJK Extension C
    (code >= 0x2b740 && code <= 0x2b81f) || // CJK Extension D
    (code >= 0x2b820 && code <= 0x2ceaf) || // CJK Extension E
    (code >= 0xf900 && code <= 0xfaff) || // CJK Compatibility Ideographs
    (code >= 0x3040 && code <= 0x309f) || // Hiragana
    (code >= 0x30a0 && code <= 0x30ff) || // Katakana
    (code >= 0xac00 && code <= 0xd7af) // Hangul Syllables
  );
}

/**
 * Check if text contains any CJK characters
 */
export function containsCJK(text: string): boolean {
  // Iterate by code point (for…of) so an astral CJK char is passed whole to
  // isCJK, not as a lone surrogate half (review B3).
  for (const ch of text) {
    if (isCJK(ch)) return true;
  }
  return false;
}

// Strong right-to-left scripts: Hebrew, Arabic, Syriac, Thaana, N'Ko,
// Samaritan, Mandaic and the Arabic Extended blocks (U+0590–U+08FF), plus the
// Hebrew/Arabic presentation forms (U+FB1D–U+FDFF and U+FE70–U+FEFF).
const RTL_PATTERN = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;

/**
 * Check if text contains any right-to-left characters. Splitting such text by
 * character index (as the RSVP focus-letter layout does) breaks letter shaping
 * and reverses the visual order, so RTL words are rendered whole instead (#4630).
 */
export function isRTLText(text: string): boolean {
  return RTL_PATTERN.test(text);
}

/**
 * Check if text is CJK punctuation
 */
export function isCJKPunctuation(text: string): boolean {
  // Check if text is CJK punctuation (single character or string)
  // Includes: CJK symbols, full-width forms, and halfwidth variants
  const cjkPunctuationPattern =
    /[。！？，、；：""''（）《》【】『』「」〈〉〔〕〖〗〘〙〚〛…—～·․‥⋯﹐﹑﹒﹔﹕﹖﹗﹙﹚﹛﹜﹝﹞！＂＃＄％＆＇（）＊＋，－．／：；＜＝＞？＠［＼］＾＿｀｛｜｝～｟｠｡｢｣､･\u3000-\u303F\uFF00-\uFFEF]/;
  return cjkPunctuationPattern.test(text);
}

/**
 * Detect the appropriate locale for text segmentation based on character ranges
 */
export function getSegmenterLocale(text: string): string | null {
  // Detect which CJK language based on character ranges
  for (const char of text) {
    const code = char.charCodeAt(0);

    // Japanese-specific characters
    if ((code >= 0x3040 && code <= 0x309f) || (code >= 0x30a0 && code <= 0x30ff)) {
      return 'ja';
    }

    // Korean Hangul
    if (code >= 0xac00 && code <= 0xd7af) {
      return 'ko';
    }

    // Chinese characters (most common CJK range)
    if (code >= 0x4e00 && code <= 0x9fff) {
      return 'zh';
    }
  }

  return null;
}

/**
 * Segment CJK text into words using Intl.Segmenter with punctuation attachment.
 * If `language` starts with `zh` and jieba-wasm has been initialized
 * (see `initJieba` in @/utils/jieba), use it for higher-quality Chinese
 * segmentation.
 *
 * When `cjkCharMode` is true, segmentation is skipped entirely and the text is
 * split into individual characters (see `segmentCJKByCharacter`).
 */
export function segmentCJKText(text: string, language?: string, cjkCharMode = false): string[] {
  if (cjkCharMode) {
    return segmentCJKByCharacter(text);
  }

  if (language?.toLowerCase().startsWith('zh') && isJiebaReady()) {
    try {
      return segmentWithJieba(text);
    } catch (error) {
      console.warn('jieba-wasm failed, falling back to Intl.Segmenter:', error);
    }
  }

  // Try to use Intl.Segmenter for semantic word segmentation
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    try {
      const locale = getSegmenterLocale(text) || 'zh';
      const segmenter = new Intl.Segmenter(locale, { granularity: 'word' });
      const segments = Array.from(segmenter.segment(text));
      const words: string[] = [];
      let i = 0;

      while (i < segments.length) {
        const segment = segments[i]!;
        const segmentText = segment.segment;

        // Only process actual words (skip pure whitespace)
        if ((segment.isWordLike || containsCJK(segmentText)) && segmentText.trim()) {
          let wordWithPunct = segmentText;
          // Look ahead for trailing punctuation in the next segments
          let j = i + 1;
          while (j < segments.length) {
            const nextSegment = segments[j]!;
            const nextText = nextSegment.segment;

            // If next segment is whitespace, skip it but continue looking
            if (nextText.trim() === '') {
              j++;
              continue;
            }

            // If next segment is punctuation, attach it
            if (isCJKPunctuation(nextText)) {
              wordWithPunct += nextText;
              j++;
            } else {
              // Stop at the next word
              break;
            }
          }

          words.push(wordWithPunct);
          i = j; // Skip to after the punctuation we just processed
        } else {
          i++;
        }
      }

      return words;
    } catch (error) {
      console.warn('Intl.Segmenter failed, falling back to simple segmentation:', error);
    }
  }

  // Fallback: Simple character-based segmentation with punctuation
  const words: string[] = [];
  let currentWord = '';

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;

    if (char.match(/\s/)) {
      if (currentWord) {
        words.push(currentWord);
        currentWord = '';
      }
    } else if (isCJK(char)) {
      currentWord += char;
      // Group 2 characters for readability
      if (currentWord.length >= 2) {
        // Look ahead for punctuation
        let j = i + 1;
        while (j < text.length && isCJKPunctuation(text[j]!)) {
          currentWord += text[j];
          i = j;
          j++;
        }
        words.push(currentWord);
        currentWord = '';
      }
    } else if (isCJKPunctuation(char)) {
      // Attach punctuation to current word
      currentWord += char;
    } else {
      currentWord += char;
    }
  }

  if (currentWord) {
    words.push(currentWord);
  }

  return words.filter((w) => w.trim().length > 0);
}

/**
 * Split a hyphenated word into display parts, keeping a trailing hyphen on
 * all but the last part. Only splits on hyphens that are directly between two
 * letters (letter-hyphen-letter), so tokens like "--", "-word", "word-", and
 * "foo--bar" are returned unchanged.
 *
 * Examples:
 *   "well-known"  → ["well-", "known"]
 *   "a-b-c"       → ["a-", "b-", "c"]
 *   "--"          → ["--"]
 *   "hello"       → ["hello"]
 */
export function getHyphenParts(word: string): string[] {
  // Unicode letter class (not [a-zA-Z]) so accented/other-script compounds split
  // too (review B5). Only between two letters, delimiter kept on the left part.
  if (!/\p{L}(?:-|\.\.\.)\p{L}/u.test(word)) return [word];
  // Capturing group preserves the delimiter in the split result array
  const parts = word.split(/([-]|\.\.\.)(?=\p{L})/u);
  // parts = ["foo", "-", "bar", "...", "baz"] for "foo-bar...baz"
  const result: string[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const segment = parts[i]!;
    const delimiter = parts[i + 1];
    result.push(delimiter ? segment + delimiter : segment);
  }
  return result;
}

/**
 * Segment Chinese text using jieba. Whitespace and standalone punctuation
 * runs are attached to the previous token so that downstream pause logic
 * still sees punctuation at word boundaries.
 */
function segmentWithJieba(text: string): string[] {
  const tokens = cutZh(text);
  const words: string[] = [];
  for (const token of tokens) {
    if (!token) continue;
    if (token.trim() === '') continue;
    if (isCJKPunctuation(token) && words.length > 0) {
      words[words.length - 1] = words[words.length - 1] + token;
      continue;
    }
    words.push(token);
  }
  return words;
}

/**
 * Split a CJK run into individual characters. Trailing CJK punctuation is
 * attached to the preceding character so downstream pause logic still sees
 * punctuation at token boundaries; a leading punctuation run with no preceding
 * character is emitted as its own token. Iterates by code point so characters
 * outside the BMP (e.g. CJK Extension B) stay intact.
 */
function segmentCJKByCharacter(text: string): string[] {
  const words: string[] = [];
  for (const char of text) {
    if (char.trim() === '') continue;
    if (isCJKPunctuation(char) && words.length > 0) {
      words[words.length - 1] = words[words.length - 1] + char;
    } else {
      words.push(char);
    }
  }
  return words;
}

/**
 * Split a token on em-dash (—) and en-dash (–), keeping the dash attached to
 * the preceding non-empty segment so downstream pause logic still sees it as
 * trailing punctuation. A leading dash with no preceding word is emitted as
 * its own token.
 *
 * Examples:
 *   "best—of"        → ["best—", "of"]
 *   "10–15"          → ["10–", "15"]
 *   "cliffhanger—"   → ["cliffhanger—"]
 *   "—continued"     → ["—", "continued"]
 */
function splitOnLongDashes(token: string): string[] {
  // Includes the Hebrew maqaf (־ U+05BE), which joins compounds like בית־ספר
  // that would otherwise flash as one long unreadable token (review A9).
  if (!/[–—־]/.test(token)) return [token];
  const parts = token.split(/([–—־])/);
  const result: string[] = [];
  for (const part of parts) {
    if (!part) continue;
    if (/^[–—־]$/.test(part) && result.length > 0) {
      result[result.length - 1] = result[result.length - 1] + part;
    } else {
      result.push(part);
    }
  }
  return result;
}

/**
 * Split text into words, handling both CJK and non-CJK text. When
 * `cjkCharMode` is true, CJK runs are split per-character instead of by
 * word segmentation; non-CJK text is unaffected.
 */
export function splitTextIntoWords(text: string, language?: string, cjkCharMode = false): string[] {
  const hasCJK = containsCJK(text);

  if (!hasCJK) {
    // Use space-based splitting for non-CJK text, then split on em/en-dashes so
    // compound phrases like "word—word" don't flash as a single unreadable run.
    // Zero-width space (U+200B) is treated as an additional word boundary —
    // EPUBs use it as an invisible break point, and without this a ZWSP-joined
    // pair stays glued into one unreadable token (review B14). This only adds a
    // boundary; it never appears inside a returned word, so the controller's
    // `text.indexOf(word)` offset matching still finds every word untouched.
    return text
      .split(/([\s\u200B]+)/)
      .filter((w) => w.trim().length > 0 && !/^[\u200B]+$/.test(w.trim()))
      .flatMap(splitOnLongDashes);
  }

  // For CJK text, use semantic segmentation
  const words: string[] = [];
  let currentSegment = '';
  let inCJKSequence = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    const charIsCJK = isCJK(char);
    const charIsPunct = isCJKPunctuation(char);

    if (charIsCJK) {
      if (!inCJKSequence && currentSegment) {
        // Push non-CJK segment
        words.push(currentSegment);
        currentSegment = '';
      }
      currentSegment += char;
      inCJKSequence = true;
    } else if (charIsPunct) {
      // CJK punctuation should be kept with CJK segment
      if (inCJKSequence) {
        currentSegment += char;
        // Don't change inCJKSequence, keep collecting
      } else if (currentSegment) {
        // Non-CJK text followed by punctuation
        currentSegment += char;
      } else {
        // Standalone punctuation at start
        currentSegment = char;
      }
    } else if (char.match(/\s/)) {
      if (currentSegment) {
        if (inCJKSequence) {
          // Segment the CJK text (with any trailing punctuation)
          words.push(...segmentCJKText(currentSegment, language, cjkCharMode));
        } else {
          words.push(currentSegment);
        }
        currentSegment = '';
      }
      inCJKSequence = false;
    } else {
      // Non-CJK, non-punctuation, non-whitespace character
      if (inCJKSequence && currentSegment) {
        // Segment the CJK text before continuing with non-CJK
        words.push(...segmentCJKText(currentSegment, language, cjkCharMode));
        currentSegment = '';
      }
      currentSegment += char;
      inCJKSequence = false;
    }
  }

  if (currentSegment) {
    if (inCJKSequence) {
      words.push(...segmentCJKText(currentSegment, language, cjkCharMode));
    } else {
      words.push(currentSegment);
    }
  }

  return words.filter((w) => w.trim().length > 0);
}

/**
 * Relative weight of a word's trailing punctuation, used to scale the configured
 * punctuation pause. Sentence-ending punctuation (".", "!", "?") gets the full
 * pause; clause-level punctuation (",", ";", ":", "–", "—") gets a shorter beat;
 * a word with no trailing pause punctuation gets 0. This lets a comma breathe
 * less than a full stop instead of every mark sharing one fixed pause.
 */
export function punctuationPauseScale(text: string): number {
  // Strip trailing closing quotes / brackets / whitespace so a token like
  // `said."`, `end.”`, `(done.)` or `word…"` is still scored by its real
  // sentence punctuation instead of the quote (review A1). Ellipsis and the CJK
  // full stop / comma family are pauses too (review A2).
  const core = text.replace(/['"”’‚’»›)\]}』」）】》〉\s]+$/u, '');
  if (/[.!?…。！？]$/u.test(core)) return 1;
  if (/[,;:–—、，；：]$/u.test(core)) return 0.5;
  return 0;
}

/**
 * How many of the leading words form the next phrase chunk, given a character
 * budget. Packs words until adding the next would exceed the budget (counting a
 * joining space), always returns at least 1, never extends past a word ending in
 * sentence/clause punctuation (so a chunk never flashes across a clause break),
 * and pulls in a second word when the first is a short function word so it is
 * not stranded alone. Returns 0 for no words.
 */
export function phraseChunkSize(wordTexts: string[], budget: number): number {
  if (wordTexts.length === 0) return 0;

  let count = 0;
  let width = 0;
  for (let i = 0; i < wordTexts.length; i++) {
    const word = wordTexts[i]!;
    const add = (count === 0 ? 0 : 1) + word.length; // +1 for the joining space
    if (count > 0 && width + add > budget) break;
    count++;
    width += add;
    // Break at any clause/sentence pause — reuses punctuationPauseScale so the
    // set of break marks stays identical to the pause set: dashes, ellipsis and
    // quoted sentence-ends now break too, instead of `[.!?,;:]` only (review B7).
    if (punctuationPauseScale(word) > 0) break;
  }

  // Don't strand a lone short function word ("the", "of", …): pull in the next.
  if (count === 1 && wordTexts.length > 1) {
    const first = wordTexts[0]!;
    if (first.length <= 3 && punctuationPauseScale(first) === 0) count = 2;
  }

  return count;
}

/**
 * Effective WPM for a warm-up ramp: eases from `startFraction` of the target
 * speed up to the full target over the first `rampWords` words, then stays at
 * the target. `wordsIntoRamp` is how many words have been shown since the ramp
 * anchor (start/resume). Returns the target unchanged once the ramp is over or
 * when `rampWords` is non-positive.
 */
export function warmupWpm(
  targetWpm: number,
  wordsIntoRamp: number,
  rampWords: number,
  startFraction: number,
): number {
  if (rampWords <= 0 || wordsIntoRamp >= rampWords) return targetWpm;
  const progress = Math.max(0, wordsIntoRamp) / rampWords;
  const fraction = startFraction + (1 - startFraction) * progress;
  return Math.round(targetWpm * fraction);
}

/**
 * Optimal Recognition Point index for a Latin-script word — the letter the eye
 * should fixate, slightly left of centre (Spritz-style pivot bands). Skips
 * leading punctuation/quotes so the pivot lands on a real letter, and trims
 * trailing punctuation before measuring length so it scales correctly on long
 * words instead of capping early.
 */
export function latinOrpIndex(word: string): number {
  const isLetterOrDigit = (ch: string) => /[\p{L}\p{N}]/u.test(ch);
  let start = 0;
  while (start < word.length && !isLetterOrDigit(word[start]!)) start++;
  let end = word.length;
  while (end > start && !isLetterOrDigit(word[end - 1]!)) end--;

  const coreLen = end - start;
  if (coreLen <= 1) return start;

  let pivot: number;
  if (coreLen <= 5) pivot = 1;
  else if (coreLen <= 9) pivot = 2;
  else if (coreLen <= 13) pivot = 3;
  else pivot = 4;

  // Don't land the pivot on an interior apostrophe/hyphen (e.g. "I'm" → index 1
  // was the apostrophe); nudge to the next real letter/digit (review B6).
  let idx = start + pivot;
  while (idx < end && !isLetterOrDigit(word[idx]!)) idx++;
  return idx < end ? idx : start + pivot;
}

// Hebrew block (U+0590–U+05FF: letters, points, maqaf, punctuation). Used to
// lower the length bands in latinDwellMultiplier — vowel-less Hebrew words are
// short but information-dense, so the Latin-calibrated >8/>12 bands rarely
// fire for them (review A7). Narrower than isRTLText/RTL_PATTERN on purpose:
// Arabic and other RTL scripts keep the Latin bands since they aren't
// vowel-elided the same way.
const HEBREW_PATTERN = /[֐-׿]/;

/**
 * Dwell-time multiplier for a word, used to linger on harder words. Combines
 * length with intrinsic difficulty cues — numerals and all-caps tokens
 * (acronyms / emphasis) are read more carefully — capped so no single word
 * stalls the flow. Very short function words flash slightly faster.
 *
 * Length bands are Latin-calibrated (>8/>12 chars). Hebrew is written without
 * vowels, so words carry more information per character and rarely reach
 * those lengths — a short Hebrew word can be as dense as a long English one.
 * When the word contains Hebrew letters, the bands are lowered (>5/>8) so
 * difficulty-adaptive dwell actually triggers; Latin (and other-script) input
 * is untouched and produces the exact same multipliers as before (review A7).
 */
export function latinDwellMultiplier(word: string): number {
  const core = word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  const len = core.length;
  const isHebrew = HEBREW_PATTERN.test(core);

  let m = 1.0;
  if (isHebrew) {
    if (len > 8) m = 1.35;
    else if (len > 5) m = 1.15;
    else if (len <= 2) m = 0.9;
  } else {
    if (len > 12) m = 1.35;
    else if (len > 8) m = 1.15;
    else if (len <= 2) m = 0.9;
  }

  if (/\d/.test(core)) m += 0.3; // numerals are read more carefully
  if (core.length >= 2 && core === core.toUpperCase() && core !== core.toLowerCase()) {
    m += 0.2; // ALL-CAPS acronyms / emphasis
  }

  return Math.min(m, 1.8);
}
