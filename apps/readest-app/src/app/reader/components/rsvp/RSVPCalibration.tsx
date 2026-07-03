import { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { useTranslation } from '@/hooks/useTranslation';
import { latinOrpIndex, isRTLText } from '@/services/rsvp/utils';

// Neutral sample text for the ramp; calibration is about finding a comfortable
// RSVP pace, not about a specific passage. Bilingual (English + Hebrew) so the
// calibrated speed isn't measured on a single script the reader may not
// mostly read in (review A14). RTL words are rendered whole (see isRTLWord
// below), matching how the real overlay handles Hebrew (#4630).
const SAMPLE =
  'The quick brown fox jumps over the lazy dog while the morning sun rises slowly above the quiet hills הכלב הזקן ישן על השטיח ליד האח והחתול הקטן משחק בחוט צבעוני and a gentle breeze drifts across the open field carrying the soft distant sound of birds'.split(
    /\s+/,
  );

const START_WPM = 200;
const MAX_WPM = 600;
const STEP_WPM = 20;
const WORDS_PER_STEP = 4; // bump the speed every few words
const COMFORT_FACTOR = 0.85; // settle a little below the "too fast" point

interface RSVPCalibrationProps {
  fontFamily?: string;
  orpColor?: string;
  /** Called with the chosen WPM, or null if the user skipped. */
  onComplete: (wpm: number | null) => void;
}

// First-run "find your speed" ramp: flashes sample text at a steadily rising
// WPM until the reader taps "too fast", then settles just below that point.
export default function RSVPCalibration({
  fontFamily,
  orpColor,
  onComplete,
}: RSVPCalibrationProps) {
  const _ = useTranslation();
  const [word, setWord] = useState(SAMPLE[0] ?? '');
  const [wpm, setWpm] = useState(START_WPM);
  const wpmRef = useRef(START_WPM);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let i = 0;
    let sinceStep = 0;
    let current = START_WPM;
    const tick = () => {
      setWord(SAMPLE[i % SAMPLE.length] ?? '');
      i += 1;
      sinceStep += 1;
      if (sinceStep >= WORDS_PER_STEP && current < MAX_WPM) {
        sinceStep = 0;
        current = Math.min(MAX_WPM, current + STEP_WPM);
        wpmRef.current = current;
        setWpm(current);
      }
      timer.current = setTimeout(tick, 60000 / current);
    };
    tick();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const tooFast = useCallback(() => {
    onComplete(Math.round(wpmRef.current * COMFORT_FACTOR));
  }, [onComplete]);

  const isRTLWord = isRTLText(word);
  const orp = latinOrpIndex(word);
  const before = word.slice(0, orp);
  const pivot = word.charAt(orp);
  const after = word.slice(orp + 1);

  return (
    <div className='absolute inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-base-100/95 px-6 text-center backdrop-blur-sm'>
      <div className='flex flex-col items-center gap-1'>
        <span className='text-sm font-semibold uppercase tracking-wide opacity-70'>
          {_('Find your speed')}
        </span>
        <span className='max-w-xs text-xs opacity-50'>
          {_('Tap the button when the words get too fast to follow comfortably.')}
        </span>
      </div>

      <div
        className={clsx(
          'relative flex min-h-16 w-full items-center justify-center whitespace-nowrap text-4xl font-medium tracking-wide sm:text-5xl',
          !fontFamily && 'font-mono',
        )}
        style={{ fontFamily: fontFamily || undefined }}
      >
        {isRTLWord ? (
          // Whole-word mode for RTL, matching the real overlay: slicing by
          // character index breaks Hebrew letter shaping/order (#4630).
          <span className='font-bold' style={{ color: orpColor }} dir='rtl'>
            {word}
          </span>
        ) : (
          <>
            <span className='absolute text-right opacity-60' style={{ right: 'calc(50% + 0.3em)' }}>
              {before}
            </span>
            <span className='relative z-10 font-bold' style={{ color: orpColor }}>
              {pivot}
            </span>
            <span className='absolute text-left opacity-60' style={{ left: 'calc(50% + 0.3em)' }}>
              {after}
            </span>
          </>
        )}
      </div>

      <div className='tabular-nums text-base font-semibold opacity-80'>
        ≈ {wpm} {_('wpm')}
      </div>

      <div className='flex flex-col items-center gap-2'>
        <button
          type='button'
          onClick={tooFast}
          className='rounded-full bg-gray-500/20 px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-gray-500/30 active:scale-95'
        >
          {_('Too fast — set my speed')}
        </button>
        <button
          type='button'
          onClick={() => onComplete(null)}
          className='text-xs opacity-50 transition-opacity hover:opacity-80'
        >
          {_('Skip')}
        </button>
      </div>
    </div>
  );
}
