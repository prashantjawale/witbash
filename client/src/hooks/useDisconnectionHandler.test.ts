import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useDisconnectionHandler,
  getConnectedPlayerCount,
  calculateAnswerThreshold,
  calculateVotingThreshold,
  shouldPauseGame,
} from './useDisconnectionHandler';
import type { Player, GameState, WebSocketMessage } from '../types';

// ============================================================
// Test Helpers
// ============================================================

function createPlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: `player-${Math.random().toString(36).slice(2, 8)}`,
    name: 'TestPlayer',
    isHost: false,
    isConnected: true,
    joinOrder: 1,
    ...overrides,
  };
}

function createGameState(overrides: Partial<GameState> = {}): GameState {
  return {
    phase: 'answer_phase',
    currentRound: 1,
    totalRounds: 4,
    questions: [0, 1, 2, 3],
    featuredPlayerOrder: ['p1', 'p2', 'p3', 'p4'],
    scores: { p1: 0, p2: 0, p3: 0, p4: 0 },
    currentRoundState: {
      questionIndex: 0,
      featuredPlayerId: 'p1',
      questionText: 'What would p1 do?',
      answers: {},
      votes: {},
      timerEndTime: Date.now() + 60000,
    },
    ...overrides,
  };
}

// ============================================================
// Pure Function Tests
// ============================================================

describe('getConnectedPlayerCount', () => {
  it('returns count of connected players', () => {
    const players = [
      createPlayer({ id: 'p1', isConnected: true }),
      createPlayer({ id: 'p2', isConnected: true }),
      createPlayer({ id: 'p3', isConnected: false }),
      createPlayer({ id: 'p4', isConnected: true }),
    ];
    expect(getConnectedPlayerCount(players)).toBe(3);
  });

  it('returns 0 for empty player list', () => {
    expect(getConnectedPlayerCount([])).toBe(0);
  });

  it('returns 0 when all players disconnected', () => {
    const players = [
      createPlayer({ id: 'p1', isConnected: false }),
      createPlayer({ id: 'p2', isConnected: false }),
    ];
    expect(getConnectedPlayerCount(players)).toBe(0);
  });
});

describe('calculateAnswerThreshold', () => {
  it('excludes featured player from threshold', () => {
    const players = [
      createPlayer({ id: 'p1', isConnected: true }),
      createPlayer({ id: 'p2', isConnected: true }),
      createPlayer({ id: 'p3', isConnected: true }),
      createPlayer({ id: 'p4', isConnected: true }),
    ];
    // Featured player is p1, so threshold = 3 (p2, p3, p4)
    expect(calculateAnswerThreshold(players, 'p1')).toBe(3);
  });

  it('excludes disconnected players from threshold', () => {
    const players = [
      createPlayer({ id: 'p1', isConnected: true }),
      createPlayer({ id: 'p2', isConnected: true }),
      createPlayer({ id: 'p3', isConnected: false }),
      createPlayer({ id: 'p4', isConnected: true }),
    ];
    // Featured is p1, p3 disconnected → threshold = 2 (p2, p4)
    expect(calculateAnswerThreshold(players, 'p1')).toBe(2);
  });

  it('returns 0 when only featured player is connected', () => {
    const players = [
      createPlayer({ id: 'p1', isConnected: true }),
      createPlayer({ id: 'p2', isConnected: false }),
      createPlayer({ id: 'p3', isConnected: false }),
    ];
    expect(calculateAnswerThreshold(players, 'p1')).toBe(0);
  });
});

describe('calculateVotingThreshold', () => {
  it('includes all connected players', () => {
    const players = [
      createPlayer({ id: 'p1', isConnected: true }),
      createPlayer({ id: 'p2', isConnected: true }),
      createPlayer({ id: 'p3', isConnected: true }),
      createPlayer({ id: 'p4', isConnected: true }),
    ];
    expect(calculateVotingThreshold(players, 'p1')).toBe(4);
  });

  it('excludes disconnected players from threshold', () => {
    const players = [
      createPlayer({ id: 'p1', isConnected: true }),
      createPlayer({ id: 'p2', isConnected: true }),
      createPlayer({ id: 'p3', isConnected: false }),
      createPlayer({ id: 'p4', isConnected: true }),
    ];
    expect(calculateVotingThreshold(players, 'p1')).toBe(3);
  });
});

describe('shouldPauseGame', () => {
  it('returns true when connected < 3 during active game', () => {
    const gameState = createGameState({ phase: 'answer_phase' });
    expect(shouldPauseGame(2, gameState)).toBe(true);
  });

  it('returns false when connected >= 3 during active game', () => {
    const gameState = createGameState({ phase: 'answer_phase' });
    expect(shouldPauseGame(3, gameState)).toBe(false);
  });

  it('returns false when no game is active', () => {
    expect(shouldPauseGame(2, null)).toBe(false);
  });

  it('returns false during lobby phase', () => {
    const gameState = createGameState({ phase: 'lobby' });
    expect(shouldPauseGame(2, gameState)).toBe(false);
  });

  it('returns false during game_end phase', () => {
    const gameState = createGameState({ phase: 'game_end' });
    expect(shouldPauseGame(2, gameState)).toBe(false);
  });

  it('returns true during voting phase with 1 player', () => {
    const gameState = createGameState({ phase: 'voting_phase' });
    expect(shouldPauseGame(1, gameState)).toBe(true);
  });

  it('returns true during score_reveal phase with 2 players', () => {
    const gameState = createGameState({ phase: 'score_reveal' });
    expect(shouldPauseGame(2, gameState)).toBe(true);
  });
});

// ============================================================
// Hook Tests
// ============================================================

describe('useDisconnectionHandler', () => {
  let mockDispatch: ReturnType<typeof vi.fn>;
  let mockOnGamePaused: ReturnType<typeof vi.fn>;
  let mockOnGameResumed: ReturnType<typeof vi.fn>;
  let mockOnPlayerReconnected: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockDispatch = vi.fn();
    mockOnGamePaused = vi.fn();
    mockOnGameResumed = vi.fn();
    mockOnPlayerReconnected = vi.fn();
  });

  it('dispatches REMOVE_PLAYER on player_disconnected message', () => {
    const players = [
      createPlayer({ id: 'p1', isConnected: true }),
      createPlayer({ id: 'p2', isConnected: true }),
      createPlayer({ id: 'p3', isConnected: true }),
      createPlayer({ id: 'p4', isConnected: true }),
    ];
    const gameState = createGameState();
    const disconnectMessage: WebSocketMessage = {
      type: 'player_disconnected',
      playerId: 'p2',
    };

    renderHook(() =>
      useDisconnectionHandler({
        players,
        gameState,
        lastMessage: disconnectMessage,
        dispatch: mockDispatch,
        onGamePaused: mockOnGamePaused,
      })
    );

    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'REMOVE_PLAYER',
      playerId: 'p2',
    });
  });

  it('dispatches ADD_PLAYER on player_reconnected message', () => {
    const reconnectedPlayer = createPlayer({ id: 'p2', name: 'Bob', isConnected: true });
    const players = [
      createPlayer({ id: 'p1', isConnected: true }),
      createPlayer({ id: 'p3', isConnected: true }),
      createPlayer({ id: 'p4', isConnected: true }),
    ];
    const gameState = createGameState();
    const reconnectMessage: WebSocketMessage = {
      type: 'player_reconnected',
      player: reconnectedPlayer,
    };

    renderHook(() =>
      useDisconnectionHandler({
        players,
        gameState,
        lastMessage: reconnectMessage,
        dispatch: mockDispatch,
        onPlayerReconnected: mockOnPlayerReconnected,
      })
    );

    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'ADD_PLAYER',
      player: reconnectedPlayer,
    });
    expect(mockOnPlayerReconnected).toHaveBeenCalledWith(reconnectedPlayer);
  });

  it('calls onGamePaused when connected players drop below 3', () => {
    const players = [
      createPlayer({ id: 'p1', isConnected: true }),
      createPlayer({ id: 'p2', isConnected: true }),
      createPlayer({ id: 'p3', isConnected: false }),
      createPlayer({ id: 'p4', isConnected: false }),
    ];
    const gameState = createGameState({ phase: 'answer_phase' });

    renderHook(() =>
      useDisconnectionHandler({
        players,
        gameState,
        lastMessage: null,
        dispatch: mockDispatch,
        onGamePaused: mockOnGamePaused,
      })
    );

    expect(mockOnGamePaused).toHaveBeenCalledWith(2);
  });

  it('calls onGameResumed when players reconnect above threshold', () => {
    // Start with paused state (2 connected)
    const pausedPlayers = [
      createPlayer({ id: 'p1', isConnected: true }),
      createPlayer({ id: 'p2', isConnected: true }),
      createPlayer({ id: 'p3', isConnected: false }),
      createPlayer({ id: 'p4', isConnected: false }),
    ];
    const gameState = createGameState({ phase: 'answer_phase' });

    const { rerender } = renderHook(
      ({ players }) =>
        useDisconnectionHandler({
          players,
          gameState,
          lastMessage: null,
          dispatch: mockDispatch,
          onGamePaused: mockOnGamePaused,
          onGameResumed: mockOnGameResumed,
        }),
      { initialProps: { players: pausedPlayers } }
    );

    expect(mockOnGamePaused).toHaveBeenCalledWith(2);

    // Now reconnect a player (3 connected)
    const resumedPlayers = [
      createPlayer({ id: 'p1', isConnected: true }),
      createPlayer({ id: 'p2', isConnected: true }),
      createPlayer({ id: 'p3', isConnected: true }),
      createPlayer({ id: 'p4', isConnected: false }),
    ];

    rerender({ players: resumedPlayers });

    expect(mockOnGameResumed).toHaveBeenCalled();
  });

  it('does not call onGamePaused when no game is active', () => {
    const players = [
      createPlayer({ id: 'p1', isConnected: true }),
      createPlayer({ id: 'p2', isConnected: true }),
    ];

    renderHook(() =>
      useDisconnectionHandler({
        players,
        gameState: null,
        lastMessage: null,
        dispatch: mockDispatch,
        onGamePaused: mockOnGamePaused,
      })
    );

    expect(mockOnGamePaused).not.toHaveBeenCalled();
  });

  it('returns correct connectedPlayerCount', () => {
    const players = [
      createPlayer({ id: 'p1', isConnected: true }),
      createPlayer({ id: 'p2', isConnected: false }),
      createPlayer({ id: 'p3', isConnected: true }),
      createPlayer({ id: 'p4', isConnected: true }),
    ];
    const gameState = createGameState();

    const { result } = renderHook(() =>
      useDisconnectionHandler({
        players,
        gameState,
        lastMessage: null,
        dispatch: mockDispatch,
      })
    );

    expect(result.current.connectedPlayerCount).toBe(3);
  });

  it('returns correct isGamePaused state', () => {
    const players = [
      createPlayer({ id: 'p1', isConnected: true }),
      createPlayer({ id: 'p2', isConnected: true }),
      createPlayer({ id: 'p3', isConnected: false }),
      createPlayer({ id: 'p4', isConnected: false }),
    ];
    const gameState = createGameState({ phase: 'voting_phase' });

    const { result } = renderHook(() =>
      useDisconnectionHandler({
        players,
        gameState,
        lastMessage: null,
        dispatch: mockDispatch,
      })
    );

    expect(result.current.isGamePaused).toBe(true);
  });

  it('getAnswerThreshold recalculates based on connected players', () => {
    const players = [
      createPlayer({ id: 'p1', isConnected: true }),
      createPlayer({ id: 'p2', isConnected: true }),
      createPlayer({ id: 'p3', isConnected: true }),
      createPlayer({ id: 'p4', isConnected: false }),
    ];
    const gameState = createGameState(); // featured player is p1

    const { result } = renderHook(() =>
      useDisconnectionHandler({
        players,
        gameState,
        lastMessage: null,
        dispatch: mockDispatch,
      })
    );

    // p1 is featured, p4 is disconnected → threshold = 2 (p2, p3)
    expect(result.current.getAnswerThreshold()).toBe(2);
  });

  it('getVotingThreshold recalculates based on connected players', () => {
    const players = [
      createPlayer({ id: 'p1', isConnected: true }),
      createPlayer({ id: 'p2', isConnected: true }),
      createPlayer({ id: 'p3', isConnected: true }),
      createPlayer({ id: 'p4', isConnected: false }),
    ];
    const gameState = createGameState();

    const { result } = renderHook(() =>
      useDisconnectionHandler({
        players,
        gameState,
        lastMessage: null,
        dispatch: mockDispatch,
      })
    );

    // All connected players can vote: p1, p2, p3 = 3
    expect(result.current.getVotingThreshold()).toBe(3);
  });

  it('does not dispatch for unrelated message types', () => {
    const players = [
      createPlayer({ id: 'p1', isConnected: true }),
      createPlayer({ id: 'p2', isConnected: true }),
      createPlayer({ id: 'p3', isConnected: true }),
    ];
    const gameState = createGameState();
    const unrelatedMessage: WebSocketMessage = {
      type: 'state_hash',
      playerId: 'p1',
      hash: 'abc123',
      phase: 'answer_phase',
      roundNumber: 1,
    };

    renderHook(() =>
      useDisconnectionHandler({
        players,
        gameState,
        lastMessage: unrelatedMessage,
        dispatch: mockDispatch,
      })
    );

    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('handles featured player disconnect - round continues', () => {
    // When the featured player disconnects, the round should continue
    // (Req 10.7). The REMOVE_PLAYER action is dispatched, and the reducer
    // handles the featured order adjustment.
    const players = [
      createPlayer({ id: 'p1', isConnected: true }), // featured player
      createPlayer({ id: 'p2', isConnected: true }),
      createPlayer({ id: 'p3', isConnected: true }),
      createPlayer({ id: 'p4', isConnected: true }),
    ];
    const gameState = createGameState({
      currentRoundState: {
        questionIndex: 0,
        featuredPlayerId: 'p1',
        questionText: 'What would p1 do?',
        answers: {},
        votes: {},
        timerEndTime: Date.now() + 60000,
      },
    });
    const disconnectMessage: WebSocketMessage = {
      type: 'player_disconnected',
      playerId: 'p1',
    };

    const { result } = renderHook(() =>
      useDisconnectionHandler({
        players,
        gameState,
        lastMessage: disconnectMessage,
        dispatch: mockDispatch,
      })
    );

    // REMOVE_PLAYER is dispatched - the reducer handles the rest
    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'REMOVE_PLAYER',
      playerId: 'p1',
    });

    // Game is not paused (still 3 connected after p1 disconnects in the
    // players array passed to the hook - the actual state update happens
    // after dispatch)
    expect(result.current.isGamePaused).toBe(false);
  });

  it('threshold returns 0 when no game state', () => {
    const players = [
      createPlayer({ id: 'p1', isConnected: true }),
      createPlayer({ id: 'p2', isConnected: true }),
    ];

    const { result } = renderHook(() =>
      useDisconnectionHandler({
        players,
        gameState: null,
        lastMessage: null,
        dispatch: mockDispatch,
      })
    );

    expect(result.current.getAnswerThreshold()).toBe(0);
    expect(result.current.getVotingThreshold()).toBe(0);
  });
});
