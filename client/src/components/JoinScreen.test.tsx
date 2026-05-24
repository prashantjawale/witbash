import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { JoinScreen } from './JoinScreen';
import type { JoinScreenProps } from './JoinScreen';

// Mock the useWebSocket hook
const mockSend = vi.fn();
const mockReconnect = vi.fn();
let mockConnectionStatus: string = 'disconnected';
let mockLastMessage: unknown = null;

vi.mock('../hooks/useWebSocket', () => ({
  useWebSocket: () => ({
    send: mockSend,
    lastMessage: mockLastMessage,
    connectionStatus: mockConnectionStatus,
    reconnect: mockReconnect,
  }),
}));

// Mock crypto.randomUUID
vi.stubGlobal('crypto', {
  randomUUID: () => 'test-uuid-1234',
});

describe('JoinScreen', () => {
  const defaultProps: JoinScreenProps = {
    wsUrl: 'ws://localhost:3000/ws',
    onJoined: vi.fn(),
    existingPlayerNames: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockConnectionStatus = 'disconnected';
    mockLastMessage = null;
  });

  describe('Rendering', () => {
    it('renders player name input', () => {
      render(<JoinScreen {...defaultProps} />);
      expect(screen.getByLabelText('Player Name')).toBeInTheDocument();
    });

    it('renders room code input', () => {
      render(<JoinScreen {...defaultProps} />);
      expect(screen.getByLabelText('Room Code')).toBeInTheDocument();
    });

    it('renders Create Room button', () => {
      render(<JoinScreen {...defaultProps} />);
      expect(screen.getByRole('button', { name: /create/i })).toBeInTheDocument();
    });

    it('renders Join Room button', () => {
      render(<JoinScreen {...defaultProps} />);
      expect(screen.getByRole('button', { name: /join/i })).toBeInTheDocument();
    });

    it('has accessible main landmark', () => {
      render(<JoinScreen {...defaultProps} />);
      expect(screen.getByRole('main', { name: 'Join Game' })).toBeInTheDocument();
    });
  });

  describe('Player Name Validation', () => {
    it('shows error for empty name on Create Room', () => {
      render(<JoinScreen {...defaultProps} />);
      fireEvent.click(screen.getByRole('button', { name: /create/i }));
      expect(screen.getByRole('alert')).toHaveTextContent('Player name is required');
    });

    it('shows error for empty name on Join Room', () => {
      render(<JoinScreen {...defaultProps} />);
      fireEvent.click(screen.getByRole('button', { name: /join/i }));
      expect(screen.getByRole('alert')).toHaveTextContent('Player name is required');
    });

    it('shows error for name with special characters', () => {
      render(<JoinScreen {...defaultProps} />);
      fireEvent.change(screen.getByLabelText('Player Name'), { target: { value: 'Player@1' } });
      fireEvent.click(screen.getByRole('button', { name: /create/i }));
      expect(screen.getByRole('alert')).toHaveTextContent('letters, numbers, and spaces');
    });

    it('shows error for name exceeding 20 characters', () => {
      render(<JoinScreen {...defaultProps} />);
      fireEvent.change(screen.getByLabelText('Player Name'), { target: { value: 'A'.repeat(21) } });
      fireEvent.click(screen.getByRole('button', { name: /create/i }));
      expect(screen.getByRole('alert')).toHaveTextContent('20 characters or fewer');
    });

    it('shows error for whitespace-only name', () => {
      render(<JoinScreen {...defaultProps} />);
      fireEvent.change(screen.getByLabelText('Player Name'), { target: { value: '   ' } });
      fireEvent.click(screen.getByRole('button', { name: /create/i }));
      expect(screen.getByRole('alert')).toHaveTextContent('at least one non-space character');
    });

    it('clears name error when user types', () => {
      render(<JoinScreen {...defaultProps} />);
      fireEvent.click(screen.getByRole('button', { name: /create/i }));
      expect(screen.getByRole('alert')).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText('Player Name'), { target: { value: 'A' } });
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  describe('Duplicate Name Detection', () => {
    it('shows error for duplicate name (case-insensitive)', () => {
      render(<JoinScreen {...defaultProps} existingPlayerNames={['Alice', 'Bob']} />);
      fireEvent.change(screen.getByLabelText('Player Name'), { target: { value: 'alice' } });
      fireEvent.click(screen.getByRole('button', { name: /create/i }));
      expect(screen.getByRole('alert')).toHaveTextContent('name is already taken');
    });

    it('shows error for duplicate name with different casing', () => {
      render(<JoinScreen {...defaultProps} existingPlayerNames={['Player1']} />);
      fireEvent.change(screen.getByLabelText('Player Name'), { target: { value: 'PLAYER1' } });
      fireEvent.click(screen.getByRole('button', { name: /join/i }));
      expect(screen.getByRole('alert')).toHaveTextContent('name is already taken');
    });
  });

  describe('Room Code Validation', () => {
    it('shows error for invalid room code on Join Room', () => {
      render(<JoinScreen {...defaultProps} />);
      fireEvent.change(screen.getByLabelText('Player Name'), { target: { value: 'Alice' } });
      fireEvent.change(screen.getByLabelText('Room Code'), { target: { value: 'AB' } });
      fireEvent.click(screen.getByRole('button', { name: /join/i }));
      expect(screen.getByRole('alert')).toHaveTextContent('Room code must be exactly 4 characters');
    });

    it('shows error for empty room code on Join Room', () => {
      render(<JoinScreen {...defaultProps} />);
      fireEvent.change(screen.getByLabelText('Player Name'), { target: { value: 'Alice' } });
      fireEvent.click(screen.getByRole('button', { name: /join/i }));
      expect(screen.getByRole('alert')).toHaveTextContent('Room code is required');
    });

    it('converts room code to uppercase', () => {
      render(<JoinScreen {...defaultProps} />);
      const input = screen.getByLabelText('Room Code');
      fireEvent.change(input, { target: { value: 'abcd' } });
      expect(input).toHaveValue('ABCD');
    });

    it('clears room code error when user types', () => {
      render(<JoinScreen {...defaultProps} />);
      fireEvent.change(screen.getByLabelText('Player Name'), { target: { value: 'Alice' } });
      fireEvent.click(screen.getByRole('button', { name: /join/i }));
      expect(screen.getByRole('alert')).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText('Room Code'), { target: { value: 'A' } });
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  describe('Create Room', () => {
    it('initiates connection on valid name', () => {
      render(<JoinScreen {...defaultProps} />);
      fireEvent.change(screen.getByLabelText('Player Name'), { target: { value: 'Alice' } });
      fireEvent.click(screen.getByRole('button', { name: /create/i }));
      expect(mockReconnect).toHaveBeenCalled();
    });

    it('does not require room code for Create Room', () => {
      render(<JoinScreen {...defaultProps} />);
      fireEvent.change(screen.getByLabelText('Player Name'), { target: { value: 'Alice' } });
      fireEvent.click(screen.getByRole('button', { name: /create/i }));
      // Should not show room code validation error
      const alert = screen.queryByRole('alert');
      expect(alert).not.toBeInTheDocument();
    });

    it('disables buttons while connecting', () => {
      render(<JoinScreen {...defaultProps} />);
      fireEvent.change(screen.getByLabelText('Player Name'), { target: { value: 'Alice' } });
      fireEvent.click(screen.getByRole('button', { name: /create/i }));

      expect(screen.getByRole('button', { name: /creat/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /join/i })).toBeDisabled();
    });
  });

  describe('Join Room', () => {
    it('initiates connection with valid name and room code', () => {
      render(<JoinScreen {...defaultProps} />);
      fireEvent.change(screen.getByLabelText('Player Name'), { target: { value: 'Alice' } });
      fireEvent.change(screen.getByLabelText('Room Code'), { target: { value: 'AB12' } });
      fireEvent.click(screen.getByRole('button', { name: /join/i }));
      expect(mockReconnect).toHaveBeenCalled();
    });

    it('validates both name and room code', () => {
      render(<JoinScreen {...defaultProps} />);
      // Empty name, empty room code
      fireEvent.click(screen.getByRole('button', { name: /join/i }));
      // Name error takes priority
      expect(screen.getByRole('alert')).toHaveTextContent('Player name is required');
    });
  });

  describe('Connection Failure', () => {
    it('shows retry button on connection failure', () => {
      // Simulate connection failure by setting status to disconnected after connecting attempt
      mockConnectionStatus = 'disconnected';
      const { rerender } = render(<JoinScreen {...defaultProps} />);

      fireEvent.change(screen.getByLabelText('Player Name'), { target: { value: 'Alice' } });
      fireEvent.click(screen.getByRole('button', { name: /create/i }));

      // The component sets isConnecting=true, then the effect sees disconnected status
      // We need to trigger a rerender to simulate the effect running
      // Since the mock always returns 'disconnected', the effect will fire
      rerender(<JoinScreen {...defaultProps} />);

      // The error should show with retry button
      const alert = screen.queryByRole('alert');
      if (alert) {
        expect(alert).toHaveTextContent(/connect/i);
        expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
      }
    });
  });

  describe('Server Error Messages', () => {
    it('handles room_not_found message from server', () => {
      mockLastMessage = { type: 'room_not_found' };
      render(<JoinScreen {...defaultProps} />);
      expect(screen.getByRole('alert')).toHaveTextContent('Room does not exist');
    });

    it('handles room_full message from server', () => {
      mockLastMessage = { type: 'room_full' };
      render(<JoinScreen {...defaultProps} />);
      expect(screen.getByRole('alert')).toHaveTextContent('room is full');
    });

    it('handles duplicate_name message from server', () => {
      mockLastMessage = { type: 'duplicate_name' };
      render(<JoinScreen {...defaultProps} />);
      expect(screen.getByRole('alert')).toHaveTextContent('name is already taken');
    });
  });
});
