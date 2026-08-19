/* ============================================================
 * NodeFM Station — useNowUtcMs
 *
 * React hook for periodic UTC clock ticks. Timeline math stays
 * pure and receives this value explicitly.
 * ============================================================ */

import { useEffect, useState } from 'react';
import { getNowUtcMs } from '../timeline/clock';

export function useNowUtcMs(intervalMs = 1_000): number {
  const [nowUtcMs, setNowUtcMs] = useState(getNowUtcMs());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowUtcMs(getNowUtcMs());
    }, intervalMs);

    return () => {
      window.clearInterval(timer);
    };
  }, [intervalMs]);

  return nowUtcMs;
}
