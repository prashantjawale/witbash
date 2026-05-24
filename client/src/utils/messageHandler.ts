import type { GameAction, WebSocketMessage } from '../types';

/**
 * Serialize an outgoing WebSocket message to a JSON string.
 * Requirements: 11.1
 */
export function serializeMessage(message: WebSocketMessage): string {
  return JSON.stringify(message);
}

/**
 * Deserialize and validate an incoming WebSocket message string.
 * Returns the parsed message if valid, or null if parsing fails or the message
 * lacks a `type` field.
 * Requirements: 11.1, 12.1
 */
export function deserializeMessage(raw: string): WebSocketMessage | null {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || typeof parsed.type !== 'string') {
      return null;
    }
    return parsed as WebSocketMessage;
  } catch {
    return null;
  }
}

/**
 * Route an incoming WebSocket message to the appropriate GameAction for dispatch.
 * Returns null for message types that don't map to a reducer action (e.g. consensus
 * messages handled elsewhere) or for unknown/invalid messages.
 * Requirements: 11.1, 12.1
 */
export function messageToAction(message: WebSocketMessage): GameAction | null {
  switch (message.type) {
    case 'player_joined':
      return { type: 'ADD_PLAYER', player: message.player };

    case 'player_disconnected':
      return { type: 'REMOVE_PLAYER', playerId: message.playerId };

    case 'game_start':
      return {
        type: 'START_GAME',
        settings: message.settings,
        questions: message.questions,
        featuredOrder: message.featuredPlayerOrder,
      };

    case 'round_begin':
      return {
        type: 'BEGIN_ROUND',
        roundNumber: message.roundNumber,
        questionIndex: message.questionIndex,
        featuredPlayerId: message.featuredPlayerId,
        questionText: message.questionText,
      };

    case 'answer_submit':
      return {
        type: 'SUBMIT_ANSWER',
        playerId: message.playerId,
        answer: message.answer,
      };

    case 'vote_cast':
      return {
        type: 'CAST_VOTE',
        voterId: message.voterId,
        answerId: message.answerId,
      };

    case 'results_reveal':
      return { type: 'REVEAL_RESULTS' };

    case 'settings_update':
      return { type: 'UPDATE_SETTINGS', settings: message.settings };

    case 'full_state':
      return { type: 'APPLY_FULL_STATE', state: message.state };

    case 'room_sync':
      return { type: 'SYNC_PLAYERS', players: message.players, settings: message.settings };

    default:
      // Unknown or unhandled message types (join_room, player_reconnected,
      // voting_phase_start, state_hash, state_request) are handled elsewhere
      return null;
  }
}

/**
 * Convenience function: parse a raw WebSocket message string and return the
 * corresponding GameAction, or null if the message is invalid or doesn't map
 * to a reducer action.
 */
export function handleIncomingMessage(raw: string): GameAction | null {
  const message = deserializeMessage(raw);
  if (!message) return null;
  return messageToAction(message);
}
