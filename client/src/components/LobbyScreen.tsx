import { useState, useCallback, useEffect } from 'react';
import { validateGameSettings } from '../utils/validation';
import type { Player, GameSettings, GameState } from '../types';

// ============================================================
// Types
// ============================================================

export interface LobbyScreenProps {
  /** The room code to display for sharing */
  roomCode: string;
  /** List of players in the room */
  players: Player[];
  /** Current game settings */
  settings: GameSettings;
  /** Whether the current player is the host */
  isHost: boolean;
  /** Callback when host starts the game */
  onStartGame: () => void;
  /** Callback when host changes settings */
  onSettingsChange: (settings: GameSettings) => void;
  /** Active game state (non-null if a game is in progress and this player is in lobby) */
  activeGame?: GameState | null;
}

// ============================================================
// Component
// ============================================================

export function LobbyScreen({
  roomCode,
  players,
  settings,
  isHost,
  onStartGame,
  onSettingsChange,
  activeGame = null,
}: LobbyScreenProps) {
  const [localSettings, setLocalSettings] = useState<GameSettings>(settings);
  const [settingsError, setSettingsError] = useState('');

  // Sync local settings when props change (e.g., from broadcast)
  useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  const connectedPlayers = players.filter((p) => p.isConnected);
  const playerCount = connectedPlayers.length;
  const canStart = playerCount >= localSettings.minPlayers;

  const handleSettingChange = useCallback(
    (field: keyof GameSettings, value: string) => {
      const numValue = parseInt(value, 10);
      if (isNaN(numValue)) return;

      const newSettings: GameSettings = {
        ...localSettings,
        [field]: numValue,
      };

      setLocalSettings(newSettings);

      const result = validateGameSettings(newSettings);
      if (!result.valid) {
        setSettingsError(result.message);
      } else {
        setSettingsError('');
        onSettingsChange(newSettings);
      }
    },
    [localSettings, onSettingsChange]
  );

  const handleStartGame = useCallback(() => {
    if (!canStart) return;
    const result = validateGameSettings(localSettings);
    if (!result.valid) {
      setSettingsError(result.message);
      return;
    }
    onStartGame();
  }, [canStart, localSettings, onStartGame]);

  // Sort players by join order for display
  const sortedPlayers = [...connectedPlayers].sort(
    (a, b) => a.joinOrder - b.joinOrder
  );

  return (
    <div className="lobby-screen" role="main" aria-label="Game Lobby">
      <h1>Game Lobby</h1>

      {/* Room Code Display */}
      <section aria-label="Room Code">
        <h2>Room Code</h2>
        <p className="room-code" aria-live="polite">
          {roomCode}
        </p>
        <p className="room-code-hint">Share this code with friends to join</p>
      </section>

      {/* Mid-game status for lobby players */}
      {activeGame && (
        <section aria-label="Game Status" className="game-status">
          <h2>Game In Progress</h2>
          <p>
            Round {activeGame.currentRound} of {activeGame.totalRounds}
          </p>
          <p>
            {players.filter((p) => p.isConnected).length} players participating
          </p>
        </section>
      )}

      {/* Player List */}
      <section aria-label="Connected Players">
        <h2>
          Players ({playerCount}
          {!activeGame && ` / ${localSettings.minPlayers} minimum`})
        </h2>
        <ol className="player-list" aria-label="Player list">
          {sortedPlayers.map((player) => (
            <li key={player.id} className="player-item">
              <span className="player-name">{player.name}</span>
              {player.isHost && (
                <span className="host-badge" aria-label="Host">
                  Host
                </span>
              )}
            </li>
          ))}
        </ol>
      </section>

      {/* Host-only: Game Settings */}
      {isHost && !activeGame && (
        <section aria-label="Game Settings" className="settings-panel">
          <h2>Game Settings</h2>

          <div className="form-field">
            <label htmlFor="min-players">Minimum Players</label>
            <input
              id="min-players"
              type="number"
              min={3}
              max={localSettings.maxPlayers}
              value={localSettings.minPlayers}
              onChange={(e) => handleSettingChange('minPlayers', e.target.value)}
              aria-describedby={settingsError ? 'settings-error' : undefined}
            />
          </div>

          <div className="form-field">
            <label htmlFor="max-players">Maximum Players</label>
            <input
              id="max-players"
              type="number"
              min={localSettings.minPlayers}
              max={10}
              value={localSettings.maxPlayers}
              onChange={(e) => handleSettingChange('maxPlayers', e.target.value)}
              aria-describedby={settingsError ? 'settings-error' : undefined}
            />
          </div>

          <div className="form-field">
            <label htmlFor="answer-timer">Answer Timer (seconds)</label>
            <input
              id="answer-timer"
              type="number"
              min={10}
              max={300}
              value={localSettings.answerTimerSeconds}
              onChange={(e) =>
                handleSettingChange('answerTimerSeconds', e.target.value)
              }
              aria-describedby={settingsError ? 'settings-error' : undefined}
            />
          </div>

          <div className="form-field">
            <label htmlFor="voting-timer">Voting Timer (seconds)</label>
            <input
              id="voting-timer"
              type="number"
              min={10}
              max={300}
              value={localSettings.votingTimerSeconds}
              onChange={(e) =>
                handleSettingChange('votingTimerSeconds', e.target.value)
              }
              aria-describedby={settingsError ? 'settings-error' : undefined}
            />
          </div>

          {settingsError && (
            <div
              className="error-message"
              role="alert"
              aria-live="assertive"
              id="settings-error"
            >
              <p>{settingsError}</p>
            </div>
          )}
        </section>
      )}

      {/* Non-host: Display current settings */}
      {!isHost && !activeGame && (
        <section aria-label="Game Settings" className="settings-display">
          <h2>Game Settings</h2>
          <dl>
            <dt>Minimum Players</dt>
            <dd>{settings.minPlayers}</dd>
            <dt>Maximum Players</dt>
            <dd>{settings.maxPlayers}</dd>
            <dt>Answer Timer</dt>
            <dd>{settings.answerTimerSeconds} seconds</dd>
            <dt>Voting Timer</dt>
            <dd>{settings.votingTimerSeconds} seconds</dd>
          </dl>
        </section>
      )}

      {/* Host-only: Start Game button */}
      {isHost && !activeGame && (
        <div className="start-game-section">
          <button
            type="button"
            onClick={handleStartGame}
            disabled={!canStart || !!settingsError}
            aria-label="Start Game"
          >
            Start Game
          </button>
          {!canStart && (
            <p className="start-game-hint" aria-live="polite">
              Need {localSettings.minPlayers - playerCount} more player
              {localSettings.minPlayers - playerCount !== 1 ? 's' : ''} to start
            </p>
          )}
        </div>
      )}
    </div>
  );
}
