import { useEffect, useRef, useCallback } from 'react';
import type { Player, WebSocketMessage, GameState } from '../types';

// ============================================================
// Types
// ============================================================

export interface DisconnectionHandlerOptions {
  /** Current list of players in the room */
  players: Player[];
  /** Current game state (null if no active game) */
  gameState: GameState | null;
  /** The last received WebSocket message */
  lastMessage: WebSocketMessage | null;
  /** Dispatch function for game actions */
  dispatch: (action: { type: string; [key: string]: unknown }) => void;
  /** Callback when game should be paused (connected < 3) */
  onGamePaused?: (connectedCount: number) => void;
  /** Callback when game can resume (connected >= 3 after being paused) */
  onGameResumed?: () => void;
  /** Callback when a player reconnects */
  onPlayerReconnected?: (player: Player) => void;
}

export interface DisconnectionHandlerReturn {
  /** Number of currently connected players */
  connectedPlayerCount: number;
  /** Whether the game is paused due to insufficient players */
  isGamePaused: boolean;
  /** Calculate the phase completion threshold for answer phase */
  getAnswerThreshold: () => number;
  /** Calculate the phase completion threshold for voting phase */
  getVotingThreshold: () => number;
}

// ============================================================
// Constants
// ============================================================

const MIN_PLAYERS_TO_CONTINUE = 3;

// ============================================================
// Pure utility functions (exported for testing)
// ============================================================

/**
 * Calculate the number of connected players from the player list.
 * Requirements: 10.1
 */
export function getConnectedPlayerCount(players: Player[]): number {
  return players.filter((p) => p.isConnected).length;
}

/**
 * Calculate the answer phase completion threshold.
 * All connected players (excluding the featured player) should submit answers.
 * Requirements: 10.1, 10.2
 */
export function calculateAnswerThreshold(
  players: Player[],
  featuredPlayerId: string
): number {
  return players.filter(
    (p) => p.isConnected && p.id !== featuredPlayerId
  ).length;
}

/**
 * Calculate the voting phase completion threshold.
 * All connected players who are eligible to vote should vote.
 * Players who didn't submit an answer can still vote (Req 6.5).
 * Requirements: 10.1, 10.3
 */
export function calculateVotingThreshold(
  players: Player[],
  _featuredPlayerId: string
): number {
  return players.filter((p) => p.isConnected).length;
}

/**
 * Determine if the game should be paused due to insufficient players.
 * Requirements: 10.5
 */
export function shouldPauseGame(
  connectedCount: number,
  gameState: GameState | null
): boolean {
  if (!gameState) return false;
  if (gameState.phase === 'lobby' || gameState.phase === 'game_end') return false;
  return connectedCount < MIN_PLAYERS_TO_CONTINUE;
}

// ============================================================
// Hook
// ============================================================

/**
 * useDisconnectionHandler - Orchestrates disconnection/reconnection handling.
 *
 * Responsibilities:
 * 1. Listens for `player_disconnected` messages and dispatches REMOVE_PLAYER
 * 2. Listens for `player_reconnected` messages and restores players
 * 3. Checks if connected players drop below 3 and triggers pause
 * 4. Recalculates phase completion thresholds based on connected players
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7
 */
export function useDisconnectionHandler(
  options: DisconnectionHandlerOptions
): DisconnectionHandlerReturn {
  const {
    players,
    gameState,
    lastMessage,
    dispatch,
    onGamePaused,
    onGameResumed,
    onPlayerReconnected,
  } = options;

  const wasPausedRef = useRef(false);

  const connectedPlayerCount = getConnectedPlayerCount(players);
  const isGamePaused = shouldPauseGame(connectedPlayerCount, gameState);

  // ============================================================
  // Handle incoming disconnection/reconnection messages
  // ============================================================

  useEffect(() => {
    if (!lastMessage) return;

    if (lastMessage.type === 'player_disconnected') {
      // Dispatch REMOVE_PLAYER to mark player as disconnected.
      // The reducer handles: marking isConnected=false, adjusting featured order
      // for unfeatured players, and reducing total rounds.
      dispatch({ type: 'REMOVE_PLAYER', playerId: lastMessage.playerId });
    }

    if (lastMessage.type === 'player_reconnected') {
      // Restore the reconnected player. They enter in non-participating state
      // for the current phase (Req 10.6). We re-add them as connected.
      const reconnectedPlayer = lastMessage.player;
      dispatch({ type: 'ADD_PLAYER', player: reconnectedPlayer });

      if (onPlayerReconnected) {
        onPlayerReconnected(reconnectedPlayer);
      }
    }
  }, [lastMessage, dispatch, onPlayerReconnected]);

  // ============================================================
  // Monitor pause/resume state
  // ============================================================

  useEffect(() => {
    if (isGamePaused && !wasPausedRef.current) {
      wasPausedRef.current = true;
      if (onGamePaused) {
        onGamePaused(connectedPlayerCount);
      }
    } else if (!isGamePaused && wasPausedRef.current) {
      wasPausedRef.current = false;
      if (onGameResumed) {
        onGameResumed();
      }
    }
  }, [isGamePaused, connectedPlayerCount, onGamePaused, onGameResumed]);

  // ============================================================
  // Threshold calculators
  // ============================================================

  const getAnswerThreshold = useCallback((): number => {
    if (!gameState) return 0;
    const featuredPlayerId = gameState.currentRoundState.featuredPlayerId;
    return calculateAnswerThreshold(players, featuredPlayerId);
  }, [players, gameState]);

  const getVotingThreshold = useCallback((): number => {
    if (!gameState) return 0;
    const featuredPlayerId = gameState.currentRoundState.featuredPlayerId;
    return calculateVotingThreshold(players, featuredPlayerId);
  }, [players, gameState]);

  return {
    connectedPlayerCount,
    isGamePaused,
    getAnswerThreshold,
    getVotingThreshold,
  };
}
