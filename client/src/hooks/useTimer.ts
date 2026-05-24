import { useState, useEffect, useRef, useCallback } from 'react';

export interface UseTimerOptions {
  onExpiry?: () => void;
}

export interface UseTimerReturn {
  secondsRemaining: number;
  isActive: boolean;
  start: (durationSeconds: number) => void;
  stop: () => void;
}

/**
 * Custom hook for managing countdown timers during answer and voting phases.
 * Supports starting/stopping, expiry callbacks, and synchronization via
 * absolute end times across phase transitions.
 */
export function useTimer(options: UseTimerOptions = {}): UseTimerReturn {
  const { onExpiry } = options;

  const [secondsRemaining, setSecondsRemaining] = useState(0);
  const [isActive, setIsActive] = useState(false);

  // Store the absolute end time (ms since epoch) for synchronization
  const endTimeRef = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onExpiryRef = useRef(onExpiry);

  // Keep the callback ref up to date without re-triggering effects
  useEffect(() => {
    onExpiryRef.current = onExpiry;
  }, [onExpiry]);

  const clearTimer = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    clearTimer();
    setIsActive(false);
    endTimeRef.current = null;
  }, [clearTimer]);

  const start = useCallback((durationSeconds: number) => {
    // Stop any existing timer
    clearTimer();

    if (durationSeconds <= 0) {
      setSecondsRemaining(0);
      setIsActive(false);
      endTimeRef.current = null;
      // Fire expiry immediately for zero/negative duration
      onExpiryRef.current?.();
      return;
    }

    const now = Date.now();
    const endTime = now + durationSeconds * 1000;
    endTimeRef.current = endTime;

    setSecondsRemaining(durationSeconds);
    setIsActive(true);

    intervalRef.current = setInterval(() => {
      const remaining = Math.max(
        0,
        Math.ceil((endTimeRef.current! - Date.now()) / 1000)
      );

      setSecondsRemaining(remaining);

      if (remaining <= 0) {
        clearTimer();
        setIsActive(false);
        endTimeRef.current = null;
        onExpiryRef.current?.();
      }
    }, 250); // Update every 250ms for smooth countdown without drift
  }, [clearTimer]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearTimer();
    };
  }, [clearTimer]);

  return { secondsRemaining, isActive, start, stop };
}
