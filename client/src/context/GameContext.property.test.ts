import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { gameReducer, computeLeaderboard, INITIAL_STATE, DEFAULT_SETTINGS } from './GameContext';
import type { AppState } from './GameContext';
import type { Player, GameSettings, GameState, RoundState } from '../types';

// ============================================================
// Generators
// ============================================================

const playerIdArb = fc.uuid();

const playerArb = (overrides?: Partial<Player>): fc.Arbitrary<Player> =>
  fc.record({
    id: overrides?.id !== undefined ? fc.constant(overrides.id) : playerIdArb,
    name: fc.stringOf(
      fc.mapToConstant(
        { num: 26, build: (v) => String.fromCharCode(65 + v) },
        { num: 26, build: (v) => String.fromCharCode(97 + v) },
        { num: 10, build: (v) => String.fromCharCode(48 + v) }
      ),
      { minLength: 1, maxLength: 15 }
    ),
    isHost: fc.constant(overrides?.isHost ?? false),
    isConnected: fc.constant(overrides?.isConnected ?? true),
    joinOrder: overrides?.joinOrder !== undefined
      ? fc.constant(overrides.joinOrder)
      : fc.integer({ min: 1, max: 100 }),
  });

/** Generate a list of N unique players */
const uniquePlayersArb = (minCount: number, maxCount: number): fc.Arbitrary<Player[]> =>
  fc
    .integer({ min: minCount, max: maxCount })
    .chain((count) =>
      fc.array(playerArb(), { minLength: count, maxLength: count })
    )
    .map((players) => {
      // Ensure unique IDs and unique names
      const seen = new Set<string>();
      const uniquePlayers: Player[] = [];
      let joinOrder = 1;
      for (const p of players) {
        if (!seen.has(p.id)) {
          seen.add(p.id);
          uniquePlayers.push({ ...p, joinOrder: joinOrder++, isConnected: true });
        }
      }
      return uniquePlayers;
    })
    .filter((players) => players.length >= minCount);

const validSettingsArb = (minP: number, maxP: number): fc.Arbitrary<GameSettings> =>
  fc.record({
    minPlayers: fc.constant(minP),
    maxPlayers: fc.constant(maxP),
    answerTimerSeconds: fc.integer({ min: 10, max: 300 }),
    votingTimerSeconds: fc.integer({ min: 10, max: 300 }),
  });

// ============================================================
// Property 4: Player limit enforcement
// ============================================================

/**
 * Feature: lan-party-game
 * Property 4: Player limit enforcement
 *
 * For any valid game settings with configured minimum and maximum player counts,
 * the game SHALL not start when player count is below the minimum, and SHALL reject
 * new joins when player count equals the maximum.
 *
 * Validates: Requirements 3.1, 3.2
 */
describe('Property 4: Player limit enforcement', () => {
  it('game does not start when player count is below minimum', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 3, max: 10 }),
        fc.integer({ min: 3, max: 10 }),
        fc.integer({ min: 10, max: 300 }),
        fc.integer({ min: 10, max: 300 }),
        (minPlayers, maxPlayers, answerTimer, votingTimer) => {
          fc.pre(minPlayers <= maxPlayers);

          const settings: GameSettings = {
            minPlayers,
            maxPlayers,
            answerTimerSeconds: answerTimer,
            votingTimerSeconds: votingTimer,
          };

          // Create fewer players than minimum
          const playerCount = minPlayers - 1;
          if (playerCount < 1) return; // skip edge case

          const players: Player[] = Array.from({ length: playerCount }, (_, i) => ({
            id: `player-${i}`,
            name: `Player${i}`,
            isHost: i === 0,
            isConnected: true,
            joinOrder: i + 1,
          }));

          const state: AppState = {
            ...INITIAL_STATE,
            players,
            settings,
          };

          const result = gameReducer(state, {
            type: 'START_GAME',
            settings,
            questions: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
            featuredOrder: players.map((p) => p.id),
          });

          // Game should NOT start — game remains null
          expect(result.game).toBeNull();
        }
      )
    );
  });

  it('rejects new player joins when at max capacity', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 3, max: 10 }),
        fc.integer({ min: 3, max: 10 }),
        fc.integer({ min: 10, max: 300 }),
        fc.integer({ min: 10, max: 300 }),
        (minPlayers, maxPlayers, answerTimer, votingTimer) => {
          fc.pre(minPlayers <= maxPlayers);

          const settings: GameSettings = {
            minPlayers,
            maxPlayers,
            answerTimerSeconds: answerTimer,
            votingTimerSeconds: votingTimer,
          };

          // Fill room to max capacity
          const players: Player[] = Array.from({ length: maxPlayers }, (_, i) => ({
            id: `player-${i}`,
            name: `Player${i}`,
            isHost: i === 0,
            isConnected: true,
            joinOrder: i + 1,
          }));

          const state: AppState = {
            ...INITIAL_STATE,
            players,
            settings,
          };

          // Try to add one more player
          const newPlayer: Player = {
            id: 'new-player',
            name: 'NewPlayer',
            isHost: false,
            isConnected: true,
            joinOrder: maxPlayers + 1,
          };

          const result = gameReducer(state, {
            type: 'ADD_PLAYER',
            player: newPlayer,
          });

          // Player count should remain at max
          expect(result.players.length).toBe(maxPlayers);
          expect(result.players.find((p) => p.id === 'new-player')).toBeUndefined();
        }
      )
    );
  });
});

// ============================================================
// Property 5: Total rounds equals player count
// ============================================================

/**
 * Feature: lan-party-game
 * Property 5: Total rounds equals player count
 *
 * For any game start with N connected players, the total number of rounds SHALL equal N.
 *
 * Validates: Requirements 4.1
 */
describe('Property 5: Total rounds equals player count', () => {
  it('totalRounds equals the number of connected players at game start', () => {
    fc.assert(
      fc.property(
        uniquePlayersArb(3, 10),
        fc.integer({ min: 10, max: 300 }),
        fc.integer({ min: 10, max: 300 }),
        (players, answerTimer, votingTimer) => {
          const settings: GameSettings = {
            minPlayers: 3,
            maxPlayers: 10,
            answerTimerSeconds: answerTimer,
            votingTimerSeconds: votingTimer,
          };

          const state: AppState = {
            ...INITIAL_STATE,
            players,
            settings,
          };

          const connectedCount = players.filter((p) => p.isConnected).length;
          const questions = Array.from({ length: connectedCount }, (_, i) => i);
          const featuredOrder = players.filter((p) => p.isConnected).map((p) => p.id);

          const result = gameReducer(state, {
            type: 'START_GAME',
            settings,
            questions,
            featuredOrder,
          });

          expect(result.game).not.toBeNull();
          expect(result.game!.totalRounds).toBe(connectedCount);
        }
      )
    );
  });
});

// ============================================================
// Property 6: Featured player uniqueness
// ============================================================

/**
 * Feature: lan-party-game
 * Property 6: Featured player uniqueness
 *
 * For any complete game with N players, each player SHALL be selected as the
 * Featured_Player exactly once across all N rounds.
 *
 * Validates: Requirements 4.2
 */
describe('Property 6: Featured player uniqueness', () => {
  it('each player is featured exactly once in a complete game', () => {
    fc.assert(
      fc.property(
        uniquePlayersArb(3, 8),
        fc.integer({ min: 10, max: 300 }),
        fc.integer({ min: 10, max: 300 }),
        (players, answerTimer, votingTimer) => {
          const settings: GameSettings = {
            minPlayers: 3,
            maxPlayers: 10,
            answerTimerSeconds: answerTimer,
            votingTimerSeconds: votingTimer,
          };

          const state: AppState = {
            ...INITIAL_STATE,
            players,
            settings,
          };

          const connectedPlayers = players.filter((p) => p.isConnected);
          const questions = Array.from({ length: connectedPlayers.length }, (_, i) => i);
          // Shuffle featured order
          const featuredOrder = connectedPlayers.map((p) => p.id);

          const afterStart = gameReducer(state, {
            type: 'START_GAME',
            settings,
            questions,
            featuredOrder,
          });

          expect(afterStart.game).not.toBeNull();

          // Verify the featured order contains each connected player exactly once
          const order = afterStart.game!.featuredPlayerOrder;
          const connectedIds = new Set(connectedPlayers.map((p) => p.id));

          // Each connected player appears exactly once
          expect(order.length).toBe(connectedPlayers.length);
          const orderSet = new Set(order);
          expect(orderSet.size).toBe(order.length); // no duplicates
          for (const id of order) {
            expect(connectedIds.has(id)).toBe(true);
          }
        }
      )
    );
  });
});

// ============================================================
// Property 9: Answer submission idempotence
// ============================================================

/**
 * Feature: lan-party-game
 * Property 9: Answer submission idempotence
 *
 * For any player who has already submitted an answer in the current round,
 * subsequent submission attempts SHALL be rejected and the original answer
 * SHALL remain unchanged.
 *
 * Validates: Requirements 5.3
 */
describe('Property 9: Answer submission idempotence', () => {
  it('rejects subsequent answer submissions from the same player', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.string({ minLength: 1, maxLength: 100 }),
        (playerId, firstAnswer, secondAnswer) => {
          // Set up a game in answer phase with the player having already submitted
          const roundState: RoundState = {
            questionIndex: 0,
            featuredPlayerId: 'featured-player',
            questionText: 'Test question',
            answers: { [playerId]: firstAnswer },
            votes: {},
            timerEndTime: Date.now() + 60000,
          };

          const gameState: GameState = {
            phase: 'answer_phase',
            currentRound: 1,
            totalRounds: 4,
            questions: [0, 1, 2, 3],
            featuredPlayerOrder: ['featured-player', playerId, 'p3', 'p4'],
            scores: { [playerId]: 0, 'featured-player': 0, p3: 0, p4: 0 },
            currentRoundState: roundState,
          };

          const state: AppState = {
            ...INITIAL_STATE,
            players: [
              { id: playerId, name: 'P1', isHost: false, isConnected: true, joinOrder: 1 },
              { id: 'featured-player', name: 'P2', isHost: true, isConnected: true, joinOrder: 2 },
              { id: 'p3', name: 'P3', isHost: false, isConnected: true, joinOrder: 3 },
              { id: 'p4', name: 'P4', isHost: false, isConnected: true, joinOrder: 4 },
            ],
            game: gameState,
          };

          // Attempt to submit a second answer
          const result = gameReducer(state, {
            type: 'SUBMIT_ANSWER',
            playerId,
            answer: secondAnswer,
          });

          // Original answer should remain unchanged
          expect(result.game!.currentRoundState.answers[playerId]).toBe(firstAnswer);
        }
      )
    );
  });
});

// ============================================================
// Property 14: Score calculation correctness
// ============================================================

/**
 * Feature: lan-party-game
 * Property 14: Score calculation correctness
 *
 * For any set of votes in a round, each player's points for that round SHALL equal
 * the number of votes their answer received.
 *
 * Validates: Requirements 7.1, 7.2
 */
describe('Property 14: Score calculation correctness', () => {
  it('points equal vote count per player for unique answers', () => {
    fc.assert(
      fc.property(
        uniquePlayersArb(3, 8),
        (players) => {
          const connectedPlayers = players.filter((p) => p.isConnected);
          fc.pre(connectedPlayers.length >= 3);

          // Each player submits a unique answer
          const answers: Record<string, string> = {};
          connectedPlayers.forEach((p, i) => {
            answers[p.id] = `unique-answer-${i}`;
          });

          // Generate random votes (each voter votes for someone else)
          const votes: Record<string, string> = {};
          for (const voter of connectedPlayers) {
            const candidates = connectedPlayers.filter((p) => p.id !== voter.id);
            if (candidates.length > 0) {
              const target = candidates[Math.floor(Math.random() * candidates.length)];
              votes[voter.id] = target.id;
            }
          }

          const roundState: RoundState = {
            questionIndex: 0,
            featuredPlayerId: connectedPlayers[0].id,
            questionText: 'Test question',
            answers,
            votes,
            timerEndTime: 0,
          };

          const scores: Record<string, number> = {};
          connectedPlayers.forEach((p) => { scores[p.id] = 0; });

          const gameState: GameState = {
            phase: 'voting_phase',
            currentRound: 1,
            totalRounds: connectedPlayers.length,
            questions: Array.from({ length: connectedPlayers.length }, (_, i) => i),
            featuredPlayerOrder: connectedPlayers.map((p) => p.id),
            scores,
            currentRoundState: roundState,
          };

          const state: AppState = {
            ...INITIAL_STATE,
            players: connectedPlayers,
            game: gameState,
          };

          const result = gameReducer(state, { type: 'REVEAL_RESULTS' });

          // Calculate expected points: count votes per answer author
          const expectedPoints: Record<string, number> = {};
          connectedPlayers.forEach((p) => { expectedPoints[p.id] = 0; });
          for (const answerId of Object.values(votes)) {
            if (answerId in answers) {
              expectedPoints[answerId] = (expectedPoints[answerId] ?? 0) + 1;
            }
          }

          // Verify each player's score matches expected
          for (const player of connectedPlayers) {
            expect(result.game!.scores[player.id]).toBe(expectedPoints[player.id]);
          }
        }
      )
    );
  });
});

// ============================================================
// Property 15: Cumulative score invariant
// ============================================================

/**
 * Feature: lan-party-game
 * Property 15: Cumulative score invariant
 *
 * For any sequence of completed rounds, each player's cumulative score SHALL equal
 * the sum of points earned across all completed rounds, starting from zero.
 *
 * Validates: Requirements 7.3
 */
describe('Property 15: Cumulative score invariant', () => {
  it('cumulative score equals sum of round points across multiple rounds', () => {
    fc.assert(
      fc.property(
        uniquePlayersArb(3, 6),
        fc.integer({ min: 2, max: 4 }),
        (players, numRounds) => {
          const connectedPlayers = players.filter((p) => p.isConnected);
          fc.pre(connectedPlayers.length >= 3);
          fc.pre(numRounds <= connectedPlayers.length);

          const settings: GameSettings = {
            minPlayers: 3,
            maxPlayers: 10,
            answerTimerSeconds: 60,
            votingTimerSeconds: 30,
          };

          let state: AppState = {
            ...INITIAL_STATE,
            players: connectedPlayers,
            settings,
          };

          const questions = Array.from({ length: connectedPlayers.length }, (_, i) => i);
          const featuredOrder = connectedPlayers.map((p) => p.id);

          // Start game
          state = gameReducer(state, {
            type: 'START_GAME',
            settings,
            questions,
            featuredOrder,
          });

          // Track expected cumulative scores
          const expectedScores: Record<string, number> = {};
          connectedPlayers.forEach((p) => { expectedScores[p.id] = 0; });

          // Play through multiple rounds
          for (let round = 1; round <= numRounds; round++) {
            // Begin round
            state = gameReducer(state, {
              type: 'BEGIN_ROUND',
              roundNumber: round,
              questionIndex: round - 1,
              featuredPlayerId: featuredOrder[round - 1],
            });

            // Each player submits an answer
            for (const player of connectedPlayers) {
              state = gameReducer(state, {
                type: 'SUBMIT_ANSWER',
                playerId: player.id,
                answer: `answer-r${round}-${player.id}`,
              });
            }

            // Each player votes for the next player (round-robin)
            for (let i = 0; i < connectedPlayers.length; i++) {
              const voter = connectedPlayers[i];
              const target = connectedPlayers[(i + 1) % connectedPlayers.length];
              state = gameReducer(state, {
                type: 'CAST_VOTE',
                voterId: voter.id,
                answerId: target.id,
              });
            }

            // Calculate expected round points before reveal
            const roundVotes = state.game!.currentRoundState.votes;
            const roundAnswers = state.game!.currentRoundState.answers;
            for (const answerId of Object.values(roundVotes)) {
              const votedText = roundAnswers[answerId];
              if (votedText !== undefined) {
                // Find all matching authors (for unique answers, just the one)
                const matchingAuthors = Object.entries(roundAnswers)
                  .filter(([, text]) => text === votedText)
                  .map(([pid]) => pid);
                for (const authorId of matchingAuthors) {
                  expectedScores[authorId] = (expectedScores[authorId] ?? 0) + 1;
                }
              }
            }

            // Reveal results
            state = gameReducer(state, { type: 'REVEAL_RESULTS' });
          }

          // Verify cumulative scores match expected
          for (const player of connectedPlayers) {
            expect(state.game!.scores[player.id]).toBe(expectedScores[player.id]);
          }
        }
      )
    );
  });
});

// ============================================================
// Property 16: Leaderboard sorting correctness
// ============================================================

/**
 * Feature: lan-party-game
 * Property 16: Leaderboard sorting correctness
 *
 * For any set of players with cumulative scores and join orders, the leaderboard
 * SHALL be sorted in descending order by score, with ties broken by ascending join order.
 *
 * Validates: Requirements 7.4
 */
describe('Property 16: Leaderboard sorting correctness', () => {
  it('leaderboard is sorted descending by score with join-order tiebreak', () => {
    fc.assert(
      fc.property(
        uniquePlayersArb(3, 10),
        (players) => {
          fc.pre(players.length >= 3);

          // Assign random scores
          const scores: Record<string, number> = {};
          for (const player of players) {
            scores[player.id] = Math.floor(Math.random() * 20);
          }

          const leaderboard = computeLeaderboard(scores, players);

          // Verify sorting: descending by score, ties broken by ascending joinOrder
          for (let i = 1; i < leaderboard.length; i++) {
            const prev = leaderboard[i - 1];
            const curr = leaderboard[i];

            if (prev.score !== curr.score) {
              // Higher score should come first
              expect(prev.score).toBeGreaterThan(curr.score);
            } else {
              // Same score: lower joinOrder comes first
              const prevPlayer = players.find((p) => p.id === prev.playerId);
              const currPlayer = players.find((p) => p.id === curr.playerId);
              expect(prevPlayer!.joinOrder).toBeLessThanOrEqual(currPlayer!.joinOrder);
            }
          }
        }
      )
    );
  });

  it('leaderboard contains all players with correct scores', () => {
    fc.assert(
      fc.property(
        uniquePlayersArb(3, 10),
        fc.array(fc.integer({ min: 0, max: 50 }), { minLength: 3, maxLength: 10 }),
        (players, scoreValues) => {
          fc.pre(players.length >= 3);

          const scores: Record<string, number> = {};
          players.forEach((p, i) => {
            scores[p.id] = scoreValues[i % scoreValues.length];
          });

          const leaderboard = computeLeaderboard(scores, players);

          // All players present
          expect(leaderboard.length).toBe(players.length);

          // Each player's score is correct
          for (const entry of leaderboard) {
            expect(entry.score).toBe(scores[entry.playerId]);
          }
        }
      )
    );
  });
});

// ============================================================
// Property 17: Round count adjustment on disconnect
// ============================================================

/**
 * Feature: lan-party-game
 * Property 17: Round count adjustment on featured player disconnect
 *
 * For any game state where a player who has not yet been featured disconnects,
 * the total round count SHALL decrease by exactly one and the disconnected player
 * SHALL be removed from the featured player queue.
 *
 * Validates: Requirements 8.4
 */
describe('Property 17: Round count adjustment on disconnect', () => {
  it('total rounds decreases by 1 when an unfeatured player disconnects', () => {
    fc.assert(
      fc.property(
        uniquePlayersArb(4, 8),
        (players) => {
          const connectedPlayers = players.filter((p) => p.isConnected);
          fc.pre(connectedPlayers.length >= 4);

          const settings: GameSettings = {
            minPlayers: 3,
            maxPlayers: 10,
            answerTimerSeconds: 60,
            votingTimerSeconds: 30,
          };

          let state: AppState = {
            ...INITIAL_STATE,
            players: connectedPlayers,
            settings,
          };

          const questions = Array.from({ length: connectedPlayers.length }, (_, i) => i);
          const featuredOrder = connectedPlayers.map((p) => p.id);

          // Start game
          state = gameReducer(state, {
            type: 'START_GAME',
            settings,
            questions,
            featuredOrder,
          });

          // Begin round 1 (first player is featured)
          state = gameReducer(state, {
            type: 'BEGIN_ROUND',
            roundNumber: 1,
            questionIndex: 0,
            featuredPlayerId: featuredOrder[0],
          });

          const totalRoundsBefore = state.game!.totalRounds;

          // Pick a player who has NOT yet been featured (not the first player)
          // Players at index > 0 in featuredOrder haven't been featured yet
          const unfeaturedPlayerId = featuredOrder[featuredOrder.length - 1];

          // Disconnect the unfeatured player
          const result = gameReducer(state, {
            type: 'REMOVE_PLAYER',
            playerId: unfeaturedPlayerId,
          });

          // Total rounds should decrease by 1
          expect(result.game!.totalRounds).toBe(totalRoundsBefore - 1);

          // Player should be removed from featured order
          expect(result.game!.featuredPlayerOrder).not.toContain(unfeaturedPlayerId);
        }
      )
    );
  });

  it('total rounds unchanged when already-featured player disconnects', () => {
    fc.assert(
      fc.property(
        uniquePlayersArb(4, 8),
        (players) => {
          const connectedPlayers = players.filter((p) => p.isConnected);
          fc.pre(connectedPlayers.length >= 4);

          const settings: GameSettings = {
            minPlayers: 3,
            maxPlayers: 10,
            answerTimerSeconds: 60,
            votingTimerSeconds: 30,
          };

          let state: AppState = {
            ...INITIAL_STATE,
            players: connectedPlayers,
            settings,
          };

          const questions = Array.from({ length: connectedPlayers.length }, (_, i) => i);
          const featuredOrder = connectedPlayers.map((p) => p.id);

          // Start game
          state = gameReducer(state, {
            type: 'START_GAME',
            settings,
            questions,
            featuredOrder,
          });

          // Begin round 1 (first player is featured)
          state = gameReducer(state, {
            type: 'BEGIN_ROUND',
            roundNumber: 1,
            questionIndex: 0,
            featuredPlayerId: featuredOrder[0],
          });

          const totalRoundsBefore = state.game!.totalRounds;

          // Disconnect the currently featured player (already featured)
          const featuredPlayerId = featuredOrder[0];

          const result = gameReducer(state, {
            type: 'REMOVE_PLAYER',
            playerId: featuredPlayerId,
          });

          // Total rounds should remain unchanged (player was already featured)
          expect(result.game!.totalRounds).toBe(totalRoundsBefore);
        }
      )
    );
  });
});
