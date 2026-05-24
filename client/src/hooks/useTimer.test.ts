import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTimer } from './useTimer';

describe('useTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('initializes with zero seconds and inactive state', () => {
    const { result } = renderHook(() => useTimer());

    expect(result.current.secondsRemaining).toBe(0);
    expect(result.current.isActive).toBe(false);
  });

  it('starts a countdown with the given duration', () => {
    const { result } = renderHook(() => useTimer());

    act(() => {
      result.current.start(60);
    });

    expect(result.current.secondsRemaining).toBe(60);
    expect(result.current.isActive).toBe(true);
  });

  it('decrements secondsRemaining as time passes', () => {
    const { result } = renderHook(() => useTimer());

    act(() => {
      result.current.start(10);
    });

    expect(result.current.secondsRemaining).toBe(10);

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(result.current.secondsRemaining).toBe(7);
  });

  it('stops the timer and resets state', () => {
    const { result } = renderHook(() => useTimer());

    act(() => {
      result.current.start(30);
    });

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    act(() => {
      result.current.stop();
    });

    expect(result.current.isActive).toBe(false);
  });

  it('triggers onExpiry callback when timer reaches zero', () => {
    const onExpiry = vi.fn();
    const { result } = renderHook(() => useTimer({ onExpiry }));

    act(() => {
      result.current.start(5);
    });

    expect(onExpiry).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(onExpiry).toHaveBeenCalledTimes(1);
    expect(result.current.isActive).toBe(false);
    expect(result.current.secondsRemaining).toBe(0);
  });

  it('does not trigger onExpiry when stopped manually', () => {
    const onExpiry = vi.fn();
    const { result } = renderHook(() => useTimer({ onExpiry }));

    act(() => {
      result.current.start(10);
    });

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    act(() => {
      result.current.stop();
    });

    act(() => {
      vi.advanceTimersByTime(10000);
    });

    expect(onExpiry).not.toHaveBeenCalled();
  });

  it('handles starting a new timer while one is active', () => {
    const onExpiry = vi.fn();
    const { result } = renderHook(() => useTimer({ onExpiry }));

    act(() => {
      result.current.start(10);
    });

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    // Start a new timer — should replace the old one
    act(() => {
      result.current.start(20);
    });

    expect(result.current.secondsRemaining).toBe(20);
    expect(result.current.isActive).toBe(true);

    // Old timer should not fire
    act(() => {
      vi.advanceTimersByTime(8000);
    });

    expect(onExpiry).not.toHaveBeenCalled();
    expect(result.current.secondsRemaining).toBe(12);
  });

  it('fires onExpiry immediately for zero duration', () => {
    const onExpiry = vi.fn();
    const { result } = renderHook(() => useTimer({ onExpiry }));

    act(() => {
      result.current.start(0);
    });

    expect(onExpiry).toHaveBeenCalledTimes(1);
    expect(result.current.isActive).toBe(false);
    expect(result.current.secondsRemaining).toBe(0);
  });

  it('fires onExpiry immediately for negative duration', () => {
    const onExpiry = vi.fn();
    const { result } = renderHook(() => useTimer({ onExpiry }));

    act(() => {
      result.current.start(-5);
    });

    expect(onExpiry).toHaveBeenCalledTimes(1);
    expect(result.current.isActive).toBe(false);
    expect(result.current.secondsRemaining).toBe(0);
  });

  it('uses ceiling for secondsRemaining to avoid showing 0 prematurely', () => {
    const { result } = renderHook(() => useTimer());

    act(() => {
      result.current.start(5);
    });

    // Advance 4.5 seconds — should still show 1 second remaining (ceil)
    act(() => {
      vi.advanceTimersByTime(4500);
    });

    expect(result.current.secondsRemaining).toBeGreaterThanOrEqual(1);
    expect(result.current.isActive).toBe(true);
  });

  it('cleans up interval on unmount', () => {
    const { result, unmount } = renderHook(() => useTimer());

    act(() => {
      result.current.start(60);
    });

    unmount();

    // No errors should occur after unmount
    act(() => {
      vi.advanceTimersByTime(60000);
    });
  });

  it('picks up updated onExpiry callback', () => {
    const onExpiry1 = vi.fn();
    const onExpiry2 = vi.fn();

    const { result, rerender } = renderHook(
      ({ onExpiry }) => useTimer({ onExpiry }),
      { initialProps: { onExpiry: onExpiry1 } }
    );

    act(() => {
      result.current.start(5);
    });

    // Change the callback mid-timer
    rerender({ onExpiry: onExpiry2 });

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(onExpiry1).not.toHaveBeenCalled();
    expect(onExpiry2).toHaveBeenCalledTimes(1);
  });
});
