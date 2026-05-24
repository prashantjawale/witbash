import { describe, it, expect } from 'vitest';
import {
  sortObjectKeys,
  extractHashableState,
  serializeState,
  computeStateHash,
  serializeGameState,
} from './hashState';
import type { GameState } from '../types';

describe('hashState', () => {
  const mockGameState: GameState = {
    phase: 'answer_phase',
    currentRound: 2,
    totalRounds: 4,
    questions: [0, 1, 2, 3],
    featuredPlayerOrder: ['p1', 'p2', 'p3', 'p4'],
    scores: { p2: 3, p1: 1, p3: 0, p4: 2 },
    currentRoundState: {
      questionIndex: 1,
      featuredPlayerId: 'p2',
      questionText: 'What would Alice do?',
      answers: { p3: 'answer3', p1: 'answer1' },
      votes: { p1: 'p3', p4: 'p1' },
      timerEndTime: 1700000000,
    },
  };

  describe('sortObjectKeys', () => {
    it('sorts top-level keys alphabetically', () => {
      const input = { z: 1, a: 2, m: 3 };
      const result = sortObjectKeys(input);
      expect(Object.keys(result)).toEqual(['a', 'm', 'z']);
    });

    it('sorts nested object keys recursively', () => {
      const input = { b: { z: 1, a: 2 }, a: { y: 3, x: 4 } };
      const result = sortObjectKeys(input);
      expect(Object.keys(result)).toEqual(['a', 'b']);
      expect(Object.keys(result.a)).toEqual(['x', 'y']);
      expect(Object.keys(result.b)).toEqual(['a', 'z']);
    });

    it('handles arrays without sorting them', () => {
      const input = { items: [3, 1, 2] };
      const result = sortObjectKeys(input);
      expect(result.items).toEqual([3, 1, 2]);
    });

    it('handles null and undefined', () => {
      expect(sortObjectKeys(null)).toBeNull();
      expect(sortObjectKeys(undefined)).toBeUndefined();
    });

    it('handles primitive values', () => {
      expect(sortObjectKeys(42)).toBe(42);
      expect(sortObjectKeys('hello')).toBe('hello');
      expect(sortObjectKeys(true)).toBe(true);
    });
  });

  describe('extractHashableState', () => {
    it('extracts only consensus-relevant fields', () => {
      const result = extractHashableState(mockGameState);
      expect(result).toEqual({
        answers: { p3: 'answer3', p1: 'answer1' },
        phase: 'answer_phase',
        roundNumber: 2,
        scores: { p2: 3, p1: 1, p3: 0, p4: 2 },
        votes: { p1: 'p3', p4: 'p1' },
      });
    });

    it('does not include non-hashable fields', () => {
      const result = extractHashableState(mockGameState);
      expect(result).not.toHaveProperty('totalRounds');
      expect(result).not.toHaveProperty('questions');
      expect(result).not.toHaveProperty('featuredPlayerOrder');
    });
  });

  describe('serializeState', () => {
    it('produces deterministic output regardless of key insertion order', () => {
      const state1 = {
        answers: { p1: 'a', p2: 'b' },
        phase: 'answer_phase' as const,
        roundNumber: 1,
        scores: { p1: 0, p2: 0 },
        votes: {},
      };

      const state2 = {
        scores: { p2: 0, p1: 0 },
        votes: {},
        phase: 'answer_phase' as const,
        answers: { p2: 'b', p1: 'a' },
        roundNumber: 1,
      };

      expect(serializeState(state1)).toBe(serializeState(state2));
    });

    it('produces valid JSON', () => {
      const hashable = extractHashableState(mockGameState);
      const serialized = serializeState(hashable);
      expect(() => JSON.parse(serialized)).not.toThrow();
    });
  });

  describe('computeStateHash', () => {
    it('returns a 64-character hex string (SHA-256)', async () => {
      const hash = await computeStateHash(mockGameState);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('produces the same hash for the same state', async () => {
      const hash1 = await computeStateHash(mockGameState);
      const hash2 = await computeStateHash(mockGameState);
      expect(hash1).toBe(hash2);
    });

    it('produces the same hash regardless of key order', async () => {
      const state1: GameState = {
        ...mockGameState,
        scores: { p1: 1, p2: 3, p3: 0, p4: 2 },
      };
      const state2: GameState = {
        ...mockGameState,
        scores: { p4: 2, p3: 0, p2: 3, p1: 1 },
      };
      const hash1 = await computeStateHash(state1);
      const hash2 = await computeStateHash(state2);
      expect(hash1).toBe(hash2);
    });

    it('produces different hashes for different states', async () => {
      const differentState: GameState = {
        ...mockGameState,
        scores: { p1: 99, p2: 3, p3: 0, p4: 2 },
      };
      const hash1 = await computeStateHash(mockGameState);
      const hash2 = await computeStateHash(differentState);
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('serializeGameState', () => {
    it('returns a deterministic string', () => {
      const result1 = serializeGameState(mockGameState);
      const result2 = serializeGameState(mockGameState);
      expect(result1).toBe(result2);
    });

    it('keys are sorted alphabetically in output', () => {
      const result = serializeGameState(mockGameState);
      const parsed = JSON.parse(result);
      const keys = Object.keys(parsed);
      expect(keys).toEqual([...keys].sort());
    });
  });
});
