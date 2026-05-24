import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import {
  gameReducer,
  INITIAL_STATE,
  DEFAULT_SETTINGS,
  GameProvider,
  useGame,
  computeLeaderboard,
} from './GameContext';
import type { AppState } from './GameContext';
import type { Player, GameState, GameSettings } from '../types';

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
    phase: 'question_display',
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

function stateWithPlayers(count: number): AppState {
  const players: Player[] = [];
  for (let i = 1; i <= count; i++) {
    players.push(makePlayer({ id: `p${i}`, name: `Player${i}`, joinOrder: i }));
  }
  return { ...INITIAL_STATE, players };
}

// ============================================================
// ADD_PLAYER
// ============================================================

describe('ADD_PLAYER', () => {
  it('adds a player to the room', () => {
    const player = makePlayer({ id: 'p1', name: 'Alice' });
    const result = gameReducer(INITIAL_STATE, { type: 'ADD_PLAYER', player });
    expect(result.players).toHaveLength(1);
    expect(result.players[0]).toEqual(player);
  });

  it('enforces max capacity', () => {
    const state: AppState = {
      ...INITIAL_STATE,
      settings: { ...DEFAULT_SETTINGS, maxPlayers: 3 },
      players: [
        makePlayer({ id: 'p1', joinOrder: 1 }),
        makePlayer({ id: 'p2', joinOrder: 2 }),
        makePlayer({ id: 'p3', joinOrder: 3 }),
      ],
    };
    const newPlayer = makePlayer({ id: 'p4', joinOrder: 4 });
    const result = gameReducer(state, { type: 'ADD_PLAYER', player: newPlayer });
    expect(result.players).toHaveLength(3);
  });

  it('rejects duplicate player IDs', () => {
    const player = makePlayer({ id: 'p1' });
    const state: AppState = { ...INITIAL_STATE, players: [player] };
    const result = gameReducer(state, { type: 'ADD_PLAYER', player });
    expect(result.players).toHaveLength(1);
  });
});

// ============================================================
// REMOVE_PLAYER
// ============================================================

describe('REMOVE_PLAYER', () => {
  it('marks player as disconnected', () => {
    const state: AppState = {
      ...INITIAL_STATE,
      players: [makePlayer({ id: 'p1', isConnected: true })],
    };
    const result = gameReducer(state, { type: 'REMOVE_PLAYER', playerId: 'p1' });
    expect(result.players[0].isConnected).toBe(false);
  });

  it('adjusts featured order and round count when unfeatured player disconnects', () => {
    const state: AppState = {
      ...stateWithPlayers(3),
      game: makeGameState({
        currentRound: 1,
        totalRounds: 3,
        featuredPlayerOrder: ['p1', 'p2', 'p3'],
      }),
    };
    // p3 hasn't been featured yet (current round is 1, so index 0 is current)
    const result = gameReducer(state, { type: 'REMOVE_PLAYER', playerId: 'p3' });
    expect(result.game!.totalRounds).toBe(2);
    expect(result.game!.featuredPlayerOrder).not.toContain('p3');
  });

  it('does not adjust round count when already-featured player disconnects', () => {
    const state: AppState = {
      ...stateWithPlayers(3),
      game: makeGameState({
        currentRound: 2,
        totalRounds: 3,
        featuredPlayerOrder: ['p1', 'p2', 'p3'],
      }),
    };
    // p1 was featured in round 1 (index 0), current round is 2 (index 1)
    const result = gameReducer(state, { type: 'REMOVE_PLAYER', playerId: 'p1' });
    expect(result.game!.totalRounds).toBe(3);
    expect(result.game!.featuredPlayerOrder).toContain('p1');
  });
});

// ============================================================
// START_GAME
// ============================================================

describe('START_GAME', () => {
  it('sets total rounds equal to connected player count', () => {
    const state = stateWithPlayers(4);
    const result = gameReducer(state, {
      type: 'START_GAME',
      settings: DEFAULT_SETTINGS,
      questions: [0, 1, 2, 3],
      featuredOrder: ['p1', 'p2', 'p3', 'p4'],
    });
    expect(result.game!.totalRounds).toBe(4);
  });

  it('initializes all scores to zero', () => {
    const state = stateWithPlayers(4);
    const result = gameReducer(state, {
      type: 'START_GAME',
      settings: DEFAULT_SETTINGS,
      questions: [0, 1, 2, 3],
      featuredOrder: ['p1', 'p2', 'p3', 'p4'],
    });
    expect(Object.values(result.game!.scores)).toEqual([0, 0, 0, 0]);
  });

  it('does not start if below minimum player count', () => {
    const state = stateWithPlayers(2);
    const result = gameReducer(state, {
      type: 'START_GAME',
      settings: DEFAULT_SETTINGS,
      questions: [0, 1],
      featuredOrder: ['p1', 'p2'],
    });
    expect(result.game).toBeNull();
  });

  it('sets phase to question_display', () => {
    const state = stateWithPlayers(4);
    const result = gameReducer(state, {
      type: 'START_GAME',
      settings: DEFAULT_SETTINGS,
      questions: [0, 1, 2, 3],
      featuredOrder: ['p1', 'p2', 'p3', 'p4'],
    });
    expect(result.game!.phase).toBe('question_display');
  });
});

// ============================================================
// BEGIN_ROUND
// ============================================================

describe('BEGIN_ROUND', () => {
  it('sets current round number', () => {
    const state: AppState = { ...stateWithPlayers(3), game: makeGameState() };
    const result = gameReducer(state, {
      type: 'BEGIN_ROUND',
      roundNumber: 2,
      questionIndex: 1,
      featuredPlayerId: 'p2',
    });
    expect(result.game!.currentRound).toBe(2);
  });

  it('resets answers and votes for new round', () => {
    const state: AppState = {
      ...stateWithPlayers(3),
      game: makeGameState({
        currentRoundState: {
          questionIndex: 0,
          featuredPlayerId: 'p1',
          questionText: 'test',
          answers: { p2: 'old answer' },
          votes: { p3: 'p2' },
          timerEndTime: 0,
        },
      }),
    };
    const result = gameReducer(state, {
      type: 'BEGIN_ROUND',
      roundNumber: 2,
      questionIndex: 1,
      featuredPlayerId: 'p2',
    });
    expect(result.game!.currentRoundState.answers).toEqual({});
    expect(result.game!.currentRoundState.votes).toEqual({});
  });

  it('returns state unchanged if no game is active', () => {
    const state = INITIAL_STATE;
    const result = gameReducer(state, {
      type: 'BEGIN_ROUND',
      roundNumber: 1,
      questionIndex: 0,
      featuredPlayerId: 'p1',
    });
    expect(result).toEqual(state);
  });
});

// ============================================================
// SUBMIT_ANSWER
// ============================================================

describe('SUBMIT_ANSWER', () => {
  it('stores the answer for a player', () => {
    const state: AppState = { ...stateWithPlayers(3), game: makeGameState() };
    const result = gameReducer(state, {
      type: 'SUBMIT_ANSWER',
      playerId: 'p2',
      answer: 'My answer',
    });
    expect(result.game!.currentRoundState.answers['p2']).toBe('My answer');
  });

  it('rejects duplicate submission from same player', () => {
    const state: AppState = {
      ...stateWithPlayers(3),
      game: makeGameState({
        currentRoundState: {
          questionIndex: 0,
          featuredPlayerId: 'p1',
          questionText: 'test',
          answers: { p2: 'First answer' },
          votes: {},
          timerEndTime: 0,
        },
      }),
    };
    const result = gameReducer(state, {
      type: 'SUBMIT_ANSWER',
      playerId: 'p2',
      answer: 'Second answer',
    });
    expect(result.game!.currentRoundState.answers['p2']).toBe('First answer');
  });
});

// ============================================================
// CAST_VOTE
// ============================================================

describe('CAST_VOTE', () => {
  it('stores a vote', () => {
    const state: AppState = {
      ...stateWithPlayers(3),
      game: makeGameState({
        currentRoundState: {
          questionIndex: 0,
          featuredPlayerId: 'p1',
          questionText: 'test',
          answers: { p2: 'answer A', p3: 'answer B' },
          votes: {},
          timerEndTime: 0,
        },
      }),
    };
    const result = gameReducer(state, {
      type: 'CAST_VOTE',
      voterId: 'p1',
      answerId: 'p2',
    });
    expect(result.game!.currentRoundState.votes['p1']).toBe('p2');
  });

  it('rejects self-vote', () => {
    const state: AppState = {
      ...stateWithPlayers(3),
      game: makeGameState({
        currentRoundState: {
          questionIndex: 0,
          featuredPlayerId: 'p1',
          questionText: 'test',
          answers: { p2: 'answer A', p3: 'answer B' },
          votes: {},
          timerEndTime: 0,
        },
      }),
    };
    const result = gameReducer(state, {
      type: 'CAST_VOTE',
      voterId: 'p2',
      answerId: 'p2',
    });
    expect(result.game!.currentRoundState.votes['p2']).toBeUndefined();
  });

  it('rejects duplicate vote from same voter', () => {
    const state: AppState = {
      ...stateWithPlayers(3),
      game: makeGameState({
        currentRoundState: {
          questionIndex: 0,
          featuredPlayerId: 'p1',
          questionText: 'test',
          answers: { p2: 'answer A', p3: 'answer B' },
          votes: { p1: 'p2' },
          timerEndTime: 0,
        },
      }),
    };
    const result = gameReducer(state, {
      type: 'CAST_VOTE',
      voterId: 'p1',
      answerId: 'p3',
    });
    expect(result.game!.currentRoundState.votes['p1']).toBe('p2');
  });
});

// ============================================================
// REVEAL_RESULTS
// ============================================================

describe('REVEAL_RESULTS', () => {
  it('calculates scores based on vote count', () => {
    const state: AppState = {
      ...stateWithPlayers(3),
      game: makeGameState({
        scores: { p1: 0, p2: 0, p3: 0 },
        currentRoundState: {
          questionIndex: 0,
          featuredPlayerId: 'p1',
          questionText: 'test',
          answers: { p2: 'answer A', p3: 'answer B' },
          votes: { p1: 'p2', p3: 'p2' }, // p2 gets 2 votes
          timerEndTime: 0,
        },
      }),
    };
    const result = gameReducer(state, { type: 'REVEAL_RESULTS' });
    expect(result.game!.scores['p2']).toBe(2);
    expect(result.game!.scores['p3']).toBe(0);
  });

  it('sets phase to score_reveal', () => {
    const state: AppState = {
      ...stateWithPlayers(3),
      game: makeGameState({
        currentRoundState: {
          questionIndex: 0,
          featuredPlayerId: 'p1',
          questionText: 'test',
          answers: { p2: 'a', p3: 'b' },
          votes: { p1: 'p2' },
          timerEndTime: 0,
        },
      }),
    };
    const result = gameReducer(state, { type: 'REVEAL_RESULTS' });
    expect(result.game!.phase).toBe('score_reveal');
  });

  it('handles duplicate answers - all matching authors get points', () => {
    const state: AppState = {
      ...stateWithPlayers(4),
      game: makeGameState({
        scores: { p1: 0, p2: 0, p3: 0, p4: 0 },
        currentRoundState: {
          questionIndex: 0,
          featuredPlayerId: 'p1',
          questionText: 'test',
          answers: { p2: 'same answer', p3: 'same answer', p4: 'different' },
          votes: { p1: 'p2' }, // vote for p2's answer which is same as p3's
          timerEndTime: 0,
        },
      }),
    };
    const result = gameReducer(state, { type: 'REVEAL_RESULTS' });
    // Both p2 and p3 should get the point since they have the same answer
    expect(result.game!.scores['p2']).toBe(1);
    expect(result.game!.scores['p3']).toBe(1);
  });

  it('accumulates scores across rounds', () => {
    const state: AppState = {
      ...stateWithPlayers(3),
      game: makeGameState({
        scores: { p1: 0, p2: 3, p3: 1 }, // existing scores from previous rounds
        currentRoundState: {
          questionIndex: 1,
          featuredPlayerId: 'p2',
          questionText: 'test',
          answers: { p1: 'a', p3: 'b' },
          votes: { p2: 'p1', p3: 'p1' }, // p1 gets 2 votes this round
          timerEndTime: 0,
        },
      }),
    };
    const result = gameReducer(state, { type: 'REVEAL_RESULTS' });
    expect(result.game!.scores['p1']).toBe(2); // 0 + 2
    expect(result.game!.scores['p2']).toBe(3); // unchanged
    expect(result.game!.scores['p3']).toBe(1); // unchanged
  });
});

// ============================================================
// END_GAME
// ============================================================

describe('END_GAME', () => {
  it('transitions to game_end phase', () => {
    const state: AppState = {
      ...stateWithPlayers(3),
      game: makeGameState({ phase: 'score_reveal' }),
    };
    const result = gameReducer(state, { type: 'END_GAME' });
    expect(result.game!.phase).toBe('game_end');
  });

  it('returns state unchanged if no game active', () => {
    const result = gameReducer(INITIAL_STATE, { type: 'END_GAME' });
    expect(result).toEqual(INITIAL_STATE);
  });
});

// ============================================================
// APPLY_FULL_STATE
// ============================================================

describe('APPLY_FULL_STATE', () => {
  it('replaces entire game state', () => {
    const state: AppState = { ...stateWithPlayers(3), game: makeGameState() };
    const newGameState = makeGameState({
      phase: 'voting_phase',
      currentRound: 2,
      scores: { p1: 5, p2: 3, p3: 1 },
    });
    const result = gameReducer(state, { type: 'APPLY_FULL_STATE', state: newGameState });
    expect(result.game).toEqual(newGameState);
  });
});

// ============================================================
// UPDATE_SETTINGS
// ============================================================

describe('UPDATE_SETTINGS', () => {
  it('updates settings when no game is active', () => {
    const newSettings: GameSettings = {
      minPlayers: 3,
      maxPlayers: 10,
      answerTimerSeconds: 120,
      votingTimerSeconds: 45,
    };
    const result = gameReducer(INITIAL_STATE, { type: 'UPDATE_SETTINGS', settings: newSettings });
    expect(result.settings).toEqual(newSettings);
  });

  it('rejects settings update during active game', () => {
    const state: AppState = {
      ...stateWithPlayers(3),
      game: makeGameState({ phase: 'answer_phase' }),
    };
    const newSettings: GameSettings = {
      minPlayers: 5,
      maxPlayers: 10,
      answerTimerSeconds: 120,
      votingTimerSeconds: 45,
    };
    const result = gameReducer(state, { type: 'UPDATE_SETTINGS', settings: newSettings });
    expect(result.settings).toEqual(DEFAULT_SETTINGS);
  });
});

// ============================================================
// computeLeaderboard
// ============================================================

describe('computeLeaderboard', () => {
  it('sorts by score descending', () => {
    const players = [
      makePlayer({ id: 'p1', name: 'Alice', joinOrder: 1 }),
      makePlayer({ id: 'p2', name: 'Bob', joinOrder: 2 }),
      makePlayer({ id: 'p3', name: 'Charlie', joinOrder: 3 }),
    ];
    const scores = { p1: 2, p2: 5, p3: 1 };
    const leaderboard = computeLeaderboard(scores, players);
    expect(leaderboard[0].playerId).toBe('p2');
    expect(leaderboard[1].playerId).toBe('p1');
    expect(leaderboard[2].playerId).toBe('p3');
  });

  it('breaks ties by join order (ascending)', () => {
    const players = [
      makePlayer({ id: 'p1', name: 'Alice', joinOrder: 1 }),
      makePlayer({ id: 'p2', name: 'Bob', joinOrder: 2 }),
      makePlayer({ id: 'p3', name: 'Charlie', joinOrder: 3 }),
    ];
    const scores = { p1: 3, p2: 3, p3: 3 };
    const leaderboard = computeLeaderboard(scores, players);
    expect(leaderboard[0].playerId).toBe('p1');
    expect(leaderboard[1].playerId).toBe('p2');
    expect(leaderboard[2].playerId).toBe('p3');
  });

  it('assigns correct ranks with ties', () => {
    const players = [
      makePlayer({ id: 'p1', name: 'Alice', joinOrder: 1 }),
      makePlayer({ id: 'p2', name: 'Bob', joinOrder: 2 }),
      makePlayer({ id: 'p3', name: 'Charlie', joinOrder: 3 }),
    ];
    const scores = { p1: 5, p2: 5, p3: 2 };
    const leaderboard = computeLeaderboard(scores, players);
    expect(leaderboard[0].rank).toBe(1);
    expect(leaderboard[1].rank).toBe(1);
    expect(leaderboard[2].rank).toBe(3);
  });
});

// ============================================================
// GameProvider & useGame hook
// ============================================================

describe('GameProvider', () => {
  it('provides state and dispatch via useGame hook', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <GameProvider>{children}</GameProvider>
    );
    const { result } = renderHook(() => useGame(), { wrapper });
    expect(result.current.state).toEqual(INITIAL_STATE);
    expect(typeof result.current.dispatch).toBe('function');
  });

  it('accepts custom initial state', () => {
    const customState: AppState = {
      ...INITIAL_STATE,
      roomCode: 'ABCD',
    };
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <GameProvider initialState={customState}>{children}</GameProvider>
    );
    const { result } = renderHook(() => useGame(), { wrapper });
    expect(result.current.state.roomCode).toBe('ABCD');
  });

  it('throws when useGame is used outside provider', () => {
    expect(() => {
      renderHook(() => useGame());
    }).toThrow('useGame must be used within a GameProvider');
  });

  it('dispatches actions correctly', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <GameProvider>{children}</GameProvider>
    );
    const { result } = renderHook(() => useGame(), { wrapper });

    act(() => {
      result.current.dispatch({
        type: 'ADD_PLAYER',
        player: makePlayer({ id: 'p1', name: 'Alice' }),
      });
    });

    expect(result.current.state.players).toHaveLength(1);
    expect(result.current.state.players[0].name).toBe('Alice');
  });
});
