import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  calculateAnswerThreshold,
  calculateVotingThreshold,
} from './useDisconnectionHandler';
import { gameReducer, INITIAL_STATE } from '../context/GameContext';
import type { Player, GameState, GamePhase, AppState } from '../types';

// ============================================================
// Generators
// ============================================================

const activePhaseArb: fc.Arbitrary<GamePhase> = fc.constantFrom(
  'question_display',
  'answer_phase',
  'voting_phase',
  'score_reveal'
);

const playerIdArb = fc.uuid();

/** Generate a connected player */
function connectedPlayerArb(id?: string): fc.Arbitrary<Player> {
  return fc.record({
    id: id ? fc.constant(id) : playerIdArb,
    name: fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
    isHost: fc.boolean(),
    isConnected: fc.constant(true),
    joinOrder: fc.integer({ min: 1, max: 100 }),
  });
}

/** Generate a list of N connected players with unique IDs */
function connectedPlayersArb(minCount: number, maxCount: number): fc.Arbitrary<Player[]> {
  return fc
    .integer({ min: minCount, max: maxCount })
    .chain((count) =>
      fc.array(playerIdArb, { minLength: count, maxLength: count }).chain((ids) => {
        const uniqueIds = [...new Set(ids)];
        if (uniqueIds.length < minCount) {
          // Generate fresh unique IDs
          const freshIds: string[] = [];
          for (let i = 0; i < count; i++) {
            freshIds.push(`player-${i}-${Math.random().toString(36).slice(2, 10)}`);
          }
          return fc.constant(
            freshIds.map((id, idx) => ({
              id,
              name: `Player${idx}`,
              isHost: idx === 0,
              isConnected: true,
              joinOrder: idx + 1,
            }))
          );
        }
        return fc.constant(
          uniqueIds.slice(0, count).map((id, idx) => ({
            id,
            name: `Player${idx}`,
            isHost: idx === 0,
            isConnected: true,
            joinOrder: idx + 1,
          }))
        );
      })
    );
}

/** Generate N unique player IDs */
function uniquePlayerIdsArb(count: number): fc.Arbitrary<string[]> {
  return fc.constant(
    Array.from({ length: count }, (_, i) => `player-${i}-${crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2, 14)}`)
  );
}

// ============================================================
// Property 18: Disconnect threshold adjustment
// ============================================================

/**
 * Feature: lan-party-game
 * Property 18: Disconnect threshold adjustment
 *
 * For any active game phase with N connected players, when a player disconnects,
 * the phase completion threshold SHALL be recalculated based on N-1 connected
 * players within 5 seconds.
 *
 * Validates: Requirements 10.1
 */
describe('Property 18: Disconnect threshold adjustment', () => {
  it('answer threshold decreases by 1 when a non-featured player disconnects', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 4, max: 10 }), // total connected players
        activePhaseArb,
        (playerCount, _phase) => {
          // Create N connected players
          const players: Player[] = Array.from({ length: playerCount }, (_, i) => ({
            id: `player-${i}`,
            name: `Player${i}`,
            isHost: i === 0,
            isConnected: true,
            joinOrder: i + 1,
          }));

          const featuredPlayerId = players[0].id; // First player is featured

          // Calculate threshold before disconnect
          const thresholdBefore = calculateAnswerThreshold(players, featuredPlayerId);

          // Disconnect a non-featured player (not player-0)
          const disconnectIndex = 1; // Always disconnect player at index 1
          const playersAfterDisconnect = players.map((p, i) =>
            i === disconnectIndex ? { ...p, isConnected: false } : p
          );

          // Calculate threshold after disconnect
          const thresholdAfter = calculateAnswerThreshold(playersAfterDisconnect, featuredPlayerId);

          // Threshold should decrease by exactly 1
          expect(thresholdAfter).toBe(thresholdBefore - 1);
          // Threshold after should be N-1 connected minus featured = N-2
          expect(thresholdAfter).toBe(playerCount - 2);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('voting threshold decreases by 1 when any player disconnects', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 4, max: 10 }), // total connected players
        activePhaseArb,
        fc.integer({ min: 0, max: 9 }), // index of player to disconnect
        (playerCount, _phase, disconnectIdx) => {
          // Create N connected players
          const players: Player[] = Array.from({ length: playerCount }, (_, i) => ({
            id: `player-${i}`,
            name: `Player${i}`,
            isHost: i === 0,
            isConnected: true,
            joinOrder: i + 1,
          }));

          const featuredPlayerId = players[0].id;
          const actualDisconnectIdx = disconnectIdx % playerCount;

          // Calculate threshold before disconnect
          const thresholdBefore = calculateVotingThreshold(players, featuredPlayerId);

          // Disconnect a player
          const playersAfterDisconnect = players.map((p, i) =>
            i === actualDisconnectIdx ? { ...p, isConnected: false } : p
          );

          // Calculate threshold after disconnect
          const thresholdAfter = calculateVotingThreshold(playersAfterDisconnect, featuredPlayerId);

          // Voting threshold should decrease by exactly 1
          expect(thresholdAfter).toBe(thresholdBefore - 1);
          // Threshold after should be N-1
          expect(thresholdAfter).toBe(playerCount - 1);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('threshold reflects N-1 connected players after REMOVE_PLAYER dispatch', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 4, max: 8 }), // total players
        activePhaseArb,
        (playerCount, phase) => {
          // Create players and game state
          const players: Player[] = Array.from({ length: playerCount }, (_, i) => ({
            id: `player-${i}`,
            name: `Player${i}`,
            isHost: i === 0,
            isConnected: true,
            joinOrder: i + 1,
          }));

          const featuredPlayerId = players[0].id;

          const state: AppState = {
            ...INITIAL_STATE,
            players,
            game: {
              phase,
              currentRound: 1,
              totalRounds: playerCount,
              questions: Array.from({ length: playerCount }, (_, i) => i),
              featuredPlayerOrder: players.map((p) => p.id),
              scores: Object.fromEntries(players.map((p) => [p.id, 0])),
              currentRoundState: {
                questionIndex: 0,
                featuredPlayerId,
                questionText: 'Test question',
                answers: {},
                votes: {},
                timerEndTime: Date.now() + 60000,
              },
            },
          };

          // Disconnect a non-featured player via reducer
          const disconnectPlayerId = `player-${playerCount - 1}`;
          const newState = gameReducer(state, {
            type: 'REMOVE_PLAYER',
            playerId: disconnectPlayerId,
          });

          // After REMOVE_PLAYER, the player is marked as disconnected
          const disconnectedPlayer = newState.players.find((p) => p.id === disconnectPlayerId);
          expect(disconnectedPlayer?.isConnected).toBe(false);

          // Recalculate thresholds with updated player list
          const answerThreshold = calculateAnswerThreshold(newState.players, featuredPlayerId);
          const votingThreshold = calculateVotingThreshold(newState.players, featuredPlayerId);

          // Answer threshold: connected non-featured = (N-1) - 1 = N-2
          expect(answerThreshold).toBe(playerCount - 2);
          // Voting threshold: all connected = N-1
          expect(votingThreshold).toBe(playerCount - 1);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('threshold adjusts correctly when featured player disconnects', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 4, max: 10 }),
        activePhaseArb,
        (playerCount, _phase) => {
          const players: Player[] = Array.from({ length: playerCount }, (_, i) => ({
            id: `player-${i}`,
            name: `Player${i}`,
            isHost: i === 0,
            isConnected: true,
            joinOrder: i + 1,
          }));

          const featuredPlayerId = players[0].id;

          // Disconnect the featured player
          const playersAfterDisconnect = players.map((p) =>
            p.id === featuredPlayerId ? { ...p, isConnected: false } : p
          );

          // Answer threshold: connected non-featured players = N-1 (all others still connected)
          const answerThreshold = calculateAnswerThreshold(playersAfterDisconnect, featuredPlayerId);
          expect(answerThreshold).toBe(playerCount - 1);

          // Voting threshold: all connected = N-1
          const votingThreshold = calculateVotingThreshold(playersAfterDisconnect, featuredPlayerId);
          expect(votingThreshold).toBe(playerCount - 1);
        }
      ),
      { numRuns: 200 }
    );
  });
});

// ============================================================
// Property 19: Disconnected player answer persistence
// ============================================================

/**
 * Feature: lan-party-game
 * Property 19: Disconnected player answer persistence
 *
 * For any player who submitted an answer and then disconnected, their answer
 * SHALL remain in the voting options and any votes received SHALL be added
 * to their cumulative score.
 *
 * Validates: Requirements 10.4
 */
describe('Property 19: Disconnected player answer persistence', () => {
  it('answer persists after player disconnects via REMOVE_PLAYER', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 4, max: 8 }), // player count
        fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0), // answer text
        fc.integer({ min: 1, max: 7 }), // index of player who submits then disconnects
        (playerCount, answerText, submitterIdx) => {
          const actualSubmitterIdx = (submitterIdx % (playerCount - 1)) + 1; // Avoid featured player (idx 0)

          const players: Player[] = Array.from({ length: playerCount }, (_, i) => ({
            id: `player-${i}`,
            name: `Player${i}`,
            isHost: i === 0,
            isConnected: true,
            joinOrder: i + 1,
          }));

          const featuredPlayerId = players[0].id;
          const submitterId = players[actualSubmitterIdx].id;

          // Set up state in answer phase
          let state: AppState = {
            ...INITIAL_STATE,
            players,
            game: {
              phase: 'answer_phase',
              currentRound: 1,
              totalRounds: playerCount,
              questions: Array.from({ length: playerCount }, (_, i) => i),
              featuredPlayerOrder: players.map((p) => p.id),
              scores: Object.fromEntries(players.map((p) => [p.id, 0])),
              currentRoundState: {
                questionIndex: 0,
                featuredPlayerId,
                questionText: 'Test question',
                answers: {},
                votes: {},
                timerEndTime: Date.now() + 60000,
              },
            },
          };

          // Player submits answer
          state = gameReducer(state, {
            type: 'SUBMIT_ANSWER',
            playerId: submitterId,
            answer: answerText,
          });

          // Verify answer was recorded
          expect(state.game!.currentRoundState.answers[submitterId]).toBe(answerText);

          // Player disconnects
          state = gameReducer(state, {
            type: 'REMOVE_PLAYER',
            playerId: submitterId,
          });

          // Answer should still be present after disconnect
          expect(state.game!.currentRoundState.answers[submitterId]).toBe(answerText);

          // Player is marked as disconnected
          const disconnectedPlayer = state.players.find((p) => p.id === submitterId);
          expect(disconnectedPlayer?.isConnected).toBe(false);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('disconnected player receives score from votes on their answer', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 4, max: 7 }), // player count
        fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0), // answer
        fc.integer({ min: 1, max: 6 }), // number of voters for the disconnected player's answer
        (playerCount, answerText, voterCount) => {
          const actualVoterCount = Math.min(voterCount, playerCount - 2); // Can't exceed eligible voters
          fc.pre(actualVoterCount >= 1);

          const players: Player[] = Array.from({ length: playerCount }, (_, i) => ({
            id: `player-${i}`,
            name: `Player${i}`,
            isHost: i === 0,
            isConnected: true,
            joinOrder: i + 1,
          }));

          const featuredPlayerId = players[0].id;
          const submitterId = players[1].id; // player-1 submits and disconnects

          // Set up state with answers from multiple players
          let state: AppState = {
            ...INITIAL_STATE,
            players,
            game: {
              phase: 'answer_phase',
              currentRound: 1,
              totalRounds: playerCount,
              questions: Array.from({ length: playerCount }, (_, i) => i),
              featuredPlayerOrder: players.map((p) => p.id),
              scores: Object.fromEntries(players.map((p) => [p.id, 0])),
              currentRoundState: {
                questionIndex: 0,
                featuredPlayerId,
                questionText: 'Test question',
                answers: {},
                votes: {},
                timerEndTime: Date.now() + 60000,
              },
            },
          };

          // Submitter submits their answer
          state = gameReducer(state, {
            type: 'SUBMIT_ANSWER',
            playerId: submitterId,
            answer: answerText,
          });

          // Other non-featured players submit different answers
          for (let i = 2; i < playerCount; i++) {
            state = gameReducer(state, {
              type: 'SUBMIT_ANSWER',
              playerId: players[i].id,
              answer: `Different answer ${i}`,
            });
          }

          // Submitter disconnects
          state = gameReducer(state, {
            type: 'REMOVE_PLAYER',
            playerId: submitterId,
          });

          // Verify answer still exists
          expect(state.game!.currentRoundState.answers[submitterId]).toBe(answerText);

          // Other players vote for the disconnected player's answer
          // Voters are non-submitter players (can't self-vote)
          const eligibleVoters = players.filter(
            (p) => p.id !== submitterId && p.id !== featuredPlayerId
          );

          for (let i = 0; i < actualVoterCount && i < eligibleVoters.length; i++) {
            state = gameReducer(state, {
              type: 'CAST_VOTE',
              voterId: eligibleVoters[i].id,
              answerId: submitterId, // Vote for disconnected player's answer
            });
          }

          // Reveal results — scores should be calculated
          state = gameReducer(state, { type: 'REVEAL_RESULTS' });

          // Disconnected player should receive points equal to votes received
          const disconnectedPlayerScore = state.game!.scores[submitterId];
          expect(disconnectedPlayerScore).toBe(actualVoterCount);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('disconnected player answer remains votable alongside connected player answers', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 4, max: 8 }),
        fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
        (playerCount, answerText) => {
          const players: Player[] = Array.from({ length: playerCount }, (_, i) => ({
            id: `player-${i}`,
            name: `Player${i}`,
            isHost: i === 0,
            isConnected: true,
            joinOrder: i + 1,
          }));

          const featuredPlayerId = players[0].id;
          const disconnectingPlayerId = players[1].id;

          let state: AppState = {
            ...INITIAL_STATE,
            players,
            game: {
              phase: 'answer_phase',
              currentRound: 1,
              totalRounds: playerCount,
              questions: Array.from({ length: playerCount }, (_, i) => i),
              featuredPlayerOrder: players.map((p) => p.id),
              scores: Object.fromEntries(players.map((p) => [p.id, 0])),
              currentRoundState: {
                questionIndex: 0,
                featuredPlayerId,
                questionText: 'Test question',
                answers: {},
                votes: {},
                timerEndTime: Date.now() + 60000,
              },
            },
          };

          // All non-featured players submit answers
          for (let i = 1; i < playerCount; i++) {
            state = gameReducer(state, {
              type: 'SUBMIT_ANSWER',
              playerId: players[i].id,
              answer: i === 1 ? answerText : `Answer from player ${i}`,
            });
          }

          // Player 1 disconnects after submitting
          state = gameReducer(state, {
            type: 'REMOVE_PLAYER',
            playerId: disconnectingPlayerId,
          });

          // All answers should still be present (including disconnected player's)
          const answers = state.game!.currentRoundState.answers;
          expect(Object.keys(answers).length).toBe(playerCount - 1); // All non-featured submitted
          expect(answers[disconnectingPlayerId]).toBe(answerText);

          // A connected player can vote for the disconnected player's answer
          const voterId = players[2].id; // A connected player
          state = gameReducer(state, {
            type: 'CAST_VOTE',
            voterId,
            answerId: disconnectingPlayerId,
          });

          // Vote should be recorded
          expect(state.game!.currentRoundState.votes[voterId]).toBe(disconnectingPlayerId);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('cumulative score persists across rounds for disconnected player who reconnects', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 4, max: 6 }),
        fc.integer({ min: 1, max: 5 }), // votes in round 1
        (playerCount, votesInRound1) => {
          const actualVotes = Math.min(votesInRound1, playerCount - 2);
          fc.pre(actualVotes >= 1);

          const players: Player[] = Array.from({ length: playerCount }, (_, i) => ({
            id: `player-${i}`,
            name: `Player${i}`,
            isHost: i === 0,
            isConnected: true,
            joinOrder: i + 1,
          }));

          const featuredPlayerId = players[0].id;
          const submitterId = players[1].id;

          let state: AppState = {
            ...INITIAL_STATE,
            players,
            game: {
              phase: 'answer_phase',
              currentRound: 1,
              totalRounds: playerCount,
              questions: Array.from({ length: playerCount }, (_, i) => i),
              featuredPlayerOrder: players.map((p) => p.id),
              scores: Object.fromEntries(players.map((p) => [p.id, 0])),
              currentRoundState: {
                questionIndex: 0,
                featuredPlayerId,
                questionText: 'Test question',
                answers: {},
                votes: {},
                timerEndTime: Date.now() + 60000,
              },
            },
          };

          // Player submits answer
          state = gameReducer(state, {
            type: 'SUBMIT_ANSWER',
            playerId: submitterId,
            answer: 'My funny answer',
          });

          // Other players submit
          for (let i = 2; i < playerCount; i++) {
            state = gameReducer(state, {
              type: 'SUBMIT_ANSWER',
              playerId: players[i].id,
              answer: `Answer ${i}`,
            });
          }

          // Player disconnects
          state = gameReducer(state, {
            type: 'REMOVE_PLAYER',
            playerId: submitterId,
          });

          // Other players vote for disconnected player's answer
          const eligibleVoters = players.filter(
            (p) => p.id !== submitterId && p.id !== featuredPlayerId
          );
          for (let i = 0; i < actualVotes && i < eligibleVoters.length; i++) {
            state = gameReducer(state, {
              type: 'CAST_VOTE',
              voterId: eligibleVoters[i].id,
              answerId: submitterId,
            });
          }

          // Reveal results
          state = gameReducer(state, { type: 'REVEAL_RESULTS' });

          // Disconnected player's cumulative score should equal votes received
          expect(state.game!.scores[submitterId]).toBe(actualVotes);

          // Score is preserved in the game state (persists for future rounds)
          expect(state.game!.scores[submitterId]).toBeGreaterThan(0);
        }
      ),
      { numRuns: 200 }
    );
  });
});
