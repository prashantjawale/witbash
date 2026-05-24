import { describe, it, expect } from 'vitest';
import {
  serializeMessage,
  deserializeMessage,
  messageToAction,
  handleIncomingMessage,
} from './messageHandler';
import type { Player, GameSettings, GameState, WebSocketMessage } from '../types';

const mockPlayer: Player = {
  id: 'player-1',
  name: 'Alice',
  isHost: false,
  isConnected: true,
  joinOrder: 1,
};

const mockSettings: GameSettings = {
  minPlayers: 4,
  maxPlayers: 7,
  answerTimerSeconds: 60,
  votingTimerSeconds: 30,
};

describe('serializeMessage', () => {
  it('serializes a player_joined message to JSON', () => {
    const msg: WebSocketMessage = { type: 'player_joined', player: mockPlayer };
    const result = serializeMessage(msg);
    expect(JSON.parse(result)).toEqual(msg);
  });

  it('serializes a settings_update message to JSON', () => {
    const msg: WebSocketMessage = { type: 'settings_update', settings: mockSettings };
    const result = serializeMessage(msg);
    expect(JSON.parse(result)).toEqual(msg);
  });
});

describe('deserializeMessage', () => {
  it('parses a valid JSON message with a type field', () => {
    const msg = { type: 'player_joined', player: mockPlayer };
    const result = deserializeMessage(JSON.stringify(msg));
    expect(result).toEqual(msg);
  });

  it('returns null for invalid JSON', () => {
    expect(deserializeMessage('not json')).toBeNull();
  });

  it('returns null for JSON without a type field', () => {
    expect(deserializeMessage(JSON.stringify({ foo: 'bar' }))).toBeNull();
  });

  it('returns null for JSON with non-string type field', () => {
    expect(deserializeMessage(JSON.stringify({ type: 123 }))).toBeNull();
  });

  it('returns null for null JSON value', () => {
    expect(deserializeMessage('null')).toBeNull();
  });

  it('returns null for JSON array', () => {
    expect(deserializeMessage('[1, 2, 3]')).toBeNull();
  });
});

describe('messageToAction', () => {
  it('maps player_joined to ADD_PLAYER', () => {
    const msg: WebSocketMessage = { type: 'player_joined', player: mockPlayer };
    expect(messageToAction(msg)).toEqual({ type: 'ADD_PLAYER', player: mockPlayer });
  });

  it('maps player_disconnected to REMOVE_PLAYER', () => {
    const msg: WebSocketMessage = { type: 'player_disconnected', playerId: 'player-1' };
    expect(messageToAction(msg)).toEqual({ type: 'REMOVE_PLAYER', playerId: 'player-1' });
  });

  it('maps game_start to START_GAME', () => {
    const msg: WebSocketMessage = {
      type: 'game_start',
      settings: mockSettings,
      questions: [0, 1, 2],
      featuredPlayerOrder: ['p1', 'p2', 'p3'],
      totalRounds: 3,
    };
    expect(messageToAction(msg)).toEqual({
      type: 'START_GAME',
      settings: mockSettings,
      questions: [0, 1, 2],
      featuredOrder: ['p1', 'p2', 'p3'],
    });
  });

  it('maps round_begin to BEGIN_ROUND', () => {
    const msg: WebSocketMessage = {
      type: 'round_begin',
      roundNumber: 2,
      questionIndex: 5,
      featuredPlayerId: 'player-2',
    };
    expect(messageToAction(msg)).toEqual({
      type: 'BEGIN_ROUND',
      roundNumber: 2,
      questionIndex: 5,
      featuredPlayerId: 'player-2',
    });
  });

  it('maps answer_submit to SUBMIT_ANSWER', () => {
    const msg: WebSocketMessage = {
      type: 'answer_submit',
      playerId: 'player-1',
      answer: 'My funny answer',
      roundNumber: 1,
    };
    expect(messageToAction(msg)).toEqual({
      type: 'SUBMIT_ANSWER',
      playerId: 'player-1',
      answer: 'My funny answer',
    });
  });

  it('maps vote_cast to CAST_VOTE', () => {
    const msg: WebSocketMessage = {
      type: 'vote_cast',
      voterId: 'player-1',
      answerId: 'player-2',
      roundNumber: 1,
    };
    expect(messageToAction(msg)).toEqual({
      type: 'CAST_VOTE',
      voterId: 'player-1',
      answerId: 'player-2',
    });
  });

  it('maps results_reveal to REVEAL_RESULTS', () => {
    const msg: WebSocketMessage = {
      type: 'results_reveal',
      results: [],
      leaderboard: [],
    };
    expect(messageToAction(msg)).toEqual({ type: 'REVEAL_RESULTS' });
  });

  it('maps settings_update to UPDATE_SETTINGS', () => {
    const msg: WebSocketMessage = { type: 'settings_update', settings: mockSettings };
    expect(messageToAction(msg)).toEqual({ type: 'UPDATE_SETTINGS', settings: mockSettings });
  });

  it('maps full_state to APPLY_FULL_STATE', () => {
    const mockState: GameState = {
      phase: 'answer_phase',
      currentRound: 1,
      totalRounds: 4,
      questions: [0, 1, 2, 3],
      featuredPlayerOrder: ['p1', 'p2', 'p3', 'p4'],
      scores: { p1: 0, p2: 0, p3: 0, p4: 0 },
      currentRoundState: {
        questionIndex: 0,
        featuredPlayerId: 'p1',
        questionText: 'What would Alice do?',
        answers: {},
        votes: {},
        timerEndTime: 0,
      },
    };
    const msg: WebSocketMessage = {
      type: 'full_state',
      senderId: 'p2',
      targetId: 'p1',
      state: mockState,
    };
    expect(messageToAction(msg)).toEqual({ type: 'APPLY_FULL_STATE', state: mockState });
  });

  it('returns null for join_room messages', () => {
    const msg: WebSocketMessage = { type: 'join_room', roomCode: 'ABCD', playerId: 'p1' };
    expect(messageToAction(msg)).toBeNull();
  });

  it('returns null for player_reconnected messages', () => {
    const msg: WebSocketMessage = { type: 'player_reconnected', player: mockPlayer };
    expect(messageToAction(msg)).toBeNull();
  });

  it('returns null for state_hash messages', () => {
    const msg: WebSocketMessage = {
      type: 'state_hash',
      playerId: 'p1',
      hash: 'abc123',
      phase: 'answer_phase',
      roundNumber: 1,
    };
    expect(messageToAction(msg)).toBeNull();
  });

  it('returns null for state_request messages', () => {
    const msg: WebSocketMessage = {
      type: 'state_request',
      requesterId: 'p1',
      targetId: 'p2',
    };
    expect(messageToAction(msg)).toBeNull();
  });

  it('returns null for voting_phase_start messages', () => {
    const msg: WebSocketMessage = {
      type: 'voting_phase_start',
      answers: [{ answerId: 'p1', text: 'answer' }],
    };
    expect(messageToAction(msg)).toBeNull();
  });
});

describe('handleIncomingMessage', () => {
  it('parses and routes a valid message in one step', () => {
    const raw = JSON.stringify({ type: 'player_disconnected', playerId: 'p1' });
    expect(handleIncomingMessage(raw)).toEqual({ type: 'REMOVE_PLAYER', playerId: 'p1' });
  });

  it('returns null for invalid JSON', () => {
    expect(handleIncomingMessage('garbage')).toBeNull();
  });

  it('returns null for valid JSON with unknown type', () => {
    expect(handleIncomingMessage(JSON.stringify({ type: 'unknown_type' }))).toBeNull();
  });

  it('returns null for valid JSON without type field', () => {
    expect(handleIncomingMessage(JSON.stringify({ data: 'hello' }))).toBeNull();
  });
});
