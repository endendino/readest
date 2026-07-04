'use client';

import { render, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';

import RSVPOverlay from '@/app/reader/components/rsvp/RSVPOverlay';
import type { RSVPController, RsvpState } from '@/services/rsvp';

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn();
  }
  // jsdom has no ResizeObserver; the shrink-to-fit effect (#C1) constructs one.
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({
    themeCode: { primary: '#000', bg: '#fff', fg: '#111' },
    isDarkMode: false,
  }),
}));

// Stub the dictionary popup/sheet so the overlay test does not pull in the
// whole dictionary provider/registry stack — we only assert it opens with the
// word. The overlay uses the sheet below `sm` and the popup otherwise.
vi.mock('@/app/reader/components/annotator/DictionarySheet', () => ({
  default: ({ word, onDismiss }: { word: string; onDismiss: () => void }) => (
    <div data-testid='rsvp-dict-sheet' data-word={word}>
      <button aria-label='close-dict' onClick={onDismiss}>
        x
      </button>
    </div>
  ),
}));

vi.mock('@/app/reader/components/annotator/DictionaryPopup', () => ({
  default: ({ word, onDismiss }: { word: string; onDismiss: () => void }) => (
    <div data-testid='rsvp-dict-popup' data-word={word}>
      <button aria-label='close-dict' onClick={onDismiss}>
        x
      </button>
    </div>
  ),
}));

const buildState = (overrides: Partial<RsvpState> = {}): RsvpState => ({
  active: true,
  playing: false,
  words: [],
  currentIndex: 0,
  currentPartIndex: 0,
  wpm: 300,
  punctuationPauseMs: 100,
  splitHyphens: false,
  cjkCharMode: false,
  chunking: false,
  warmupRamp: false,
  smoothFlashes: false,
  startDelaySeconds: 3,
  hasCJK: false,
  progress: 0,
  ...overrides,
});

const buildController = (state: RsvpState) => {
  const listeners = new Map<string, EventListener[]>();
  const controller = {
    bookHash: 'testbook',
    get currentState() {
      return state;
    },
    get currentDisplayWord() {
      return state.words[state.currentIndex] ?? null;
    },
    get currentDisplayChunk() {
      const w = state.words[state.currentIndex];
      return w ? [w] : [];
    },
    get currentCountdown() {
      return null;
    },
    seekToIndex: vi.fn(),
    seekToPosition: vi.fn(),
    skipBackward: vi.fn(),
    skipForward: vi.fn(),
    rewindParagraph: vi.fn(),
    nextWord: vi.fn(),
    prevWord: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    togglePlayPause: vi.fn(),
    decreaseSpeed: vi.fn(),
    increaseSpeed: vi.fn(),
    setWpm: vi.fn(),
    setPunctuationPause: vi.fn(),
    setSplitHyphens: vi.fn(),
    setCjkCharMode: vi.fn(),
    setStartDelay: vi.fn(),
    setChunking: vi.fn(),
    setWarmupRamp: vi.fn(),
    setSmoothFlashes: vi.fn(),
    setHoldSlow: vi.fn(),
    getWpmOptions: vi.fn(() => [100, 200, 300]),
    getPunctuationPauseOptions: vi.fn(() => [25, 50, 100]),
    getStartDelayOptions: vi.fn(() => [0, 1, 2, 3]),
    addEventListener: vi.fn((type: string, listener: EventListener) => {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type)!.push(listener);
    }),
    removeEventListener: vi.fn(),
  };
  return controller;
};

const renderOverlay = (state: RsvpState, fontFamily?: string) => {
  const controller = buildController(state);
  const result = render(
    <RSVPOverlay
      gridInsets={{ top: 0, bottom: 0, left: 0, right: 0 }}
      controller={controller as unknown as RSVPController}
      chapters={[]}
      currentChapterHref={null}
      fontFamily={fontFamily}
      onClose={vi.fn()}
      onChapterSelect={vi.fn()}
      onRequestNextPage={vi.fn()}
    />,
  );
  return { ...result, controller };
};

describe('RSVPOverlay — context panel performance', () => {
  afterEach(() => cleanup());

  test('renders a bounded number of word buttons for a large word list', () => {
    const words = Array.from({ length: 5000 }, (_, i) => ({
      text: `word${i}`,
      orpIndex: 0,
      pauseMultiplier: 1,
    }));
    const state = buildState({ words, currentIndex: 2500 });

    const { container } = renderOverlay(state);

    const buttons = container.querySelectorAll('[data-rsvp-word-button]');
    // Without windowing this would be 5000; with windowing it should be far fewer.
    expect(buttons.length).toBeLessThan(2000);
    expect(buttons.length).toBeGreaterThan(0);
  });

  test('clicking a windowed word seeks to that word', () => {
    const words = Array.from({ length: 200 }, (_, i) => ({
      text: `w${i}`,
      orpIndex: 0,
      pauseMultiplier: 1,
    }));
    const state = buildState({ words, currentIndex: 100 });

    const { container, controller } = renderOverlay(state);

    const target = container.querySelector('[data-rsvp-word-index="90"]');
    expect(target).not.toBeNull();
    fireEvent.click(target!);
    expect(controller.seekToIndex).toHaveBeenCalledWith(90);
  });

  test('the current word is rendered with the highlight ref', () => {
    const words = Array.from({ length: 100 }, (_, i) => ({
      text: `w${i}`,
      orpIndex: 0,
      pauseMultiplier: 1,
    }));
    const state = buildState({ words, currentIndex: 42 });

    const { container } = renderOverlay(state);

    const current = container.querySelector('[data-rsvp-word-index="42"]');
    expect(current).not.toBeNull();
    // current word should not be a button (not clickable)
    expect(current!.getAttribute('role')).toBeNull();
  });
});

describe('RSVPOverlay — reading font', () => {
  afterEach(() => cleanup());

  const wordState = () =>
    buildState({ words: [{ text: 'hello', orpIndex: 1, pauseMultiplier: 1 }], currentIndex: 0 });

  test('applies the reader font family to the word display', () => {
    const { container } = renderOverlay(wordState(), '"Bitter", "Source Han Serif CN", serif');
    const word = container.querySelector('.rsvp-word') as HTMLElement;
    expect(word).not.toBeNull();
    expect(word.style.fontFamily).toContain('Bitter');
    // With a reading font supplied, the word no longer uses the monospace fallback.
    expect(word.classList.contains('font-mono')).toBe(false);
  });

  test('falls back to the monospace class when no font family is supplied', () => {
    const { container } = renderOverlay(wordState());
    const word = container.querySelector('.rsvp-word') as HTMLElement;
    expect(word).not.toBeNull();
    expect(word.classList.contains('font-mono')).toBe(true);
    expect(word.style.fontFamily).toBe('');
  });
});

describe('RSVPOverlay — progress bar drag on mobile', () => {
  afterEach(() => cleanup());

  test('horizontal drag starting on the progress bar does not trigger a speed swipe', () => {
    const words = Array.from({ length: 100 }, (_, i) => ({
      text: `w${i}`,
      orpIndex: 0,
      pauseMultiplier: 1,
    }));
    const state = buildState({ words, currentIndex: 10 });

    const { container, controller } = renderOverlay(state);
    const slider = container.querySelector('[role="slider"]') as HTMLElement;
    expect(slider).not.toBeNull();

    // Simulate a horizontal touch drag long enough to clear SWIPE_THRESHOLD (50px).
    fireEvent.touchStart(slider, { touches: [{ clientX: 50, clientY: 400 }] });
    fireEvent.touchEnd(slider, {
      changedTouches: [{ clientX: 200, clientY: 400 }],
    });

    expect(controller.increaseSpeed).not.toHaveBeenCalled();
    expect(controller.decreaseSpeed).not.toHaveBeenCalled();
  });

  test('horizontal drag starting on a footer button does not trigger a speed swipe', () => {
    const state = buildState({
      words: [{ text: 'a', orpIndex: 0, pauseMultiplier: 1 }],
      currentIndex: 0,
    });
    const { container, controller } = renderOverlay(state);
    // Pick any control inside `.rsvp-controls` (e.g. the play/pause button).
    const playButton = container.querySelector('[aria-label="Play"]') as HTMLElement;
    expect(playButton).not.toBeNull();

    fireEvent.touchStart(playButton, { touches: [{ clientX: 50, clientY: 400 }] });
    fireEvent.touchEnd(playButton, {
      changedTouches: [{ clientX: 200, clientY: 400 }],
    });

    expect(controller.increaseSpeed).not.toHaveBeenCalled();
    expect(controller.decreaseSpeed).not.toHaveBeenCalled();
  });

  test('progress bar uses touch-action: none so pointer capture survives on mobile', () => {
    const state = buildState({
      words: [{ text: 'a', orpIndex: 0, pauseMultiplier: 1 }],
      currentIndex: 0,
    });
    const { container } = renderOverlay(state);
    const slider = container.querySelector('[role="slider"]') as HTMLElement;
    expect(slider).not.toBeNull();
    expect(slider.style.touchAction).toBe('none');
  });
});

describe('RSVPOverlay — CJK reading options', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  const openSettings = (container: HTMLElement) => {
    fireEvent.click(container.querySelector('[aria-label="Settings"]') as HTMLElement);
  };

  test('shows Character Mode and Highlight Word toggles for CJK sections', () => {
    const state = buildState({
      words: [{ text: '喜欢', orpIndex: 1, pauseMultiplier: 1 }],
      currentIndex: 0,
      hasCJK: true,
    });
    const { container } = renderOverlay(state);
    openSettings(container);

    expect(container.querySelector('[data-testid="rsvp-char-mode-toggle"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="rsvp-highlight-word-toggle"]')).not.toBeNull();
  });

  test('hides CJK toggles when the section has no CJK text', () => {
    const state = buildState({
      words: [{ text: 'hello', orpIndex: 1, pauseMultiplier: 1 }],
      currentIndex: 0,
      hasCJK: false,
    });
    const { container } = renderOverlay(state);
    openSettings(container);

    expect(container.querySelector('[data-testid="rsvp-char-mode-toggle"]')).toBeNull();
    expect(container.querySelector('[data-testid="rsvp-highlight-word-toggle"]')).toBeNull();
  });

  test('toggling Character Mode calls controller.setCjkCharMode', () => {
    const state = buildState({
      words: [{ text: '喜欢', orpIndex: 1, pauseMultiplier: 1 }],
      currentIndex: 0,
      hasCJK: true,
    });
    const { container, controller } = renderOverlay(state);
    openSettings(container);

    fireEvent.click(
      container.querySelector('[data-testid="rsvp-char-mode-toggle"]') as HTMLElement,
    );
    expect(controller.setCjkCharMode).toHaveBeenCalledWith(true);
  });

  test('renders the focus-letter layout for a CJK word by default', () => {
    const state = buildState({
      words: [{ text: '喜欢', orpIndex: 1, pauseMultiplier: 1 }],
      currentIndex: 0,
      hasCJK: true,
    });
    const { container } = renderOverlay(state);

    expect(container.querySelector('.rsvp-word-orp')).not.toBeNull();
    expect(container.querySelector('.rsvp-word-whole')).toBeNull();
  });

  test('renders a single centered span when Highlight Word is enabled', () => {
    localStorage.setItem('readest_rsvp_cjk_highlight_word', '1');
    const state = buildState({
      words: [{ text: '喜欢', orpIndex: 1, pauseMultiplier: 1 }],
      currentIndex: 0,
      hasCJK: true,
    });
    const { container } = renderOverlay(state);

    const whole = container.querySelector('.rsvp-word-whole');
    expect(whole).not.toBeNull();
    expect(whole!.textContent).toBe('喜欢');
    expect(container.querySelector('.rsvp-word-orp')).toBeNull();
  });

  test('keeps the focus-letter layout for Latin words even with Highlight Word enabled', () => {
    localStorage.setItem('readest_rsvp_cjk_highlight_word', '1');
    const state = buildState({
      words: [{ text: 'hello', orpIndex: 1, pauseMultiplier: 1 }],
      currentIndex: 0,
      hasCJK: false,
    });
    const { container } = renderOverlay(state);

    expect(container.querySelector('.rsvp-word-orp')).not.toBeNull();
    expect(container.querySelector('.rsvp-word-whole')).toBeNull();
  });
});

describe('RSVPOverlay — RTL word display (#4630)', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  test('renders an Arabic word as a single RTL whole-word span, never split', () => {
    const state = buildState({
      words: [{ text: 'علم', orpIndex: 0, pauseMultiplier: 1 }],
      currentIndex: 0,
    });
    const { container } = renderOverlay(state);

    // Splitting the word into before/orp/after spans breaks Arabic shaping and
    // reverses the visual order — RTL words must render whole instead.
    const whole = container.querySelector('.rsvp-word-whole');
    expect(whole).not.toBeNull();
    expect(whole!.textContent).toBe('علم');
    expect(whole!.getAttribute('dir')).toBe('rtl');
    expect(container.querySelector('.rsvp-word-orp')).toBeNull();
    expect(container.querySelector('.rsvp-word-before')).toBeNull();
    expect(container.querySelector('.rsvp-word-after')).toBeNull();
  });

  test('renders a Hebrew word whole as well', () => {
    const state = buildState({
      words: [{ text: 'שלום', orpIndex: 0, pauseMultiplier: 1 }],
      currentIndex: 0,
    });
    const { container } = renderOverlay(state);

    const whole = container.querySelector('.rsvp-word-whole');
    expect(whole).not.toBeNull();
    expect(whole!.textContent).toBe('שלום');
    expect(container.querySelector('.rsvp-word-orp')).toBeNull();
  });

  test('right-aligns and RTL-flows the context panel for a Hebrew document', () => {
    const state = buildState({
      words: [
        { text: 'שלום', orpIndex: 0, pauseMultiplier: 1 },
        { text: 'עולם', orpIndex: 0, pauseMultiplier: 1 },
        { text: 'כאן', orpIndex: 0, pauseMultiplier: 1 },
      ],
      currentIndex: 1,
    });
    const { container } = renderOverlay(state);

    const panel = container.querySelector('[data-testid="rsvp-context-panel"]') as HTMLElement;
    expect(panel).not.toBeNull();
    expect(panel.getAttribute('dir')).toBe('rtl');
    expect(panel.className).toContain('text-right');
    expect(panel.className).not.toContain('text-left');
  });

  test('keeps the context panel LTR/left-aligned for a Latin document', () => {
    const state = buildState({
      words: [
        { text: 'hello', orpIndex: 1, pauseMultiplier: 1 },
        { text: 'world', orpIndex: 1, pauseMultiplier: 1 },
      ],
      currentIndex: 0,
    });
    const { container } = renderOverlay(state);

    const panel = container.querySelector('[data-testid="rsvp-context-panel"]') as HTMLElement;
    expect(panel.getAttribute('dir')).toBe('ltr');
    expect(panel.className).toContain('text-left');
  });

  test('mirrors the whole overlay (root dir=rtl) for a Hebrew document', () => {
    const state = buildState({
      words: [
        { text: 'שלום', orpIndex: 0, pauseMultiplier: 1 },
        { text: 'עולם', orpIndex: 0, pauseMultiplier: 1 },
      ],
      currentIndex: 0,
    });
    const { container } = renderOverlay(state);

    const root = container.querySelector('[data-testid="rsvp-overlay"]') as HTMLElement;
    expect(root.getAttribute('dir')).toBe('rtl');
  });

  test('keeps the overlay LTR for a Latin document', () => {
    const state = buildState({
      words: [{ text: 'hello', orpIndex: 1, pauseMultiplier: 1 }],
      currentIndex: 0,
    });
    const { container } = renderOverlay(state);

    const root = container.querySelector('[data-testid="rsvp-overlay"]') as HTMLElement;
    expect(root.getAttribute('dir')).toBe('ltr');
  });

  test('keeps the focus-letter split for Latin words (no spurious dir)', () => {
    const state = buildState({
      words: [{ text: 'hello', orpIndex: 1, pauseMultiplier: 1 }],
      currentIndex: 0,
    });
    const { container } = renderOverlay(state);

    expect(container.querySelector('.rsvp-word-orp')).not.toBeNull();
    expect(container.querySelector('.rsvp-word-whole')).toBeNull();
  });
});

describe('RSVPOverlay — RTL seek gestures mirror direction', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  const hebrewWords = () =>
    Array.from({ length: 50 }, (_, i) => ({ text: `מ${i}`, orpIndex: 0, pauseMultiplier: 1 }));
  const latinWords = () =>
    Array.from({ length: 50 }, (_, i) => ({ text: `w${i}`, orpIndex: 0, pauseMultiplier: 1 }));

  test('RTL: ArrowLeft on the progress slider seeks forward, ArrowRight seeks back', () => {
    const { container, controller } = renderOverlay(buildState({ words: hebrewWords() }));
    const slider = container.querySelector('[role="slider"]') as HTMLElement;
    // The overlay's capture-phase handler only defers arrows while the slider is
    // focused (#D1); focus it so the slider's own onKeyDown runs.
    slider.focus();

    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(controller.skipForward).toHaveBeenCalledTimes(1);
    expect(controller.skipBackward).not.toHaveBeenCalled();

    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(controller.skipBackward).toHaveBeenCalledTimes(1);
  });

  test('LTR: ArrowLeft seeks back, ArrowRight seeks forward (unchanged)', () => {
    const { container, controller } = renderOverlay(buildState({ words: latinWords() }));
    const slider = container.querySelector('[role="slider"]') as HTMLElement;
    slider.focus();

    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(controller.skipBackward).toHaveBeenCalledTimes(1);
    expect(controller.skipForward).not.toHaveBeenCalled();

    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(controller.skipForward).toHaveBeenCalledTimes(1);
  });

  test('RTL: tapping the left quarter skips forward (edges swap)', () => {
    const { container, controller } = renderOverlay(buildState({ words: hebrewWords() }));
    const root = container.querySelector('[data-testid="rsvp-overlay"]') as HTMLElement;

    // jsdom innerWidth is 1024; clientX 100 is well inside the left quarter.
    fireEvent.touchStart(root, { touches: [{ clientX: 100, clientY: 300 }] });
    fireEvent.touchEnd(root, { changedTouches: [{ clientX: 100, clientY: 300 }] });

    expect(controller.skipForward).toHaveBeenCalledWith(15);
    expect(controller.skipBackward).not.toHaveBeenCalled();
  });

  test('LTR: tapping the left quarter skips backward (unchanged)', () => {
    const { container, controller } = renderOverlay(buildState({ words: latinWords() }));
    const root = container.querySelector('[data-testid="rsvp-overlay"]') as HTMLElement;

    fireEvent.touchStart(root, { touches: [{ clientX: 100, clientY: 300 }] });
    fireEvent.touchEnd(root, { changedTouches: [{ clientX: 100, clientY: 300 }] });

    expect(controller.skipBackward).toHaveBeenCalledWith(15);
    expect(controller.skipForward).not.toHaveBeenCalled();
  });
});

describe('RSVPOverlay — manual word stepping (#4476)', () => {
  afterEach(() => cleanup());

  const wordsState = () =>
    buildState({
      words: Array.from({ length: 10 }, (_, i) => ({
        text: `w${i}`,
        orpIndex: 0,
        pauseMultiplier: 1,
      })),
      currentIndex: 5,
      playing: true,
    });

  // NOTE: the dedicated next/previous-word *buttons* were removed from the
  // overlay UI; manual stepping is keyboard-only ('.' / ','). The two obsolete
  // button tests were failing on baseline against non-existent elements and are
  // superseded by the keyboard test below.
  test('the "." key steps to the next word and "," to the previous word', () => {
    const { controller } = renderOverlay(wordsState());
    fireEvent.keyDown(document, { key: '.' });
    expect(controller.nextWord).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: ',' });
    expect(controller.prevWord).toHaveBeenCalledTimes(1);
  });
});

describe('RSVPOverlay — dictionary lookup (#4475)', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const wordsState = () =>
    buildState({
      words: Array.from({ length: 10 }, (_, i) => ({
        text: `w${i}`,
        orpIndex: 0,
        pauseMultiplier: 1,
      })),
      currentIndex: 5,
      playing: true,
    });

  const mockSelection = (text: string, node: Node | null) => {
    const rect = { left: 20, top: 30, right: 60, bottom: 44, width: 40, height: 14 };
    const range = {
      getBoundingClientRect: () => rect,
      cloneRange() {
        return range;
      },
    };
    vi.spyOn(window, 'getSelection').mockReturnValue({
      isCollapsed: text.length === 0,
      anchorNode: node,
      rangeCount: 1,
      toString: () => text,
      getRangeAt: () => range,
      removeAllRanges: vi.fn(),
    } as unknown as Selection);
  };

  test('the context panel is selectable', () => {
    const { container } = renderOverlay(wordsState());
    const panel = container.querySelector('[data-testid="rsvp-context-panel"]') as HTMLElement;
    expect(panel.className).toContain('select-text');
  });

  test('selecting text in the context panel reveals a Look up action', () => {
    const { container } = renderOverlay(wordsState());
    const panel = container.querySelector('[data-testid="rsvp-context-panel"]') as HTMLElement;
    mockSelection('serendipity', panel);
    fireEvent.mouseUp(panel);
    expect(container.querySelector('[aria-label="Look up"]')).not.toBeNull();
  });

  test('tapping Look up pauses playback and opens the dictionary with the selected text', () => {
    const { container, controller } = renderOverlay(wordsState());
    const panel = container.querySelector('[data-testid="rsvp-context-panel"]') as HTMLElement;
    mockSelection('serendipity', panel);
    fireEvent.mouseUp(panel);
    fireEvent.click(container.querySelector('[aria-label="Look up"]') as HTMLElement);

    expect(controller.pause).toHaveBeenCalled();
    // jsdom's default viewport is desktop-sized, so the anchored popup is used.
    const popup = container.querySelector('[data-testid="rsvp-dict-popup"]');
    expect(popup).not.toBeNull();
    expect(popup!.getAttribute('data-word')).toBe('serendipity');
  });

  test('clicking outside the popup dismisses it', () => {
    const { container } = renderOverlay(wordsState());
    const panel = container.querySelector('[data-testid="rsvp-context-panel"]') as HTMLElement;
    mockSelection('serendipity', panel);
    fireEvent.mouseUp(panel);
    fireEvent.click(container.querySelector('[aria-label="Look up"]') as HTMLElement);
    expect(container.querySelector('[data-testid="rsvp-dict-popup"]')).not.toBeNull();

    // The transparent full-screen catcher behind the popup dismisses on click.
    fireEvent.click(container.querySelector('.overlay') as HTMLElement);
    expect(container.querySelector('[data-testid="rsvp-dict-popup"]')).toBeNull();
  });

  test('uses the bottom sheet on small screens', () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(420);
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(720);
    const { container } = renderOverlay(wordsState());
    const panel = container.querySelector('[data-testid="rsvp-context-panel"]') as HTMLElement;
    mockSelection('serendipity', panel);
    fireEvent.mouseUp(panel);
    fireEvent.click(container.querySelector('[aria-label="Look up"]') as HTMLElement);

    expect(container.querySelector('[data-testid="rsvp-dict-sheet"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="rsvp-dict-popup"]')).toBeNull();
  });

  test('an active selection suppresses word-click seeking', () => {
    const { container, controller } = renderOverlay(wordsState());
    const panel = container.querySelector('[data-testid="rsvp-context-panel"]') as HTMLElement;
    mockSelection('w3 w4', panel);
    fireEvent.click(container.querySelector('[data-rsvp-word-index="3"]') as HTMLElement);
    expect(controller.seekToIndex).not.toHaveBeenCalled();
  });
});

describe('RSVPOverlay — start delay setting (#4478)', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  const openSettings = (container: HTMLElement) => {
    fireEvent.click(container.querySelector('[aria-label="Settings"]') as HTMLElement);
  };

  test('changing the Start Delay select calls controller.setStartDelay', () => {
    const state = buildState({
      words: [{ text: 'a', orpIndex: 0, pauseMultiplier: 1 }],
      currentIndex: 0,
      startDelaySeconds: 3,
    });
    const { container, controller } = renderOverlay(state);
    openSettings(container);

    const select = container.querySelector(
      '[data-testid="rsvp-start-delay-select"]',
    ) as HTMLSelectElement;
    expect(select).not.toBeNull();
    fireEvent.change(select, { target: { value: '0' } });
    expect(controller.setStartDelay).toHaveBeenCalledWith(0);
  });
});

describe('RSVPOverlay — shrink-to-fit (#C1)', () => {
  afterEach(() => cleanup());

  test('wraps the focal word in an inner scaling element (positioning context)', () => {
    const state = buildState({
      words: [{ text: 'hello', orpIndex: 1, pauseMultiplier: 1 }],
      currentIndex: 0,
    });
    const { container } = renderOverlay(state);
    const word = container.querySelector('.rsvp-word') as HTMLElement;
    // The split halves anchor to an inner scaling wrapper, not the outer box.
    const inner = word.querySelector(':scope > div') as HTMLElement;
    expect(inner).not.toBeNull();
    expect(inner.querySelector('.rsvp-word-orp')).not.toBeNull();
  });
});

describe('RSVPOverlay — dialog semantics (#D2)', () => {
  afterEach(() => cleanup());

  test('the overlay root is a modal dialog', () => {
    const state = buildState({
      words: [{ text: 'a', orpIndex: 0, pauseMultiplier: 1 }],
      currentIndex: 0,
    });
    const { container } = renderOverlay(state);
    const root = container.querySelector('[data-testid="rsvp-overlay"]') as HTMLElement;
    expect(root.getAttribute('role')).toBe('dialog');
    expect(root.getAttribute('aria-modal')).toBe('true');
  });
});

describe('RSVPOverlay — context panel a11y (#D3)', () => {
  afterEach(() => cleanup());

  const wordsState = () =>
    buildState({
      words: Array.from({ length: 200 }, (_, i) => ({
        text: `w${i}`,
        orpIndex: 0,
        pauseMultiplier: 1,
      })),
      currentIndex: 100,
    });

  test('windowed words are not individually tab-focusable or role=button', () => {
    const { container } = renderOverlay(wordsState());
    const words = container.querySelectorAll('[data-rsvp-word-button]');
    expect(words.length).toBeGreaterThan(0);
    for (const el of Array.from(words)) {
      expect(el.getAttribute('tabindex')).toBeNull();
      expect(el.getAttribute('role')).toBeNull();
    }
  });

  test('clicking a windowed word still seeks (click-to-seek preserved)', () => {
    const { container, controller } = renderOverlay(wordsState());
    const target = container.querySelector('[data-rsvp-word-index="90"]') as HTMLElement;
    expect(target).not.toBeNull();
    fireEvent.click(target);
    expect(controller.seekToIndex).toHaveBeenCalledWith(90);
  });

  test('clicking the current word does not seek', () => {
    const { container, controller } = renderOverlay(wordsState());
    const current = container.querySelector('[data-rsvp-word-index="100"]') as HTMLElement;
    fireEvent.click(current);
    expect(controller.seekToIndex).not.toHaveBeenCalled();
  });
});

describe('RSVPOverlay — context panel does not toggle playback (#C2)', () => {
  afterEach(() => cleanup());

  test('the context panel container carries rsvp-controls so taps are ignored', () => {
    const state = buildState({
      words: [{ text: 'a', orpIndex: 0, pauseMultiplier: 1 }],
      currentIndex: 0,
    });
    const { container } = renderOverlay(state);
    // The collapse header lives inside the rsvp-controls-marked container, so a
    // tap on it can never bubble to the overlay center tap-zone.
    const header = container.querySelector('[aria-label="Hide context"]') as HTMLElement;
    expect(header).not.toBeNull();
    expect(header.closest('.rsvp-controls')).not.toBeNull();
  });
});

describe('RSVPOverlay — progress slider keyboard (#D1)', () => {
  afterEach(() => cleanup());

  const sliderState = () =>
    buildState({
      words: Array.from({ length: 10 }, (_, i) => ({
        text: `w${i}`,
        orpIndex: 0,
        pauseMultiplier: 1,
      })),
      currentIndex: 5,
    });

  test("the slider's own onKeyDown ignores Tab (no seek), so it is not a key trap", () => {
    const { container, controller } = renderOverlay(sliderState());
    const slider = container.querySelector('[role="slider"]') as HTMLElement;
    // The slider handler previously preventDefaulted *every* key (incl. Tab);
    // now it only claims arrows. Tab must not be treated as a seek key.
    fireEvent.keyDown(slider, { key: 'Tab' });
    expect(controller.skipForward).not.toHaveBeenCalled();
    expect(controller.skipBackward).not.toHaveBeenCalled();
  });

  test('ArrowRight on the slider seeks forward and is handled', () => {
    const { container, controller } = renderOverlay(sliderState());
    const slider = container.querySelector('[role="slider"]') as HTMLElement;
    slider.focus();
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(controller.skipForward).toHaveBeenCalled();
  });
});

describe('RSVPOverlay — symmetric tap zones (#C6)', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  test('left-quarter tap skips backward (mirrors the right-quarter forward skip)', () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(400);
    const state = buildState({
      words: Array.from({ length: 100 }, (_, i) => ({
        text: `w${i}`,
        orpIndex: 0,
        pauseMultiplier: 1,
      })),
      currentIndex: 50,
    });
    const { container, controller } = renderOverlay(state);
    const root = container.querySelector('[data-testid="rsvp-overlay"]') as HTMLElement;
    // Tap in the left quarter (x=40 of 400 → < 100).
    fireEvent.touchStart(root, { touches: [{ clientX: 40, clientY: 300 }] });
    fireEvent.touchEnd(root, { changedTouches: [{ clientX: 40, clientY: 300 }] });
    expect(controller.skipBackward).toHaveBeenCalledWith(15);
    expect(controller.rewindParagraph).not.toHaveBeenCalled();
  });
});

describe('RSVPOverlay — Escape closes topmost layer first (#C8)', () => {
  // The calibration ramp shows by default (no prior calibration); mark it done
  // so Escape isn't consumed closing calibration.
  beforeAll(() => localStorage.setItem('readest_rsvp_calibrated_testbook', '1'));
  afterEach(() => cleanup());

  test('Escape closes an open chapter dropdown instead of the whole session', () => {
    const state = buildState({
      words: [{ text: 'a', orpIndex: 0, pauseMultiplier: 1 }],
      currentIndex: 0,
    });
    const controller = buildController(state);
    const onClose = vi.fn();
    const { container } = render(
      <RSVPOverlay
        gridInsets={{ top: 0, bottom: 0, left: 0, right: 0 }}
        controller={controller as unknown as RSVPController}
        chapters={[{ label: 'Ch 1', href: 'a.html', subitems: [] }] as never}
        currentChapterHref={'a.html'}
        onClose={onClose}
        onChapterSelect={vi.fn()}
        onRequestNextPage={vi.fn()}
      />,
    );
    // The chapter selector button shows the current chapter label; open it.
    const chapterButton = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Ch 1'),
    ) as HTMLElement;
    expect(chapterButton).not.toBeUndefined();
    fireEvent.click(chapterButton);
    // Escape should close the dropdown, not call onClose.
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  test('Escape with nothing layered closes the session', () => {
    const state = buildState({
      words: [{ text: 'a', orpIndex: 0, pauseMultiplier: 1 }],
      currentIndex: 0,
    });
    const controller = buildController(state);
    const onClose = vi.fn();
    render(
      <RSVPOverlay
        gridInsets={{ top: 0, bottom: 0, left: 0, right: 0 }}
        controller={controller as unknown as RSVPController}
        chapters={[]}
        currentChapterHref={null}
        onClose={onClose}
        onChapterSelect={vi.fn()}
        onRequestNextPage={vi.fn()}
      />,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('RSVPOverlay — RTL word colour (#A8)', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  test('an RTL whole word renders in the default colour (no ORP accent)', () => {
    const state = buildState({
      words: [{ text: 'שלום', orpIndex: 0, pauseMultiplier: 1 }],
      currentIndex: 0,
    });
    const { container } = renderOverlay(state);
    const whole = container.querySelector('.rsvp-word-whole') as HTMLElement;
    expect(whole).not.toBeNull();
    // No inline colour → inherits the overlay's default fg.
    expect(whole.style.color).toBe('');
  });

  test('the CJK Highlight Word mode still colours the whole word', () => {
    localStorage.setItem('readest_rsvp_cjk_highlight_word', '1');
    const state = buildState({
      words: [{ text: '喜欢', orpIndex: 1, pauseMultiplier: 1 }],
      currentIndex: 0,
      hasCJK: true,
    });
    const { container } = renderOverlay(state);
    const whole = container.querySelector('.rsvp-word-whole') as HTMLElement;
    expect(whole.style.color).not.toBe('');
  });
});

describe('RSVPOverlay — audio toggle label (#D5)', () => {
  afterEach(() => cleanup());

  test('the engaged audio toggle says "Stop audio", not "Pause audio"', () => {
    const state = buildState({
      words: [{ text: 'a', orpIndex: 0, pauseMultiplier: 1 }],
      currentIndex: 0,
    });
    const controller = buildController(state);
    const { container } = render(
      <RSVPOverlay
        gridInsets={{ top: 0, bottom: 0, left: 0, right: 0 }}
        controller={controller as unknown as RSVPController}
        chapters={[]}
        currentChapterHref={null}
        ttsActive
        onToggleTtsAudio={vi.fn()}
        onClose={vi.fn()}
        onChapterSelect={vi.fn()}
        onRequestNextPage={vi.fn()}
      />,
    );
    expect(container.querySelector('[aria-label="Stop audio"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Pause audio"]')).toBeNull();
  });
});

describe('RSVPOverlay — per-word direction in a chunk (#C7)', () => {
  afterEach(() => cleanup());

  const buildChunkController = (state: RsvpState, chunk: RsvpState['words']) => {
    const listeners = new Map<string, EventListener[]>();
    return {
      get currentState() {
        return state;
      },
      get currentDisplayWord() {
        return chunk[0] ?? null;
      },
      get currentDisplayChunk() {
        return chunk;
      },
      get currentCountdown() {
        return null;
      },
      seekToIndex: vi.fn(),
      seekToPosition: vi.fn(),
      skipBackward: vi.fn(),
      skipForward: vi.fn(),
      rewindParagraph: vi.fn(),
      nextWord: vi.fn(),
      prevWord: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      togglePlayPause: vi.fn(),
      decreaseSpeed: vi.fn(),
      increaseSpeed: vi.fn(),
      setWpm: vi.fn(),
      setPunctuationPause: vi.fn(),
      setSplitHyphens: vi.fn(),
      setCjkCharMode: vi.fn(),
      setStartDelay: vi.fn(),
      setChunking: vi.fn(),
      setWarmupRamp: vi.fn(),
      setSmoothFlashes: vi.fn(),
      setHoldSlow: vi.fn(),
      getWpmOptions: vi.fn(() => [100, 200, 300]),
      getPunctuationPauseOptions: vi.fn(() => [25, 50, 100]),
      getStartDelayOptions: vi.fn(() => [0, 1, 2, 3]),
      addEventListener: vi.fn((type: string, listener: EventListener) => {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type)!.push(listener);
      }),
      removeEventListener: vi.fn(),
    };
  };

  test('only the Hebrew word in a mixed chunk gets dir=rtl (no wholesale flip)', () => {
    const chunk = [
      { text: 'the', orpIndex: 1, pauseMultiplier: 1 },
      { text: 'שלום', orpIndex: 0, pauseMultiplier: 1 },
      { text: 'cat', orpIndex: 1, pauseMultiplier: 1 },
    ];
    const state = buildState({ words: chunk, currentIndex: 0, chunking: true });
    const controller = buildChunkController(state, chunk);
    const { container } = render(
      <RSVPOverlay
        gridInsets={{ top: 0, bottom: 0, left: 0, right: 0 }}
        controller={controller as unknown as RSVPController}
        chapters={[]}
        currentChapterHref={null}
        onClose={vi.fn()}
        onChapterSelect={vi.fn()}
        onRequestNextPage={vi.fn()}
      />,
    );
    const wordBox = container.querySelector('.rsvp-word') as HTMLElement;
    // The chunk flex wrapper itself must not force a direction.
    const chunkWrapper = wordBox.querySelector(':scope > div > div') as HTMLElement;
    expect(chunkWrapper.getAttribute('dir')).toBeNull();
    // Exactly one span carries dir=rtl (the Hebrew word); the Latin words don't.
    const rtlSpans = wordBox.querySelectorAll('[dir="rtl"]');
    expect(rtlSpans.length).toBe(1);
    expect(rtlSpans[0]!.textContent).toBe('שלום');
    // The Hebrew word in a chunk renders in the default colour (#A8).
    expect((rtlSpans[0] as HTMLElement).style.color).toBe('');
  });
});
