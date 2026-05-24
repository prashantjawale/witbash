import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LobbyScreen } from './LobbyScreen';
import type { LobbyScreenProps } from './LobbyScreen';
import type { Player, GameSettings, GameState } from '../types';

describe('LobbyScreen', () => {
  const defaultSettings: GameSettings = {
    minPlayers: 4,
    maxPlayers: 7,
    answerTimerSeconds: 60,
    votingTimerSeconds: 30,
  };

  const createPlayers = (count: number): Player[] =>
    Array.from({ length: count }, (_, i) => ({
      id: `player-${i + 1}`,
      name: `Player ${i + 1}`,
      isHost: i === 0,
      isConnected: true,
      joinOrder: i + 1,
    }));

  const defaultProps: LobbyScreenProps = {
    roomCode: 'AB12',
    players: createPlayers(4),
    settings: defaultSettings,
    isHost: true,
    onStartGame: vi.fn(),
    onSettingsChange: vi.fn(),
    activeGame: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Room Code Display', () => {
    it('displays the room code', () => {
      render(<LobbyScreen {...defaultProps} />);
      expect(screen.getByText('AB12')).toBeInTheDocument();
    });

    it('displays sharing hint', () => {
      render(<LobbyScreen {...defaultProps} />);
      expect(
        screen.getByText('Share this code with friends to join')
      ).toBeInTheDocument();
    });
  });

  describe('Player List', () => {
    it('displays all connected players', () => {
      render(<LobbyScreen {...defaultProps} />);
      expect(screen.getByText('Player 1')).toBeInTheDocument();
      expect(screen.getByText('Player 2')).toBeInTheDocument();
      expect(screen.getByText('Player 3')).toBeInTheDocument();
      expect(screen.getByText('Player 4')).toBeInTheDocument();
    });

    it('displays players in join order', () => {
      const players = createPlayers(3);
      // Shuffle the array to verify sorting
      const shuffled = [players[2], players[0], players[1]];
      render(<LobbyScreen {...defaultProps} players={shuffled} />);

      const listItems = screen.getAllByRole('listitem');
      expect(listItems[0]).toHaveTextContent('Player 1');
      expect(listItems[1]).toHaveTextContent('Player 2');
      expect(listItems[2]).toHaveTextContent('Player 3');
    });

    it('shows host badge for host player', () => {
      render(<LobbyScreen {...defaultProps} />);
      expect(screen.getByLabelText('Host')).toBeInTheDocument();
    });

    it('shows player count and minimum required', () => {
      render(<LobbyScreen {...defaultProps} />);
      expect(screen.getByText('Players (4 / 4 minimum)')).toBeInTheDocument();
    });

    it('excludes disconnected players from count', () => {
      const players = createPlayers(4);
      players[3].isConnected = false;
      render(<LobbyScreen {...defaultProps} players={players} />);
      expect(screen.getByText('Players (3 / 4 minimum)')).toBeInTheDocument();
    });

    it('does not display disconnected players in the list', () => {
      const players = createPlayers(4);
      players[3].isConnected = false;
      render(<LobbyScreen {...defaultProps} players={players} />);
      expect(screen.queryByText('Player 4')).not.toBeInTheDocument();
    });
  });

  describe('Host Game Settings', () => {
    it('displays settings panel for host', () => {
      render(<LobbyScreen {...defaultProps} isHost={true} />);
      expect(screen.getByLabelText('Minimum Players')).toBeInTheDocument();
      expect(screen.getByLabelText('Maximum Players')).toBeInTheDocument();
      expect(screen.getByLabelText('Answer Timer (seconds)')).toBeInTheDocument();
      expect(screen.getByLabelText('Voting Timer (seconds)')).toBeInTheDocument();
    });

    it('does not display editable settings for non-host', () => {
      render(<LobbyScreen {...defaultProps} isHost={false} />);
      expect(screen.queryByLabelText('Minimum Players')).not.toBeInTheDocument();
    });

    it('displays read-only settings for non-host', () => {
      render(<LobbyScreen {...defaultProps} isHost={false} />);
      expect(screen.getByText('4')).toBeInTheDocument(); // minPlayers
      expect(screen.getByText('7')).toBeInTheDocument(); // maxPlayers
      expect(screen.getByText('60 seconds')).toBeInTheDocument(); // answerTimer
      expect(screen.getByText('30 seconds')).toBeInTheDocument(); // votingTimer
    });

    it('pre-populates settings with default values', () => {
      render(<LobbyScreen {...defaultProps} />);
      expect(screen.getByLabelText('Minimum Players')).toHaveValue(4);
      expect(screen.getByLabelText('Maximum Players')).toHaveValue(7);
      expect(screen.getByLabelText('Answer Timer (seconds)')).toHaveValue(60);
      expect(screen.getByLabelText('Voting Timer (seconds)')).toHaveValue(30);
    });

    it('calls onSettingsChange when valid settings are modified', () => {
      const onSettingsChange = vi.fn();
      render(
        <LobbyScreen {...defaultProps} onSettingsChange={onSettingsChange} />
      );

      fireEvent.change(screen.getByLabelText('Minimum Players'), {
        target: { value: '3' },
      });

      expect(onSettingsChange).toHaveBeenCalledWith({
        ...defaultSettings,
        minPlayers: 3,
      });
    });

    it('shows validation error for invalid min players', () => {
      render(<LobbyScreen {...defaultProps} />);

      fireEvent.change(screen.getByLabelText('Minimum Players'), {
        target: { value: '11' },
      });

      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('does not call onSettingsChange for invalid settings', () => {
      const onSettingsChange = vi.fn();
      render(
        <LobbyScreen {...defaultProps} onSettingsChange={onSettingsChange} />
      );

      fireEvent.change(screen.getByLabelText('Minimum Players'), {
        target: { value: '11' },
      });

      expect(onSettingsChange).not.toHaveBeenCalled();
    });

    it('shows validation error for timer out of range', () => {
      render(<LobbyScreen {...defaultProps} />);

      fireEvent.change(screen.getByLabelText('Answer Timer (seconds)'), {
        target: { value: '5' },
      });

      expect(screen.getByRole('alert')).toHaveTextContent(
        'Answer timer must be between 10 and 300 seconds'
      );
    });

    it('clears error when settings become valid', () => {
      render(<LobbyScreen {...defaultProps} />);

      // Set invalid value
      fireEvent.change(screen.getByLabelText('Answer Timer (seconds)'), {
        target: { value: '5' },
      });
      expect(screen.getByRole('alert')).toBeInTheDocument();

      // Set valid value
      fireEvent.change(screen.getByLabelText('Answer Timer (seconds)'), {
        target: { value: '60' },
      });
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  describe('Start Game Button', () => {
    it('displays Start Game button for host', () => {
      render(<LobbyScreen {...defaultProps} isHost={true} />);
      expect(
        screen.getByRole('button', { name: 'Start Game' })
      ).toBeInTheDocument();
    });

    it('does not display Start Game button for non-host', () => {
      render(<LobbyScreen {...defaultProps} isHost={false} />);
      expect(
        screen.queryByRole('button', { name: 'Start Game' })
      ).not.toBeInTheDocument();
    });

    it('enables Start Game when minimum players met', () => {
      render(<LobbyScreen {...defaultProps} players={createPlayers(4)} />);
      expect(
        screen.getByRole('button', { name: 'Start Game' })
      ).not.toBeDisabled();
    });

    it('disables Start Game when below minimum players', () => {
      render(<LobbyScreen {...defaultProps} players={createPlayers(2)} />);
      expect(
        screen.getByRole('button', { name: 'Start Game' })
      ).toBeDisabled();
    });

    it('shows how many more players needed', () => {
      render(<LobbyScreen {...defaultProps} players={createPlayers(2)} />);
      expect(
        screen.getByText('Need 2 more players to start')
      ).toBeInTheDocument();
    });

    it('shows singular "player" when only 1 more needed', () => {
      render(<LobbyScreen {...defaultProps} players={createPlayers(3)} />);
      expect(
        screen.getByText('Need 1 more player to start')
      ).toBeInTheDocument();
    });

    it('calls onStartGame when clicked with enough players', () => {
      const onStartGame = vi.fn();
      render(
        <LobbyScreen
          {...defaultProps}
          players={createPlayers(4)}
          onStartGame={onStartGame}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Start Game' }));
      expect(onStartGame).toHaveBeenCalledTimes(1);
    });

    it('disables Start Game when settings have validation error', () => {
      render(<LobbyScreen {...defaultProps} players={createPlayers(4)} />);

      // Create invalid settings
      fireEvent.change(screen.getByLabelText('Answer Timer (seconds)'), {
        target: { value: '5' },
      });

      expect(
        screen.getByRole('button', { name: 'Start Game' })
      ).toBeDisabled();
    });
  });

  describe('Mid-Game Lobby (Requirement 9.1, 9.3)', () => {
    const activeGame: GameState = {
      phase: 'answer_phase',
      currentRound: 2,
      totalRounds: 5,
      questions: [0, 1, 2, 3, 4],
      featuredPlayerOrder: ['p1', 'p2', 'p3', 'p4', 'p5'],
      scores: {},
      currentRoundState: {
        questionIndex: 1,
        featuredPlayerId: 'p2',
        questionText: 'Test question',
        answers: {},
        votes: {},
        timerEndTime: 0,
      },
    };

    it('displays game in progress status', () => {
      render(
        <LobbyScreen {...defaultProps} activeGame={activeGame} isHost={false} />
      );
      expect(screen.getByText('Game In Progress')).toBeInTheDocument();
    });

    it('displays current round number and total', () => {
      render(
        <LobbyScreen {...defaultProps} activeGame={activeGame} isHost={false} />
      );
      expect(screen.getByText('Round 2 of 5')).toBeInTheDocument();
    });

    it('displays player count participating', () => {
      render(
        <LobbyScreen
          {...defaultProps}
          activeGame={activeGame}
          players={createPlayers(5)}
          isHost={false}
        />
      );
      expect(screen.getByText('5 players participating')).toBeInTheDocument();
    });

    it('hides settings panel during active game', () => {
      render(
        <LobbyScreen {...defaultProps} activeGame={activeGame} isHost={true} />
      );
      expect(
        screen.queryByLabelText('Minimum Players')
      ).not.toBeInTheDocument();
    });

    it('hides Start Game button during active game', () => {
      render(
        <LobbyScreen {...defaultProps} activeGame={activeGame} isHost={true} />
      );
      expect(
        screen.queryByRole('button', { name: 'Start Game' })
      ).not.toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('has accessible main landmark', () => {
      render(<LobbyScreen {...defaultProps} />);
      expect(
        screen.getByRole('main', { name: 'Game Lobby' })
      ).toBeInTheDocument();
    });

    it('has accessible player list', () => {
      render(<LobbyScreen {...defaultProps} />);
      expect(screen.getByRole('list', { name: 'Player list' })).toBeInTheDocument();
    });

    it('settings error is announced via aria-live', () => {
      render(<LobbyScreen {...defaultProps} />);

      fireEvent.change(screen.getByLabelText('Answer Timer (seconds)'), {
        target: { value: '5' },
      });

      const alert = screen.getByRole('alert');
      expect(alert).toHaveAttribute('aria-live', 'assertive');
    });
  });
});
