import { useState, useCallback, useEffect } from 'react';
import {
  validatePlayerName,
  validateRoomCode,
  generateRoomCode,
} from '../utils/validation';
import type { Player, WebSocketMessage } from '../types';
import type { ConnectionStatus } from '../hooks/useWebSocket';

// ============================================================
// Types
// ============================================================

export interface JoinScreenProps {
  /** WebSocket URL (for display/reference only) */
  wsUrl: string;
  /** Callback when player successfully joins a room */
  onJoined: (player: Player, roomCode: string) => void;
  /** List of existing player names in the room (for duplicate check) */
  existingPlayerNames?: string[];
  /** Send function from the App-level WebSocket */
  send: (message: WebSocketMessage) => void;
  /** Connection status from the App-level WebSocket */
  connectionStatus: ConnectionStatus;
  /** Reconnect function from the App-level WebSocket */
  reconnect: () => void;
  /** Last message from the App-level WebSocket */
  lastMessage: WebSocketMessage | null;
}

export type JoinError =
  | 'invalid_name'
  | 'duplicate_name'
  | 'room_not_found'
  | 'room_full'
  | 'connection_failure'
  | null;

// ============================================================
// Component
// ============================================================

export function JoinScreen({
  onJoined,
  existingPlayerNames = [],
  send,
  connectionStatus,
  reconnect,
  lastMessage,
}: JoinScreenProps) {
  const [playerName, setPlayerName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [error, setError] = useState<JoinError>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [pendingAction, setPendingAction] = useState<'create' | 'join' | null>(null);
  const [generatedRoomCode, setGeneratedRoomCode] = useState('');
  const [hasAttemptedConnection, setHasAttemptedConnection] = useState(false);

  // Handle connection status changes
  useEffect(() => {
    if (connectionStatus === 'connected' && pendingAction) {
      const code = pendingAction === 'create' ? generatedRoomCode : roomCode.toUpperCase();
      const playerId = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
      const isHost = pendingAction === 'create';

      // Send join_room message to server
      send({
        type: 'join_room',
        roomCode: code,
        playerId,
      });

      // Send player_joined message to room
      const player: Player = {
        id: playerId,
        name: playerName.trim(),
        isHost,
        isConnected: true,
        joinOrder: 0, // Will be assigned by the room
      };

      send({
        type: 'player_joined',
        player,
      });

      setIsConnecting(false);
      setPendingAction(null);
      setHasAttemptedConnection(false);
      onJoined(player, code);
    }

    if (connectionStatus === 'disconnected' && isConnecting && hasAttemptedConnection) {
      setIsConnecting(false);
      setPendingAction(null);
      setHasAttemptedConnection(false);
      setError('connection_failure');
      setErrorMessage('Could not connect to the server. Please check the address and try again.');
    }

    if (connectionStatus === 'connecting' && isConnecting) {
      setHasAttemptedConnection(true);
    }
  }, [connectionStatus, pendingAction, generatedRoomCode, roomCode, playerName, send, onJoined, isConnecting, hasAttemptedConnection]);

  // Handle incoming messages (e.g., error responses from server)
  useEffect(() => {
    if (!lastMessage) return;

    const msg = lastMessage as { type: string };

    if (msg.type === 'room_not_found') {
      setIsConnecting(false);
      setPendingAction(null);
      setError('room_not_found');
      setErrorMessage('Room does not exist. Please check the code and try again.');
    }

    if (msg.type === 'room_full') {
      setIsConnecting(false);
      setPendingAction(null);
      setError('room_full');
      setErrorMessage('This room is full. Please try a different room.');
    }

    if (msg.type === 'duplicate_name') {
      setIsConnecting(false);
      setPendingAction(null);
      setError('duplicate_name');
      setErrorMessage('This name is already taken in the room. Please choose a different name.');
    }
  }, [lastMessage]);

  const validateName = useCallback((): boolean => {
    const result = validatePlayerName(playerName);
    if (!result.valid) {
      setError('invalid_name');
      setErrorMessage(result.message);
      return false;
    }

    // Check for duplicate names locally
    const trimmedName = playerName.trim();
    const isDuplicate = existingPlayerNames.some(
      (name) => name.toLowerCase() === trimmedName.toLowerCase()
    );
    if (isDuplicate) {
      setError('duplicate_name');
      setErrorMessage('This name is already taken in the room. Please choose a different name.');
      return false;
    }

    return true;
  }, [playerName, existingPlayerNames]);

  const handleCreateRoom = useCallback(() => {
    setError(null);
    setErrorMessage('');

    if (!validateName()) return;

    const code = generateRoomCode();
    setGeneratedRoomCode(code);
    setIsConnecting(true);
    setPendingAction('create');
    reconnect();
  }, [validateName, reconnect]);

  const handleJoinRoom = useCallback(() => {
    setError(null);
    setErrorMessage('');

    if (!validateName()) return;

    const codeResult = validateRoomCode(roomCode.toUpperCase());
    if (!codeResult.valid) {
      setError('room_not_found');
      setErrorMessage(codeResult.message);
      return;
    }

    setIsConnecting(true);
    setPendingAction('join');
    reconnect();
  }, [validateName, roomCode, reconnect]);

  const handleRetry = useCallback(() => {
    setError(null);
    setErrorMessage('');
    setIsConnecting(true);

    if (pendingAction === 'create') {
      setPendingAction('create');
    } else {
      setPendingAction('join');
    }
    reconnect();
  }, [pendingAction, reconnect]);

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPlayerName(e.target.value);
    if (error === 'invalid_name' || error === 'duplicate_name') {
      setError(null);
      setErrorMessage('');
    }
  };

  const handleRoomCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setRoomCode(e.target.value.toUpperCase());
    if (error === 'room_not_found') {
      setError(null);
      setErrorMessage('');
    }
  };

  return (
    <div className="join-screen" role="main" aria-label="Join Game">
      <h1>WitBash</h1>

      <div className="join-form">
        <div className="form-field">
          <label htmlFor="player-name">Player Name</label>
          <input
            id="player-name"
            type="text"
            value={playerName}
            onChange={handleNameChange}
            placeholder="Enter your name (1-20 characters)"
            maxLength={20}
            disabled={isConnecting}
            aria-describedby={error === 'invalid_name' || error === 'duplicate_name' ? 'name-error' : undefined}
            aria-invalid={error === 'invalid_name' || error === 'duplicate_name'}
          />
        </div>

        <div className="form-field">
          <label htmlFor="room-code">Room Code</label>
          <input
            id="room-code"
            type="text"
            value={roomCode}
            onChange={handleRoomCodeChange}
            placeholder="Enter 4-character room code"
            maxLength={4}
            disabled={isConnecting}
            aria-describedby={error === 'room_not_found' ? 'room-error' : undefined}
            aria-invalid={error === 'room_not_found'}
          />
        </div>

        <div className="button-group">
          <button
            type="button"
            onClick={handleCreateRoom}
            disabled={isConnecting}
            aria-label="Create a new room"
          >
            {isConnecting && pendingAction === 'create' ? 'Creating...' : 'Create Room'}
          </button>

          <button
            type="button"
            onClick={handleJoinRoom}
            disabled={isConnecting}
            aria-label="Join an existing room"
          >
            {isConnecting && pendingAction === 'join' ? 'Joining...' : 'Join Room'}
          </button>
        </div>

        {errorMessage && (
          <div
            className="error-message"
            role="alert"
            aria-live="assertive"
            id={
              error === 'invalid_name' || error === 'duplicate_name'
                ? 'name-error'
                : error === 'room_not_found'
                ? 'room-error'
                : 'general-error'
            }
          >
            <p>{errorMessage}</p>
            {error === 'connection_failure' && (
              <button
                type="button"
                onClick={handleRetry}
                aria-label="Retry connection"
              >
                Retry
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
