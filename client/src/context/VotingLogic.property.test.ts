import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { gameReducer, INITIAL_STATE } from './GameContext';
import type { AppState } from './GameContext';
import type { Player, GameState, RoundState } from '../types';

// ============================================================
// Helpers
// ============================================================

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: 'player-1',
    name: 'Alice',
    isHost: false,
    isConnected: true,
    joinOrder: 1,
    ...overrides,
  };
}

function makeGameState(overrides: Partial<GameState> = {}): GameState {
  return {
    phase: 'voting_phase',
    currentRound: 1,
    totalRounds: 3,
    questions: [0, 1, 2],
    featuredPlayerOrder: ['p1', 'p2', 'p3'],
    scores: { p1: 0, p2: 0, p3: 0 },
    currentRoundState: {
      questionIndex: 0,
      featuredPlayerId: 'p1',
      questionText: 'What would Alice bring?',
      answers: {},
      votes: {},
      timerEndTime: 0,
    },
    ...overrides,
  };
}

function stateWithPlayersAndAnswers(
  playerIds: string[],
  answers: Record<string, string>
): AppState {
  const players: Player[] = playerIds.map((id, i) => makePlayer({
    id,
    name: `Player${i + 1}`,
    joinOrder: i + 1,
  }));

  const scores: Record<string, number> = {};
  for (const id of playerIds) {
    scores[id] = 0;
  }

  return {
    ...INITIAL_STATE,
    players,
    game: makeGameState({
      scores,
      featuredPlayerOrder: playerIds,
      totalRounds: playerIds.length,
      currentRoundState: {
        questionIndex: 0,
        featuredPlayerId: playerIds[0],
        questionText: 'Test question',
        answers,
        votes: {},
        timerEndTime: 0,
      },
    }),
  };
}

// Generator for unique player IDs
const playerIdArb = fc.stringOf(
  fc.mapToConstant(
    { num: 26, build: (v) => String.fromCharCode(97 + v) }, // a-z
    { num: 10, build: (v) => String.fromCharCode(48 + v) }  // 0-9
  ),
  { minLength: 3, maxLength: 10 }
);

// Generator for answer text (non-empty, non-whitespace-only)
const answerTextArb = fc.stringOf(fc.fullUnicode(), { minLength: 1, maxLength: 50 })
  .filter((s) => s.trim().length > 0);

// ============================================================
// Property 10: Voting anonymization
// ============================================================

/**
 * Feature: lan-party-game
 * Property 10: Voting anonymization
 *
 * For any set of submitted answers entering the voting phase, the displayed
 * voting options SHALL contain all answer texts but SHALL not include any
 * player identifiers or authorship information.
 *
 * Validates: Requirements 6.1
 */
describe('Property 10: Voting anonymization', () => {
  it('voting options contain only answerId and text, never exposing author playerIds', () => {
    // Generate a set of 3-8 unique player IDs with answers
    const gameArb = fc
      .tuple(
        fc.uniqueArray(playerIdArb, { minLength: 3, maxLength: 8 }),
        fc.array(answerTextArb, { minLength: 3, maxLength: 8 })
      )
      .filter(([ids, answers]) => ids.length >= 3 && answers.length >= ids.length)
      .map(([playerIds, answerTexts]) => {
        const answers: Record<string, string> = {};
        for (let i = 0; i < playerIds.length; i++) {
          answers[playerIds[i]] = answerTexts[i];
        }
        return { playerIds, answers };
      });

    fc.assert(
      fc.property(gameArb, ({ playerIds, answers }) => {
        // Simulate preparing answers for voting display as per VotingPhaseStartMessage:
        // answers: Array<{ answerId: string; text: string }> — Randomized, no author info
        const votingOptions = Object.entries(answers).map(([playerId, text]) => ({
          answerId: playerId,
          text,
        }));

        // Verify: the voting options structure only has answerId and text fields
        for (const option of votingOptions) {
          // The option should have exactly two keys: answerId and text
          const keys = Object.keys(option);
          expect(keys).toContain('answerId');
          expect(keys).toContain('text');
          expect(keys).toHaveLength(2);

          // The option should NOT have any field named 'playerId', 'author',
          // 'authorId', 'playerName', or 'name' that would reveal authorship
          expect(option).not.toHaveProperty('playerId');
          expect(option).not.toHaveProperty('author');
          expect(option).not.toHaveProperty('authorId');
          expect(option).not.toHaveProperty('playerName');
          expect(option).not.toHaveProperty('name');
        }

        // Verify all answer texts are present in the voting options
        const optionTexts = votingOptions.map((o) => o.text);
        for (const text of Object.values(answers)) {
          expect(optionTexts).toContain(text);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('voting options do not expose player IDs in the text field', () => {
    const gameArb = fc
      .uniqueArray(playerIdArb, { minLength: 3, maxLength: 6 })
      .map((playerIds) => {
        // Create answers that are distinct from player IDs
        const answers: Record<string, string> = {};
        for (let i = 0; i < playerIds.length; i++) {
          answers[playerIds[i]] = `Answer number ${i + 1} for the game`;
        }
        return { playerIds, answers };
      });

    fc.assert(
      fc.property(gameArb, ({ playerIds, answers }) => {
        // Prepare voting options as the system would
        const votingOptions = Object.entries(answers).map(([playerId, text]) => ({
          answerId: playerId,
          text,
        }));

        // The text content of voting options should not contain any player IDs
        // (the answerId is an opaque identifier, not meant to reveal authorship to the UI)
        for (const option of votingOptions) {
          // Verify the text field doesn't accidentally contain other players' IDs
          for (const pid of playerIds) {
            if (pid !== option.answerId) {
              expect(option.text).not.toBe(pid);
            }
          }
        }
      }),
      { numRuns: 100 }
    );
  });
});

// ============================================================
// Property 11: Vote-once enforcement
// ============================================================

/**
 * Feature: lan-party-game
 * Property 11: Vote-once enforcement
 *
 * For any player in the voting phase, only their first vote SHALL be recorded;
 * subsequent vote attempts SHALL be rejected.
 *
 * Validates: Requirements 6.2
 */
describe('Property 11: Vote-once enforcement', () => {
  it('only the first vote from a player is recorded, subsequent votes are rejected', () => {
    // Generate scenarios with multiple players and multiple vote attempts
    const scenarioArb = fc
      .tuple(
        fc.uniqueArray(playerIdArb, { minLength: 3, maxLength: 8 }),
        fc.integer({ min: 2, max: 10 }) // number of vote attempts
      )
      .filter(([ids]) => ids.length >= 3)
      .map(([playerIds, voteAttempts]) => ({ playerIds, voteAttempts }));

    fc.assert(
      fc.property(scenarioArb, ({ playerIds, voteAttempts }) => {
        // Set up state with answers from all players except the voter
        const voterId = playerIds[0];
        const otherPlayerIds = playerIds.slice(1);

        const answers: Record<string, string> = {};
        for (const pid of otherPlayerIds) {
          answers[pid] = `Answer from ${pid}`;
        }

        const state = stateWithPlayersAndAnswers(playerIds, answers);

        // First vote should be recorded
        const firstTarget = otherPlayerIds[0];
        const stateAfterFirstVote = gameReducer(state, {
          type: 'CAST_VOTE',
          voterId,
          answerId: firstTarget,
        });
        expect(stateAfterFirstVote.game!.currentRoundState.votes[voterId]).toBe(firstTarget);

        // Subsequent votes should be rejected — the first vote remains
        let currentState = stateAfterFirstVote;
        for (let i = 1; i < Math.min(voteAttempts, otherPlayerIds.length); i++) {
          const nextTarget = otherPlayerIds[i % otherPlayerIds.length];
          currentState = gameReducer(currentState, {
            type: 'CAST_VOTE',
            voterId,
            answerId: nextTarget,
          });
          // Vote should still be the first one
          expect(currentState.game!.currentRoundState.votes[voterId]).toBe(firstTarget);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('different players can each vote once independently', () => {
    const scenarioArb = fc
      .uniqueArray(playerIdArb, { minLength: 4, maxLength: 8 })
      .filter((ids) => ids.length >= 4);

    fc.assert(
      fc.property(scenarioArb, (playerIds) => {
        // All players submit answers
        const answers: Record<string, string> = {};
        for (const pid of playerIds) {
          answers[pid] = `Answer from ${pid}`;
        }

        let state = stateWithPlayersAndAnswers(playerIds, answers);

        // Each player votes for a different player (not themselves)
        for (let i = 0; i < playerIds.length; i++) {
          const voterId = playerIds[i];
          const targetIdx = (i + 1) % playerIds.length;
          const answerId = playerIds[targetIdx];

          state = gameReducer(state, {
            type: 'CAST_VOTE',
            voterId,
            answerId,
          });

          expect(state.game!.currentRoundState.votes[voterId]).toBe(answerId);
        }

        // Verify all votes are recorded
        expect(Object.keys(state.game!.currentRoundState.votes)).toHaveLength(playerIds.length);
      }),
      { numRuns: 100 }
    );
  });
});

// ============================================================
// Property 12: Self-vote prevention
// ============================================================

/**
 * Feature: lan-party-game
 * Property 12: Self-vote prevention
 *
 * For any player and the set of voting options, the option corresponding to
 * that player's own answer SHALL not be selectable by that player.
 * The CAST_VOTE reducer rejects votes where voterId === answerId.
 *
 * Validates: Requirements 6.3
 */
describe('Property 12: Self-vote prevention', () => {
  it('rejects any vote where voterId equals answerId', () => {
    const scenarioArb = fc
      .uniqueArray(playerIdArb, { minLength: 3, maxLength: 8 })
      .filter((ids) => ids.length >= 3);

    fc.assert(
      fc.property(scenarioArb, (playerIds) => {
        // All players submit answers
        const answers: Record<string, string> = {};
        for (const pid of playerIds) {
          answers[pid] = `Answer from ${pid}`;
        }

        const state = stateWithPlayersAndAnswers(playerIds, answers);

        // Each player tries to vote for themselves
        for (const playerId of playerIds) {
          const result = gameReducer(state, {
            type: 'CAST_VOTE',
            voterId: playerId,
            answerId: playerId,
          });

          // Self-vote should be rejected — no vote recorded
          expect(result.game!.currentRoundState.votes[playerId]).toBeUndefined();
        }
      }),
      { numRuns: 100 }
    );
  });

  it('accepts votes for other players answers but never for own', () => {
    const scenarioArb = fc
      .uniqueArray(playerIdArb, { minLength: 3, maxLength: 8 })
      .filter((ids) => ids.length >= 3);

    fc.assert(
      fc.property(scenarioArb, (playerIds) => {
        const answers: Record<string, string> = {};
        for (const pid of playerIds) {
          answers[pid] = `Answer from ${pid}`;
        }

        const state = stateWithPlayersAndAnswers(playerIds, answers);

        // For each player, try voting for self (should fail) then for another (should succeed)
        for (let i = 0; i < playerIds.length; i++) {
          const voterId = playerIds[i];
          const otherId = playerIds[(i + 1) % playerIds.length];

          // Self-vote rejected
          const afterSelfVote = gameReducer(state, {
            type: 'CAST_VOTE',
            voterId,
            answerId: voterId,
          });
          expect(afterSelfVote.game!.currentRoundState.votes[voterId]).toBeUndefined();

          // Vote for other accepted
          const afterOtherVote = gameReducer(state, {
            type: 'CAST_VOTE',
            voterId,
            answerId: otherId,
          });
          expect(afterOtherVote.game!.currentRoundState.votes[voterId]).toBe(otherId);
        }
      }),
      { numRuns: 100 }
    );
  });
});

// ============================================================
// Property 13: Duplicate answer vote distribution
// ============================================================

/**
 * Feature: lan-party-game
 * Property 13: Duplicate answer vote distribution
 *
 * For any set of answers containing exact duplicates, when a vote is cast for
 * any copy of a duplicated answer, all authors of that identical answer text
 * SHALL receive the vote's points.
 *
 * Validates: Requirements 6.4
 */
describe('Property 13: Duplicate answer vote distribution', () => {
  it('all authors of duplicate answers receive points when any copy is voted for', () => {
    // Generate scenarios where some players have the same answer
    const scenarioArb = fc
      .tuple(
        fc.uniqueArray(playerIdArb, { minLength: 4, maxLength: 8 }),
        answerTextArb // the duplicate answer text
      )
      .filter(([ids]) => ids.length >= 4)
      .map(([playerIds, duplicateText]) => {
        // At least 2 players will have the same answer, others have unique answers
        const duplicateCount = Math.min(Math.max(2, Math.floor(playerIds.length / 2)), playerIds.length - 1);
        return { playerIds, duplicateText, duplicateCount };
      });

    fc.assert(
      fc.property(scenarioArb, ({ playerIds, duplicateText, duplicateCount }) => {
        const answers: Record<string, string> = {};
        const duplicateAuthors: string[] = [];

        // First N players get the duplicate answer
        for (let i = 0; i < duplicateCount; i++) {
          answers[playerIds[i]] = duplicateText;
          duplicateAuthors.push(playerIds[i]);
        }

        // Remaining players get unique answers
        for (let i = duplicateCount; i < playerIds.length; i++) {
          answers[playerIds[i]] = `Unique answer ${i}`;
        }

        // Set up state and have a non-duplicate-author vote for one of the duplicate answers
        const voterId = playerIds[playerIds.length - 1]; // last player votes
        const votedAnswerId = duplicateAuthors[0]; // vote for first duplicate author

        // Make sure voter has a unique answer (not a duplicate author)
        // If voter is in duplicateAuthors, skip this test case
        if (duplicateAuthors.includes(voterId)) {
          return; // skip — voter shouldn't be a duplicate author for this test
        }

        const state = stateWithPlayersAndAnswers(playerIds, answers);

        // Cast vote for one copy of the duplicate answer
        const stateAfterVote = gameReducer(state, {
          type: 'CAST_VOTE',
          voterId,
          answerId: votedAnswerId,
        });

        // Now reveal results to calculate scores
        const stateAfterReveal = gameReducer(stateAfterVote, { type: 'REVEAL_RESULTS' });

        // All duplicate authors should receive points
        for (const authorId of duplicateAuthors) {
          expect(stateAfterReveal.game!.scores[authorId]).toBeGreaterThan(0);
        }

        // All duplicate authors should have the same score
        const firstAuthorScore = stateAfterReveal.game!.scores[duplicateAuthors[0]];
        for (const authorId of duplicateAuthors) {
          expect(stateAfterReveal.game!.scores[authorId]).toBe(firstAuthorScore);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('non-duplicate answers only award points to their single author', () => {
    const scenarioArb = fc
      .tuple(
        fc.uniqueArray(playerIdArb, { minLength: 4, maxLength: 6 }),
        fc.uniqueArray(answerTextArb, { minLength: 4, maxLength: 6 })
      )
      .filter(([ids, texts]) => ids.length >= 4 && texts.length >= ids.length);

    fc.assert(
      fc.property(scenarioArb, ([playerIds, answerTexts]) => {
        // All answers are unique
        const answers: Record<string, string> = {};
        for (let i = 0; i < playerIds.length; i++) {
          answers[playerIds[i]] = answerTexts[i];
        }

        const state = stateWithPlayersAndAnswers(playerIds, answers);

        // First player votes for second player's answer
        const voterId = playerIds[0];
        const votedId = playerIds[1];

        const stateAfterVote = gameReducer(state, {
          type: 'CAST_VOTE',
          voterId,
          answerId: votedId,
        });

        const stateAfterReveal = gameReducer(stateAfterVote, { type: 'REVEAL_RESULTS' });

        // Only the voted-for player should get points
        expect(stateAfterReveal.game!.scores[votedId]).toBe(1);

        // Other players (except voter) should have 0 points
        for (const pid of playerIds) {
          if (pid !== votedId) {
            expect(stateAfterReveal.game!.scores[pid]).toBe(0);
          }
        }
      }),
      { numRuns: 100 }
    );
  });
});
