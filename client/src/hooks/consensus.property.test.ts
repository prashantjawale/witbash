import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { serializeGameState } from '../utils/hashState';
import { findMajorityHash } from './useConsensus';
import { gameReducer, INITIAL_STATE } from '../context/GameContext';
import type { GameState, GamePhase, GameSettings, AppState } from '../types';

// ============================================================
// Generators
// ============================================================

const gamePhaseArb: fc.Arbitrary<GamePhase> = fc.constantFrom(
  'lobby',
  'question_display',
  'answer_phase',
  'voting_phase',
  'score_reveal',
  'game_end'
);

const nonLobbyPhaseArb: fc.Arbitrary<GamePhase> = fc.constantFrom(
  'question_display',
  'answer_phase',
  'voting_phase',
  'score_reveal',
  'game_end'
);

const playerIdArb = fc.uuid();

/** Generate a record of playerId → score */
const scoresArb = fc.dictionary(
  fc.uuid(),
  fc.integer({ min: 0, max: 100 }),
  { minKeys: 1, maxKeys: 8 }
);

/** Generate a record of playerId → answer text */
const answersArb = fc.dictionary(
  fc.uuid(),
  fc.string({ minLength: 1, maxLength: 50 }),
  { minKeys: 0, maxKeys: 8 }
);

/** Generate a record of voterId → answerId */
const votesArb = fc.dictionary(
  fc.uuid(),
  fc.uuid(),
  { minKeys: 0, maxKeys: 8 }
);

/** Generate a valid GameState for hashing purposes */
const gameStateArb: fc.Arbitrary<GameState> = fc.record({
  phase: gamePhaseArb,
  currentRound: fc.integer({ min: 1, max: 10 }),
  totalRounds: fc.integer({ min: 3, max: 10 }),
  questions: fc.array(fc.integer({ min: 0, max: 100 }), { minLength: 3, maxLength: 10 }),
  featuredPlayerOrder: fc.array(fc.uuid(), { minLength: 3, maxLength: 10 }),
  scores: scoresArb,
  currentRoundState: fc.record({
    questionIndex: fc.integer({ min: 0, max: 100 }),
    featuredPlayerId: fc.uuid(),
    questionText: fc.string({ minLength: 1, maxLength: 100 }),
    answers: answersArb,
    votes: votesArb,
    timerEndTime: fc.integer({ min: 0, max: 2000000000 }),
  }),
});

/** Generate a GameState with a specific non-lobby phase */
const activeGameStateArb = (phase: GamePhase): fc.Arbitrary<GameState> =>
  gameStateArb.map((gs) => ({ ...gs, phase }));

/** Generate valid GameSettings */
const gameSettingsArb: fc.Arbitrary<GameSettings> = fc
  .tuple(
    fc.integer({ min: 3, max: 10 }),
    fc.integer({ min: 3, max: 10 }),
    fc.integer({ min: 10, max: 300 }),
    fc.integer({ min: 10, max: 300 })
  )
  .filter(([min, max]) => min <= max)
  .map(([minPlayers, maxPlayers, answerTimerSeconds, votingTimerSeconds]) => ({
    minPlayers,
    maxPlayers,
    answerTimerSeconds,
    votingTimerSeconds,
  }));

// ============================================================
// Property 23: State hash determinism
// ============================================================

/**
 * Feature: lan-party-game
 * Property 23: State hash determinism
 *
 * For any game state, computing the state hash multiple times SHALL always
 * produce the same hash value (deterministic serialization).
 *
 * Validates: Requirements 12.1
 */
describe('Property 23: State hash determinism', () => {
  it('serializing the same game state multiple times produces identical results', () => {
    fc.assert(
      fc.property(gameStateArb, (gameState) => {
        const hash1 = serializeGameState(gameState);
        const hash2 = serializeGameState(gameState);
        const hash3 = serializeGameState(gameState);

        expect(hash1).toBe(hash2);
        expect(hash2).toBe(hash3);
      }),
      { numRuns: 200 }
    );
  });

  it('produces the same serialization regardless of object key insertion order', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.uuid(), fc.integer({ min: 0, max: 50 })), { minLength: 2, maxLength: 6 }),
        gamePhaseArb,
        fc.integer({ min: 1, max: 10 }),
        answersArb,
        votesArb,
        (scoreEntries, phase, roundNumber, answers, votes) => {
          // Create two game states with scores inserted in different orders
          const scores1: Record<string, number> = {};
          for (const [id, score] of scoreEntries) {
            scores1[id] = score;
          }

          const scores2: Record<string, number> = {};
          for (const [id, score] of [...scoreEntries].reverse()) {
            scores2[id] = score;
          }

          const baseState: GameState = {
            phase,
            currentRound: roundNumber,
            totalRounds: 5,
            questions: [0, 1, 2, 3, 4],
            featuredPlayerOrder: ['p1', 'p2', 'p3'],
            scores: scores1,
            currentRoundState: {
              questionIndex: 0,
              featuredPlayerId: 'p1',
              questionText: 'Test question',
              answers,
              votes,
              timerEndTime: 1000,
            },
          };

          const altState: GameState = {
            ...baseState,
            scores: scores2,
          };

          const serialized1 = serializeGameState(baseState);
          const serialized2 = serializeGameState(altState);

          expect(serialized1).toBe(serialized2);
        }
      ),
      { numRuns: 200 }
    );
  });
});

// ============================================================
// Property 24: Majority consensus detection
// ============================================================

/**
 * Feature: lan-party-game
 * Property 24: Majority consensus detection
 *
 * For any set of State_Hash reports from connected clients, if more than half
 * report the same hash, that hash SHALL be identified as the authoritative state.
 *
 * Validates: Requirements 12.2
 */
describe('Property 24: Majority consensus detection', () => {
  it('identifies the majority hash when >50% of clients agree', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 3, max: 10 }), // total players
        fc.hexaString({ minLength: 64, maxLength: 64 }), // majority hash
        fc.hexaString({ minLength: 64, maxLength: 64 }), // minority hash
        (totalPlayers, majorityHash, minorityHash) => {
          fc.pre(majorityHash !== minorityHash);

          // Ensure majority count is strictly > 50%
          const majorityCount = Math.floor(totalPlayers / 2) + 1;
          const minorityCount = totalPlayers - majorityCount;

          const hashes = new Map<string, string>();

          // Add majority hashes
          for (let i = 0; i < majorityCount; i++) {
            hashes.set(`player-${i}`, majorityHash);
          }

          // Add minority hashes
          for (let i = 0; i < minorityCount; i++) {
            hashes.set(`minority-${i}`, minorityHash);
          }

          const result = findMajorityHash(hashes, totalPlayers);
          expect(result).toBe(majorityHash);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('returns null when no hash has >50% agreement', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 4, max: 10 }), // total players (need at least 4 for even split)
        fc.array(fc.hexaString({ minLength: 64, maxLength: 64 }), { minLength: 3, maxLength: 5 }),
        (totalPlayers, hashOptions) => {
          // Distribute players evenly across multiple hashes so none exceeds 50%
          const uniqueHashes = [...new Set(hashOptions)];
          fc.pre(uniqueHashes.length >= 2);

          const hashes = new Map<string, string>();
          const maxPerHash = Math.floor(totalPlayers / 2); // At most 50%, not majority

          let assigned = 0;
          for (let i = 0; i < totalPlayers && assigned < totalPlayers; i++) {
            const hashIdx = i % uniqueHashes.length;
            hashes.set(`player-${i}`, uniqueHashes[hashIdx]);
            assigned++;
          }

          // Verify no hash has majority
          const counts = new Map<string, number>();
          for (const h of hashes.values()) {
            counts.set(h, (counts.get(h) ?? 0) + 1);
          }
          const maxCount = Math.max(...counts.values());
          fc.pre(maxCount <= totalPlayers / 2);

          const result = findMajorityHash(hashes, totalPlayers);
          expect(result).toBeNull();
        }
      ),
      { numRuns: 200 }
    );
  });

  it('correctly handles unanimous agreement', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 10 }),
        fc.hexaString({ minLength: 64, maxLength: 64 }),
        (totalPlayers, hash) => {
          const hashes = new Map<string, string>();
          for (let i = 0; i < totalPlayers; i++) {
            hashes.set(`player-${i}`, hash);
          }

          const result = findMajorityHash(hashes, totalPlayers);
          expect(result).toBe(hash);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ============================================================
// Property 28: Settings immutability during game
// ============================================================

/**
 * Feature: lan-party-game
 * Property 28: Settings immutability during game
 *
 * For any game phase other than lobby, attempts to modify Game_Settings
 * SHALL be rejected and the settings SHALL remain unchanged.
 *
 * Validates: Requirements 14.6
 */
describe('Property 28: Settings immutability during game', () => {
  it('rejects settings updates when game is in any non-lobby phase', () => {
    fc.assert(
      fc.property(
        nonLobbyPhaseArb,
        gameSettingsArb,
        gameSettingsArb,
        (phase, currentSettings, newSettings) => {
          // Create a state with an active game in a non-lobby phase
          const state: AppState = {
            ...INITIAL_STATE,
            settings: currentSettings,
            game: {
              phase,
              currentRound: 1,
              totalRounds: 4,
              questions: [0, 1, 2, 3],
              featuredPlayerOrder: ['p1', 'p2', 'p3', 'p4'],
              scores: { p1: 0, p2: 0, p3: 0, p4: 0 },
              currentRoundState: {
                questionIndex: 0,
                featuredPlayerId: 'p1',
                questionText: 'Test question',
                answers: {},
                votes: {},
                timerEndTime: 0,
              },
            },
          };

          const result = gameReducer(state, {
            type: 'UPDATE_SETTINGS',
            settings: newSettings,
          });

          // Settings should remain unchanged
          expect(result.settings).toEqual(currentSettings);
          // State should be returned unchanged
          expect(result).toEqual(state);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('allows settings updates when game is null (lobby)', () => {
    fc.assert(
      fc.property(
        gameSettingsArb,
        gameSettingsArb,
        (currentSettings, newSettings) => {
          const state: AppState = {
            ...INITIAL_STATE,
            settings: currentSettings,
            game: null, // No active game = lobby
          };

          const result = gameReducer(state, {
            type: 'UPDATE_SETTINGS',
            settings: newSettings,
          });

          // Settings should be updated
          expect(result.settings).toEqual(newSettings);
        }
      ),
      { numRuns: 200 }
    );
  });
});
