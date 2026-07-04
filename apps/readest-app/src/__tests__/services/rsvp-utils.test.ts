import { describe, test, expect } from 'vitest';
import {
  isCJK,
  containsCJK,
  isCJKPunctuation,
  isRTLText,
  getSegmenterLocale,
  segmentCJKText,
  splitTextIntoWords,
  getHyphenParts,
  punctuationPauseScale,
  phraseChunkSize,
  warmupWpm,
  latinOrpIndex,
  latinDwellMultiplier,
} from '@/services/rsvp/utils';

describe('rsvp/utils', () => {
  describe('punctuationPauseScale', () => {
    test('gives sentence-ending punctuation the full weight', () => {
      expect(punctuationPauseScale('end.')).toBe(1);
      expect(punctuationPauseScale('really?')).toBe(1);
      expect(punctuationPauseScale('stop!')).toBe(1);
    });

    test('gives clause-level punctuation half the weight', () => {
      expect(punctuationPauseScale('yes,')).toBe(0.5);
      expect(punctuationPauseScale('first;')).toBe(0.5);
      expect(punctuationPauseScale('note:')).toBe(0.5);
      expect(punctuationPauseScale('dash—')).toBe(0.5);
    });

    test('is 0 for a word with no trailing pause punctuation', () => {
      expect(punctuationPauseScale('word')).toBe(0);
    });
  });

  describe('phraseChunkSize', () => {
    test('packs words up to the character budget', () => {
      // "The"(3) + " quick"(6) = 9 <= 14; adding " brown" would reach 15 > 14.
      expect(phraseChunkSize(['The', 'quick', 'brown', 'fox'], 14)).toBe(2);
    });

    test('breaks after clause/sentence punctuation', () => {
      expect(phraseChunkSize(['brown', 'fox,', 'jumped'], 14)).toBe(2);
      expect(phraseChunkSize(['end.', 'New', 'one'], 14)).toBe(1);
    });

    test('does not strand a lone short function word', () => {
      // "the" alone fits, but the long next word exceeds budget; pull it in anyway.
      expect(phraseChunkSize(['the', 'extraordinary'], 14)).toBe(2);
    });

    test('always returns at least 1 word, or 0 for none', () => {
      expect(phraseChunkSize(['single'], 14)).toBe(1);
      expect(phraseChunkSize([], 14)).toBe(0);
    });
  });

  describe('warmupWpm', () => {
    test('starts at the start fraction of the target', () => {
      expect(warmupWpm(300, 0, 8, 0.5)).toBe(150);
    });

    test('reaches the full target at the end of the ramp', () => {
      expect(warmupWpm(300, 8, 8, 0.5)).toBe(300);
      expect(warmupWpm(300, 20, 8, 0.5)).toBe(300);
    });

    test('eases monotonically up across the ramp', () => {
      const a = warmupWpm(300, 2, 8, 0.5);
      const b = warmupWpm(300, 4, 8, 0.5);
      const c = warmupWpm(300, 6, 8, 0.5);
      expect(a).toBeLessThan(b);
      expect(b).toBeLessThan(c);
      expect(c).toBeLessThan(300);
    });

    test('returns the target unchanged when the ramp is disabled', () => {
      expect(warmupWpm(300, 0, 0, 0.5)).toBe(300);
    });
  });

  describe('latinOrpIndex', () => {
    test('puts short words just past the first letter (not on it)', () => {
      expect(latinOrpIndex('to')).toBe(1);
      expect(latinOrpIndex('the')).toBe(1);
      expect(latinOrpIndex('hello')).toBe(1);
    });

    test('scales the pivot rightward for longer words', () => {
      expect(latinOrpIndex('internet')).toBe(2);
      expect(latinOrpIndex('comprehend')).toBe(3);
      expect(latinOrpIndex('internationalization')).toBe(4);
    });

    test('skips leading punctuation so the pivot lands on a letter', () => {
      // '"hello"' -> pivot on the core word "hello", offset past the quote.
      expect(latinOrpIndex('"hello"')).toBe(2);
      expect('"hello"'.charAt(latinOrpIndex('"hello"'))).toBe('e');
    });

    test('returns the first letter for single-letter / empty input', () => {
      expect(latinOrpIndex('a')).toBe(0);
      expect(latinOrpIndex('')).toBe(0);
    });
  });

  describe('latinDwellMultiplier', () => {
    test('lingers on long words and hurries very short ones', () => {
      expect(latinDwellMultiplier('extraordinary')).toBeCloseTo(1.35);
      expect(latinDwellMultiplier('comprehend')).toBeCloseTo(1.15);
      expect(latinDwellMultiplier('the')).toBeCloseTo(1.0);
      expect(latinDwellMultiplier('a')).toBeCloseTo(0.9);
    });

    test('adds dwell for numerals and all-caps acronyms', () => {
      expect(latinDwellMultiplier('2024')).toBeCloseTo(1.3);
      expect(latinDwellMultiplier('NASA')).toBeCloseTo(1.2);
    });

    test('ignores surrounding punctuation and caps the multiplier', () => {
      expect(latinDwellMultiplier('"the,"')).toBeCloseTo(1.0);
      expect(latinDwellMultiplier('SUPERCALIFRAGILISTIC123')).toBeLessThanOrEqual(1.8);
    });
  });

  describe('isCJK', () => {
    test('returns true for CJK Unified Ideographs', () => {
      expect(isCJK('\u4e00')).toBe(true); // first CJK character
      expect(isCJK('\u9fff')).toBe(true); // last CJK character
      expect(isCJK('\u5f00')).toBe(true); // 开
    });

    test('returns true for Hiragana', () => {
      expect(isCJK('\u3042')).toBe(true); // あ
    });

    test('returns true for Katakana', () => {
      expect(isCJK('\u30A2')).toBe(true); // ア
    });

    test('returns true for Hangul', () => {
      expect(isCJK('\uAC00')).toBe(true); // 가
    });

    test('returns true for CJK Extension A', () => {
      expect(isCJK('\u3400')).toBe(true);
    });

    test('returns true for CJK Compatibility Ideographs', () => {
      expect(isCJK('\uF900')).toBe(true);
    });

    test('returns false for Latin characters', () => {
      expect(isCJK('a')).toBe(false);
      expect(isCJK('Z')).toBe(false);
    });

    test('returns false for digits', () => {
      expect(isCJK('1')).toBe(false);
    });

    test('returns false for spaces', () => {
      expect(isCJK(' ')).toBe(false);
    });
  });

  describe('containsCJK', () => {
    test('returns true for text with CJK characters', () => {
      expect(containsCJK('Hello 你好')).toBe(true);
    });

    test('returns true for pure CJK text', () => {
      expect(containsCJK('你好世界')).toBe(true);
    });

    test('returns false for pure Latin text', () => {
      expect(containsCJK('Hello World')).toBe(false);
    });

    test('returns false for empty string', () => {
      expect(containsCJK('')).toBe(false);
    });

    test('returns true for Japanese hiragana', () => {
      expect(containsCJK('こんにちは')).toBe(true);
    });

    test('returns true for Korean', () => {
      expect(containsCJK('안녕하세요')).toBe(true);
    });
  });

  describe('isCJKPunctuation', () => {
    test('returns true for Chinese period', () => {
      expect(isCJKPunctuation('。')).toBe(true);
    });

    test('returns true for Chinese comma', () => {
      expect(isCJKPunctuation('，')).toBe(true);
    });

    test('returns true for full-width exclamation', () => {
      expect(isCJKPunctuation('！')).toBe(true);
    });

    test('returns true for full-width question mark', () => {
      expect(isCJKPunctuation('？')).toBe(true);
    });

    test('returns true for brackets', () => {
      expect(isCJKPunctuation('【')).toBe(true);
      expect(isCJKPunctuation('】')).toBe(true);
      expect(isCJKPunctuation('「')).toBe(true);
      expect(isCJKPunctuation('」')).toBe(true);
    });

    test('returns true for ellipsis', () => {
      expect(isCJKPunctuation('…')).toBe(true);
    });

    test('returns false for standard Latin comma', () => {
      expect(isCJKPunctuation(',')).toBe(false);
    });

    test('returns false for Latin period', () => {
      expect(isCJKPunctuation('.')).toBe(false);
    });

    test('returns false for a letter', () => {
      expect(isCJKPunctuation('A')).toBe(false);
    });
  });

  describe('isRTLText', () => {
    test('returns true for Arabic text', () => {
      expect(isRTLText('علم')).toBe(true);
      expect(isRTLText('مرحبا')).toBe(true);
    });

    test('returns true for Hebrew text', () => {
      expect(isRTLText('שלום')).toBe(true);
    });

    test('returns true for Arabic presentation forms', () => {
      expect(isRTLText('ﺍ')).toBe(true); // Arabic letter alef isolated form
    });

    test('returns true for text mixing Arabic and Latin', () => {
      expect(isRTLText('Hello علم')).toBe(true);
    });

    test('returns false for pure Latin text', () => {
      expect(isRTLText('hello')).toBe(false);
    });

    test('returns false for CJK text', () => {
      expect(isRTLText('你好世界')).toBe(false);
    });

    test('returns false for digits and Latin punctuation', () => {
      expect(isRTLText('123, 456.')).toBe(false);
    });

    test('returns false for empty string', () => {
      expect(isRTLText('')).toBe(false);
    });
  });

  describe('getSegmenterLocale', () => {
    test('returns ja for Japanese hiragana text', () => {
      expect(getSegmenterLocale('こんにちは')).toBe('ja');
    });

    test('returns ja for Katakana text', () => {
      expect(getSegmenterLocale('アイウ')).toBe('ja');
    });

    test('returns ko for Korean text', () => {
      expect(getSegmenterLocale('안녕하세요')).toBe('ko');
    });

    test('returns zh for Chinese text', () => {
      expect(getSegmenterLocale('你好世界')).toBe('zh');
    });

    test('returns null for pure Latin text', () => {
      expect(getSegmenterLocale('Hello World')).toBeNull();
    });

    test('returns null for empty string', () => {
      expect(getSegmenterLocale('')).toBeNull();
    });

    test('detects first CJK script in mixed text', () => {
      // Japanese hiragana appears first
      expect(getSegmenterLocale('あ你好')).toBe('ja');
    });
  });

  describe('segmentCJKText', () => {
    test('segments Chinese text into words', () => {
      const words = segmentCJKText('你好世界');
      expect(words.length).toBeGreaterThan(0);
      expect(words.join('')).toContain('你好');
    });

    test('segments Japanese text', () => {
      const words = segmentCJKText('こんにちは');
      expect(words.length).toBeGreaterThan(0);
    });

    test('handles text with punctuation', () => {
      const words = segmentCJKText('你好。世界！');
      expect(words.length).toBeGreaterThan(0);
    });

    test('handles empty text', () => {
      const words = segmentCJKText('');
      expect(words).toEqual([]);
    });

    test('handles single character', () => {
      const words = segmentCJKText('你');
      expect(words.length).toBeGreaterThanOrEqual(1);
    });

    test('attaches trailing CJK punctuation', () => {
      const words = segmentCJKText('你好！');
      // The punctuation should be attached to a word
      const hasWordWithPunct = words.some((w) => w.includes('！'));
      expect(hasWordWithPunct).toBe(true);
    });
  });

  describe('splitTextIntoWords', () => {
    test('splits English text by spaces', () => {
      const words = splitTextIntoWords('Hello World');
      expect(words).toEqual(['Hello', 'World']);
    });

    test('splits multi-word English text', () => {
      const words = splitTextIntoWords('The quick brown fox');
      expect(words).toEqual(['The', 'quick', 'brown', 'fox']);
    });

    test('filters empty words', () => {
      const words = splitTextIntoWords('  Hello   World  ');
      expect(words.every((w) => w.trim().length > 0)).toBe(true);
    });

    test('handles CJK text', () => {
      const words = splitTextIntoWords('你好世界');
      expect(words.length).toBeGreaterThan(0);
    });

    test('handles mixed CJK and Latin text', () => {
      const words = splitTextIntoWords('Hello 你好 World');
      expect(words.length).toBeGreaterThan(0);
      // Should contain both CJK and Latin segments
    });

    test('handles empty string', () => {
      const words = splitTextIntoWords('');
      expect(words).toEqual([]);
    });

    test('handles CJK text with punctuation', () => {
      const words = splitTextIntoWords('你好。世界！');
      expect(words.length).toBeGreaterThan(0);
    });

    test('handles CJK followed immediately by non-CJK', () => {
      const words = splitTextIntoWords('你好Hello');
      expect(words.length).toBeGreaterThanOrEqual(1);
    });

    test('handles standalone CJK punctuation at start', () => {
      const words = splitTextIntoWords('。Hello');
      expect(words.length).toBeGreaterThan(0);
    });

    test('handles non-CJK text followed by CJK punctuation', () => {
      const words = splitTextIntoWords('Hello。');
      expect(words.length).toBeGreaterThan(0);
    });

    test('handles whitespace between CJK segments', () => {
      const words = splitTextIntoWords('你好 世界');
      expect(words.length).toBeGreaterThan(0);
    });

    test('splits on em-dash without surrounding spaces', () => {
      expect(splitTextIntoWords('alpha—beta')).toEqual(['alpha—', 'beta']);
    });

    test('splits on en-dash without surrounding spaces', () => {
      expect(splitTextIntoWords('alpha–beta')).toEqual(['alpha–', 'beta']);
    });

    test('attaches em-dash with surrounding spaces to preceding word', () => {
      expect(splitTextIntoWords('alpha — beta')).toEqual(['alpha', '—', 'beta']);
    });

    test('splits multiple em-dashes in a single token', () => {
      expect(splitTextIntoWords('one—two—three')).toEqual(['one—', 'two—', 'three']);
    });

    test('splits sentence with em-dash inside compound word', () => {
      expect(splitTextIntoWords('It was the best—of all possible—worlds.')).toEqual([
        'It',
        'was',
        'the',
        'best—',
        'of',
        'all',
        'possible—',
        'worlds.',
      ]);
    });

    test('preserves trailing em-dash attached to its word', () => {
      expect(splitTextIntoWords('cliffhanger—')).toEqual(['cliffhanger—']);
    });

    test('preserves leading em-dash as its own token', () => {
      expect(splitTextIntoWords('—continued')).toEqual(['—', 'continued']);
    });
  });

  describe('getHyphenParts', () => {
    test('splits a hyphenated word into two parts with trailing hyphen on first', () => {
      expect(getHyphenParts('well-known')).toEqual(['well-', 'known']);
    });

    test('splits multiple letter-hyphens keeping trailing hyphen on each non-last part', () => {
      expect(getHyphenParts('one-two-three')).toEqual(['one-', 'two-', 'three']);
    });

    test('returns word unchanged when no letter-hyphen-letter pattern', () => {
      expect(getHyphenParts('hello')).toEqual(['hello']);
    });

    test('returns double-hyphen unchanged (em-dash style)', () => {
      expect(getHyphenParts('--')).toEqual(['--']);
    });

    test('returns lone hyphen unchanged', () => {
      expect(getHyphenParts('-')).toEqual(['-']);
    });

    test('returns consecutive-hyphen word unchanged', () => {
      expect(getHyphenParts('foo--bar')).toEqual(['foo--bar']);
    });

    test('returns leading-hyphen word unchanged', () => {
      expect(getHyphenParts('-word')).toEqual(['-word']);
    });

    test('returns trailing-hyphen word unchanged', () => {
      expect(getHyphenParts('word-')).toEqual(['word-']);
    });

    test('splits on ellipsis between letters with trailing ellipsis on non-last parts', () => {
      expect(getHyphenParts('a...b')).toEqual(['a...', 'b']);
    });

    test('splits mixed hyphens and ellipses preserving each delimiter', () => {
      expect(getHyphenParts('foo-bar...baz')).toEqual(['foo-', 'bar...', 'baz']);
    });

    test('returns ellipsis-only unchanged', () => {
      expect(getHyphenParts('...')).toEqual(['...']);
    });
  });

  describe('CJK character mode', () => {
    test('segmentCJKText splits CJK text per-character when cjkCharMode is true', () => {
      expect(segmentCJKText('你好世界', undefined, true)).toEqual(['你', '好', '世', '界']);
    });

    test('segmentCJKText attaches CJK punctuation to the preceding character in char mode', () => {
      expect(segmentCJKText('你好。世界！', undefined, true)).toEqual(['你', '好。', '世', '界！']);
    });

    test('segmentCJKText keeps leading punctuation as its own token in char mode', () => {
      expect(segmentCJKText('。你好', undefined, true)).toEqual(['。', '你', '好']);
    });

    test('segmentCJKText returns empty array for empty text in char mode', () => {
      expect(segmentCJKText('', undefined, true)).toEqual([]);
    });

    test('splitTextIntoWords splits CJK per-character in char mode', () => {
      expect(splitTextIntoWords('我喜欢阅读', undefined, true)).toEqual([
        '我',
        '喜',
        '欢',
        '阅',
        '读',
      ]);
    });

    test('splitTextIntoWords leaves Latin words intact in char mode', () => {
      expect(splitTextIntoWords('Hello 你好 World', undefined, true)).toEqual([
        'Hello',
        '你',
        '好',
        'World',
      ]);
    });

    test('splitTextIntoWords groups CJK characters when char mode is off', () => {
      // Default segmentation should group multi-character words like 喜欢 / 阅读.
      expect(splitTextIntoWords('我喜欢阅读').length).toBeLessThan(5);
    });
  });
});

describe('rsvp/utils — review fixes (2026-06-28)', () => {
  describe('punctuationPauseScale — quotes/brackets/CJK (A1/A2)', () => {
    test('sentence punctuation inside closing quotes/brackets still pauses fully', () => {
      expect(punctuationPauseScale('said."')).toBe(1);
      expect(punctuationPauseScale('end.”')).toBe(1);
      expect(punctuationPauseScale('(done.)')).toBe(1);
      expect(punctuationPauseScale('wait…')).toBe(1);
      expect(punctuationPauseScale('really?"')).toBe(1);
    });
    test('clause punctuation inside a quote gets the half beat', () => {
      expect(punctuationPauseScale('however,”')).toBe(0.5);
    });
    test('CJK sentence and clause marks pause (were 0 before)', () => {
      expect(punctuationPauseScale('结束。')).toBe(1);
      expect(punctuationPauseScale('你好，')).toBe(0.5);
    });
    test('a bare closing quote or plain word is not a pause', () => {
      expect(punctuationPauseScale('"')).toBe(0);
      expect(punctuationPauseScale('word')).toBe(0);
    });
  });

  describe('phraseChunkSize — dash break + 9-char budget (B7)', () => {
    test('breaks the chunk at a dash-terminated word', () => {
      expect(phraseChunkSize(['best—', 'of', 'all'], 9)).toBe(1);
    });
    test('respects the 9-char budget', () => {
      expect(phraseChunkSize(['the', 'quick', 'brown'], 9)).toBe(2);
      expect(phraseChunkSize(['quick', 'brown'], 9)).toBe(1);
    });
    test('still pulls in a second word to avoid stranding a short function word', () => {
      expect(phraseChunkSize(['of', 'elephants'], 9)).toBe(2);
    });
  });

  describe('latinOrpIndex — apostrophe (B6)', () => {
    test('does not land the pivot on an interior apostrophe', () => {
      const w = "I'm";
      expect(w[latinOrpIndex(w)]).not.toBe("'");
    });
  });

  describe('isCJK / containsCJK — astral (B3)', () => {
    test('recognizes an astral CJK Extension-B character', () => {
      expect(isCJK('\u{20000}')).toBe(true);
      expect(containsCJK('abc\u{20000}')).toBe(true);
    });
  });

  describe('getHyphenParts — unicode letters (B5)', () => {
    test('splits an accented-letter compound', () => {
      expect(getHyphenParts('café-bar')).toEqual(['café-', 'bar']);
    });
  });

  describe('splitTextIntoWords — Hebrew maqaf (A9)', () => {
    test('splits a maqaf compound, keeping the maqaf on the left part', () => {
      expect(splitTextIntoWords('בית־ספר')).toEqual(['בית־', 'ספר']);
    });
  });

  describe('latinDwellMultiplier — Hebrew-aware length bands (A7)', () => {
    test('Latin words produce the same multipliers as before (unchanged)', () => {
      expect(latinDwellMultiplier('extraordinary')).toBeCloseTo(1.35);
      expect(latinDwellMultiplier('comprehend')).toBeCloseTo(1.15);
      expect(latinDwellMultiplier('the')).toBeCloseTo(1.0);
      expect(latinDwellMultiplier('a')).toBeCloseTo(0.9);
    });

    test('a short but dense Hebrew word now gets dwell (was 1.0 before A7)', () => {
      // 6 letters — under the old >8 Latin band (would have been 1.0), but
      // over the lowered Hebrew >5 band.
      expect(latinDwellMultiplier('ספרייה')).toBeGreaterThan(1.0);
      expect(latinDwellMultiplier('ספרייה')).toBeCloseTo(1.15);
    });

    test('a longer Hebrew word crosses into the top Hebrew band', () => {
      // 9 letters — over the lowered Hebrew >8 band.
      expect(latinDwellMultiplier('התקדמותהתקדמות'.slice(0, 9))).toBeCloseTo(1.35);
    });

    test('a very short Hebrew word is unaffected (still under both bands)', () => {
      expect(latinDwellMultiplier('שלום')).toBeCloseTo(1.0);
    });

    test('caps at 1.8 for a long Hebrew word with numerals', () => {
      expect(latinDwellMultiplier('ירושלים2024')).toBeLessThanOrEqual(1.8);
    });
  });

  describe('splitTextIntoWords - ZWSP boundary (B14)', () => {
    test('treats a zero-width space as a word boundary', () => {
      expect(splitTextIntoWords('alpha' + '\u200B' + 'beta')).toEqual(['alpha', 'beta']);
    });

    test('treats a ZWSP surrounded by real spaces as a boundary, not a token', () => {
      expect(splitTextIntoWords('alpha ' + '\u200B' + ' beta')).toEqual(['alpha', 'beta']);
    });

    test('collapses consecutive ZWSPs into a single boundary', () => {
      expect(splitTextIntoWords('alpha' + '\u200B'.repeat(2) + 'beta')).toEqual(['alpha', 'beta']);
    });

    test('ZWSP boundary works alongside normal spaces in the same string', () => {
      expect(splitTextIntoWords('one' + '\u200B' + 'two three')).toEqual(['one', 'two', 'three']);
    });
  });
});
