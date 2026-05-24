import { describe, it, expect } from 'vitest';
import { findMajorityHash } from './useConsensus';

describe('useConsensus', () => {
  describe('findMajorityHash', () => {
    it('returns the hash when more than half agree', () => {
      const hashes = new Map([
        ['p1', 'abc123'],
        ['p2', 'abc123'],
        ['p3', 'abc123'],
        ['p4', 'def456'],
      ]);
      // 3 out of 4 agree (>50%)
      expect(findMajorityHash(hashes, 4)).toBe('abc123');
    });

    it('returns null when no hash has more than half', () => {
      const hashes = new Map([
        ['p1', 'abc123'],
        ['p2', 'def456'],
        ['p3', 'ghi789'],
        ['p4', 'jkl012'],
      ]);
      // No majority (each has 1 out of 4)
      expect(findMajorityHash(hashes, 4)).toBeNull();
    });

    it('returns null when exactly half agree (not more than half)', () => {
      const hashes = new Map([
        ['p1', 'abc123'],
        ['p2', 'abc123'],
        ['p3', 'def456'],
        ['p4', 'def456'],
      ]);
      // 2 out of 4 = exactly 50%, not >50%
      expect(findMajorityHash(hashes, 4)).toBeNull();
    });

    it('returns the majority hash with 3 players (2 agree)', () => {
      const hashes = new Map([
        ['p1', 'abc123'],
        ['p2', 'abc123'],
        ['p3', 'def456'],
      ]);
      // 2 out of 3 > 50%
      expect(findMajorityHash(hashes, 3)).toBe('abc123');
    });

    it('handles single player (always majority)', () => {
      const hashes = new Map([['p1', 'abc123']]);
      // 1 out of 1 > 50%
      expect(findMajorityHash(hashes, 1)).toBe('abc123');
    });

    it('handles empty hash collection', () => {
      const hashes = new Map<string, string>();
      expect(findMajorityHash(hashes, 4)).toBeNull();
    });

    it('uses totalExpected for threshold, not collected count', () => {
      // Only 2 hashes collected but 5 expected
      const hashes = new Map([
        ['p1', 'abc123'],
        ['p2', 'abc123'],
      ]);
      // 2 out of 5 expected = 40%, not majority
      expect(findMajorityHash(hashes, 5)).toBeNull();
    });

    it('detects majority when collected count exceeds threshold', () => {
      const hashes = new Map([
        ['p1', 'abc123'],
        ['p2', 'abc123'],
        ['p3', 'abc123'],
        ['p4', 'def456'],
        ['p5', 'ghi789'],
      ]);
      // 3 out of 5 > 50%
      expect(findMajorityHash(hashes, 5)).toBe('abc123');
    });
  });
});
