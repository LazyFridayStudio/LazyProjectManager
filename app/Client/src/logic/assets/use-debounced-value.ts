import { useEffect, useState } from 'react';

/**
 * The value, once it has stopped changing for a moment.
 *
 * Search runs on the server so the counts beside a category mean what is under
 * it, which is right — and would be one request per keystroke without this. A
 * quarter of a second is long enough that typing "crate" is one request
 * and short enough that nobody waits for it.
 */
export function useDebouncedValue<TValue>(value: TValue, delayMs = 250): TValue {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSettled(value);
    }, delayMs);

    return () => {
      window.clearTimeout(timer);
    };
  }, [value, delayMs]);

  return settled;
}
