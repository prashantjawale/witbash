import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  validatePort,
  isPlayerNameUnique,
  generateRoomCode,
  validateAnswer,
  validateGameSettings,
} from './validation';
import type { GameSettings } from '../types';

/**
 * Feature: lan-party-game
 * Property 1: Invalid port rejection
 *
 * For any port value outside 1024–65535 or non-integer, verify rejection.
 *
 * Validates: Requirements 1.4
 */
describe('Property 1: Invalid port rejection', () => {
  it('rejects any port below 1024', () => {
    fc.assert(
      fc.property(fc.integer({ min: -100000, max: 1023 }), (port) => {
        const result = validatePort(port);
        expect(result.valid).toBe(false);
      })
    );
  });

  it('rejects any port above 65535', () => {
    fc.assert(
      fc.property(fc.integer({ min: 65536, max: 200000 }), (port) => {
        const result = validatePort(port);
        expect(result.valid).toBe(false);
      })
    );
  });

  it('rejects non-integer numeric values', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1024, max: 65535, noInteger: true, noNaN: true }),
        (port) => {
          const result = validatePort(port);
          expect(result.valid).toBe(false);
        }
      )
    );
  });

  it('accepts any valid integer port in range 1024–65535', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1024, max: 65535 }), (port) => {
        const result = validatePort(port);
        expect(result.valid).toBe(true);
      })
    );
  });
});

/**
 * Feature: lan-party-game
 * Property 2: Player name case-insensitive uniqueness
 *
 * For any name matching existing name case-insensitively, verify rejection.
 *
 * Validates: Requirements 2.4
 */
describe('Property 2: Player name case-insensitive uniqueness', () => {
  it('rejects any name that matches an existing name under case-insensitive comparison', () => {
    // Generate a base name (alphanumeric, 1-10 chars) and a list of existing names
    const alphanumChar = fc.mapToConstant(
      { num: 26, build: (v) => String.fromCharCode(65 + v) }, // A-Z
      { num: 26, build: (v) => String.fromCharCode(97 + v) }, // a-z
      { num: 10, build: (v) => String.fromCharCode(48 + v) }  // 0-9
    );
    const nameArb = fc.stringOf(alphanumChar, { minLength: 1, maxLength: 10 });

    fc.assert(
      fc.property(nameArb, (baseName) => {
        // Create a case-variant of the name
        const variant = baseName
          .split('')
          .map((ch) => (Math.random() > 0.5 ? ch.toUpperCase() : ch.toLowerCase()))
          .join('');

        const existingNames = [baseName];
        const isUnique = isPlayerNameUnique(variant, existingNames);
        expect(isUnique).toBe(false);
      })
    );
  });

  it('accepts any name that does not match existing names case-insensitively', () => {
    const alphanumChar = fc.mapToConstant(
      { num: 26, build: (v) => String.fromCharCode(65 + v) }, // A-Z
      { num: 26, build: (v) => String.fromCharCode(97 + v) }, // a-z
      { num: 10, build: (v) => String.fromCharCode(48 + v) }  // 0-9
    );
    const nameArb = fc.stringOf(alphanumChar, { minLength: 1, maxLength: 10 });

    fc.assert(
      fc.property(nameArb, nameArb, (newName, existingName) => {
        // Only test when names are actually different case-insensitively
        fc.pre(newName.toLowerCase() !== existingName.toLowerCase());

        const existingNames = [existingName];
        const isUnique = isPlayerNameUnique(newName, existingNames);
        expect(isUnique).toBe(true);
      })
    );
  });
});

/**
 * Feature: lan-party-game
 * Property 3: Room code format invariant
 *
 * For any generated room code, verify exactly 4 uppercase alphanumeric chars.
 *
 * Validates: Requirements 2.5
 */
describe('Property 3: Room code format invariant', () => {
  it('generates codes that are exactly 4 uppercase alphanumeric characters', () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const code = generateRoomCode();
        expect(code).toHaveLength(4);
        expect(code).toMatch(/^[A-Z0-9]{4}$/);
      }),
      { numRuns: 200 }
    );
  });
});

/**
 * Feature: lan-party-game
 * Property 8: Answer validation
 *
 * For any string, verify acceptance iff 1–280 chars with at least one non-whitespace.
 *
 * Validates: Requirements 5.2
 */
describe('Property 8: Answer validation', () => {
  it('accepts any string with 1–280 chars containing at least one non-whitespace', () => {
    // Generate strings that have at least one non-whitespace char, length 1-280
    const validAnswerArb = fc
      .tuple(
        fc.stringOf(fc.fullUnicode(), { minLength: 0, maxLength: 279 }),
        fc.fullUnicode().filter((ch) => ch.trim().length > 0),
        fc.stringOf(fc.fullUnicode(), { minLength: 0, maxLength: 279 })
      )
      .map(([prefix, nonWs, suffix]) => {
        const combined = prefix + nonWs + suffix;
        return combined.slice(0, 280); // Ensure max 280
      })
      .filter((s) => s.length >= 1 && s.length <= 280 && s.trim().length > 0);

    fc.assert(
      fc.property(validAnswerArb, (answer) => {
        const result = validateAnswer(answer);
        expect(result.valid).toBe(true);
      })
    );
  });

  it('rejects any string that is empty', () => {
    const result = validateAnswer('');
    expect(result.valid).toBe(false);
  });

  it('rejects any string longer than 280 characters', () => {
    fc.assert(
      fc.property(
        fc.stringOf(fc.fullUnicode(), { minLength: 281, maxLength: 500 }),
        (answer) => {
          const result = validateAnswer(answer);
          expect(result.valid).toBe(false);
        }
      )
    );
  });

  it('rejects any whitespace-only string', () => {
    const whitespaceArb = fc.stringOf(
      fc.constantFrom(' ', '\t', '\n', '\r', '\f', '\v'),
      { minLength: 1, maxLength: 280 }
    );

    fc.assert(
      fc.property(whitespaceArb, (answer) => {
        const result = validateAnswer(answer);
        expect(result.valid).toBe(false);
      })
    );
  });
});

/**
 * Feature: lan-party-game
 * Property 27: Settings validation correctness
 *
 * For any combination of game settings values, verify acceptance iff all values in valid ranges:
 * - minPlayers in [3, maxPlayers]
 * - maxPlayers in [minPlayers, 10]
 * - answerTimerSeconds in [10, 300]
 * - votingTimerSeconds in [10, 300]
 *
 * Validates: Requirements 14.3
 */
describe('Property 27: Settings validation correctness', () => {
  it('accepts any settings where all values are integers in valid ranges', () => {
    const validSettingsArb = fc
      .tuple(
        fc.integer({ min: 3, max: 10 }),
        fc.integer({ min: 3, max: 10 }),
        fc.integer({ min: 10, max: 300 }),
        fc.integer({ min: 10, max: 300 })
      )
      .filter(([min, max]) => min <= max)
      .map(([minPlayers, maxPlayers, answerTimerSeconds, votingTimerSeconds]): GameSettings => ({
        minPlayers,
        maxPlayers,
        answerTimerSeconds,
        votingTimerSeconds,
      }));

    fc.assert(
      fc.property(validSettingsArb, (settings) => {
        const result = validateGameSettings(settings);
        expect(result.valid).toBe(true);
      })
    );
  });

  it('rejects settings where minPlayers < 3', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -100, max: 2 }),
        fc.integer({ min: 3, max: 10 }),
        fc.integer({ min: 10, max: 300 }),
        fc.integer({ min: 10, max: 300 }),
        (minPlayers, maxPlayers, answerTimer, votingTimer) => {
          const settings: GameSettings = {
            minPlayers,
            maxPlayers,
            answerTimerSeconds: answerTimer,
            votingTimerSeconds: votingTimer,
          };
          const result = validateGameSettings(settings);
          expect(result.valid).toBe(false);
        }
      )
    );
  });

  it('rejects settings where maxPlayers > 10', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 3, max: 10 }),
        fc.integer({ min: 11, max: 100 }),
        fc.integer({ min: 10, max: 300 }),
        fc.integer({ min: 10, max: 300 }),
        (minPlayers, maxPlayers, answerTimer, votingTimer) => {
          const settings: GameSettings = {
            minPlayers,
            maxPlayers,
            answerTimerSeconds: answerTimer,
            votingTimerSeconds: votingTimer,
          };
          const result = validateGameSettings(settings);
          expect(result.valid).toBe(false);
        }
      )
    );
  });

  it('rejects settings where minPlayers > maxPlayers', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 4, max: 10 }),
        fc.integer({ min: 3, max: 9 }),
        fc.integer({ min: 10, max: 300 }),
        fc.integer({ min: 10, max: 300 }),
        (minPlayers, maxPlayers, answerTimer, votingTimer) => {
          fc.pre(minPlayers > maxPlayers);
          const settings: GameSettings = {
            minPlayers,
            maxPlayers,
            answerTimerSeconds: answerTimer,
            votingTimerSeconds: votingTimer,
          };
          const result = validateGameSettings(settings);
          expect(result.valid).toBe(false);
        }
      )
    );
  });

  it('rejects settings where answerTimerSeconds is out of range [10, 300]', () => {
    const outOfRangeTimer = fc.oneof(
      fc.integer({ min: -100, max: 9 }),
      fc.integer({ min: 301, max: 1000 })
    );

    fc.assert(
      fc.property(
        fc.integer({ min: 3, max: 10 }),
        fc.integer({ min: 3, max: 10 }),
        outOfRangeTimer,
        fc.integer({ min: 10, max: 300 }),
        (minPlayers, maxPlayers, answerTimer, votingTimer) => {
          fc.pre(minPlayers <= maxPlayers);
          const settings: GameSettings = {
            minPlayers,
            maxPlayers,
            answerTimerSeconds: answerTimer,
            votingTimerSeconds: votingTimer,
          };
          const result = validateGameSettings(settings);
          expect(result.valid).toBe(false);
        }
      )
    );
  });

  it('rejects settings where votingTimerSeconds is out of range [10, 300]', () => {
    const outOfRangeTimer = fc.oneof(
      fc.integer({ min: -100, max: 9 }),
      fc.integer({ min: 301, max: 1000 })
    );

    fc.assert(
      fc.property(
        fc.integer({ min: 3, max: 10 }),
        fc.integer({ min: 3, max: 10 }),
        fc.integer({ min: 10, max: 300 }),
        outOfRangeTimer,
        (minPlayers, maxPlayers, answerTimer, votingTimer) => {
          fc.pre(minPlayers <= maxPlayers);
          const settings: GameSettings = {
            minPlayers,
            maxPlayers,
            answerTimerSeconds: answerTimer,
            votingTimerSeconds: votingTimer,
          };
          const result = validateGameSettings(settings);
          expect(result.valid).toBe(false);
        }
      )
    );
  });

  it('rejects settings with non-integer values', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 3, max: 10, noInteger: true, noNaN: true }),
        fc.integer({ min: 3, max: 10 }),
        fc.integer({ min: 10, max: 300 }),
        fc.integer({ min: 10, max: 300 }),
        (minPlayers, maxPlayers, answerTimer, votingTimer) => {
          const settings: GameSettings = {
            minPlayers,
            maxPlayers,
            answerTimerSeconds: answerTimer,
            votingTimerSeconds: votingTimer,
          };
          const result = validateGameSettings(settings);
          expect(result.valid).toBe(false);
        }
      )
    );
  });
});
