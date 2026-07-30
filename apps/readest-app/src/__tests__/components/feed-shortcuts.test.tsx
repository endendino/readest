import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { useFeedShortcuts, type FeedShortcutHandlers } from '@/app/feeds/useFeedShortcuts';

/**
 * FORK: desktop keyboard flow for the feed queue. The critical property is that
 * it never steals keystrokes from a text field — the search box lives in the
 * same view, so a hook that grabbed bare letters would make typing impossible.
 */

const Harness = ({
  handlers,
  enabled = true,
  withInput = false,
}: {
  handlers: FeedShortcutHandlers;
  enabled?: boolean;
  withInput?: boolean;
}) => {
  useFeedShortcuts(handlers, enabled);
  return withInput ? <input data-testid='field' /> : <div data-testid='root' />;
};

const spies = () => ({
  onNext: vi.fn(),
  onPrev: vi.fn(),
  onOpen: vi.fn(),
  onNextArticle: vi.fn(),
  onDone: vi.fn(),
  onSave: vi.fn(),
  onSummarize: vi.fn(),
  onRefresh: vi.fn(),
  onSearch: vi.fn(),
  onEscape: vi.fn(),
});

describe('useFeedShortcuts (FORK)', () => {
  afterEach(() => cleanup());

  test('maps each key to its handler', () => {
    const h = spies();
    render(<Harness handlers={h} />);
    const press = (key: string) => fireEvent.keyDown(document, { key });

    press('j');
    press('k');
    press('o');
    press('n');
    press('d');
    press('s');
    press('a');
    press('r');
    press('/');
    press('Escape');

    expect(h.onNext).toHaveBeenCalledTimes(1);
    expect(h.onPrev).toHaveBeenCalledTimes(1);
    expect(h.onOpen).toHaveBeenCalledTimes(1);
    expect(h.onNextArticle).toHaveBeenCalledTimes(1);
    expect(h.onDone).toHaveBeenCalledTimes(1);
    expect(h.onSave).toHaveBeenCalledTimes(1);
    expect(h.onSummarize).toHaveBeenCalledTimes(1);
    expect(h.onRefresh).toHaveBeenCalledTimes(1);
    expect(h.onSearch).toHaveBeenCalledTimes(1);
    expect(h.onEscape).toHaveBeenCalledTimes(1);
  });

  test('arrows mirror j/k and Enter mirrors o', () => {
    const h = spies();
    render(<Harness handlers={h} />);
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    fireEvent.keyDown(document, { key: 'ArrowUp' });
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(h.onNext).toHaveBeenCalled();
    expect(h.onPrev).toHaveBeenCalled();
    expect(h.onOpen).toHaveBeenCalled();
  });

  test('NEVER fires while typing in a field', () => {
    const h = spies();
    const { getByTestId } = render(<Harness handlers={h} withInput />);
    const field = getByTestId('field');
    // Typing "n", "d", "j" into the search box must reach the input, not the queue.
    fireEvent.keyDown(field, { key: 'n' });
    fireEvent.keyDown(field, { key: 'd' });
    fireEvent.keyDown(field, { key: 'j' });
    fireEvent.keyDown(field, { key: '/' });
    expect(h.onNextArticle).not.toHaveBeenCalled();
    expect(h.onDone).not.toHaveBeenCalled();
    expect(h.onNext).not.toHaveBeenCalled();
    expect(h.onSearch).not.toHaveBeenCalled();
  });

  test('ignores modifier combos so browser shortcuts keep working', () => {
    const h = spies();
    render(<Harness handlers={h} />);
    fireEvent.keyDown(document, { key: 'r', metaKey: true }); // ⌘R reload
    fireEvent.keyDown(document, { key: 'd', ctrlKey: true });
    fireEvent.keyDown(document, { key: 'n', altKey: true });
    expect(h.onRefresh).not.toHaveBeenCalled();
    expect(h.onDone).not.toHaveBeenCalled();
    expect(h.onNextArticle).not.toHaveBeenCalled();
  });

  test('does nothing when disabled (e.g. not reading a feed article)', () => {
    const h = spies();
    render(<Harness handlers={h} enabled={false} />);
    fireEvent.keyDown(document, { key: 'n' });
    expect(h.onNextArticle).not.toHaveBeenCalled();
  });

  test('unbound keys are ignored rather than swallowed', () => {
    // The reader binds only n/d; pressing j there must not preventDefault.
    render(<Harness handlers={{ onNextArticle: vi.fn() }} />);
    const event = new KeyboardEvent('keydown', { key: 'j', bubbles: true, cancelable: true });
    document.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  test('always calls the LATEST handler (no stale closure)', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Harness handlers={{ onNextArticle: first }} />);
    rerender(<Harness handlers={{ onNextArticle: second }} />);
    fireEvent.keyDown(document, { key: 'n' });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  test('unmounting removes the listener', () => {
    const h = spies();
    const { unmount } = render(<Harness handlers={h} />);
    unmount();
    fireEvent.keyDown(document, { key: 'n' });
    expect(h.onNextArticle).not.toHaveBeenCalled();
  });
});
