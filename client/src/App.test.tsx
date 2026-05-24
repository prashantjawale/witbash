import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from './App';

// Mock useWebSocket to avoid real WebSocket connections
vi.mock('./hooks/useWebSocket', () => ({
  useWebSocket: () => ({
    send: vi.fn(),
    lastMessage: null,
    connectionStatus: 'disconnected' as const,
    reconnect: vi.fn(),
  }),
}));

// Mock useConsensus to avoid async hash computation
vi.mock('./hooks/useConsensus', () => ({
  useConsensus: () => ({
    broadcastHash: vi.fn(),
    consensusStatus: 'pending' as const,
  }),
}));

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    render(<App />);
    // The JoinScreen should be rendered by default (not joined yet)
    expect(document.body).toBeTruthy();
  });

  it('renders JoinScreen when not joined', () => {
    render(<App />);
    // JoinScreen has a form with player name and room code inputs
    expect(screen.getByLabelText(/player name/i)).toBeTruthy();
  });

  it('wraps content in GameProvider (no useGame error)', () => {
    // If GameProvider is missing, useGame would throw
    expect(() => render(<App />)).not.toThrow();
  });

  it('does not show ErrorOverlay when there are no errors', () => {
    render(<App />);
    expect(screen.queryByTestId('error-overlay')).toBeNull();
  });
});
