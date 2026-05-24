import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { FinalLeaderboard } from './FinalLeaderboard';
import { GameProvider, AppState } from '../context/GameContext';
import type { GameState, Player } from '../types';

function createTestState(overrides?: Partial<{
  players: Player[];
  game: GameState | null;
}>): AppState {
  const players: Player[] = overrides?.players ?? [
    { id: 'p1', name: 'Alice', isHost: true, isConnected: true, joinOrder: 1 },
    { id: 'p2', name: 'Bob', isHost: false, isConnected: true, joinOrder: 2 },
    { id: 'p3', name: 'Charlie', isHost: false, isConnected: true, joinOrder: 3 },
    { id: 'p4', name: 'Diana', isHost: false, isConnected: true, joinOrder: 4 },
  ];

  const game: GameState | null = overrides?.game !== undefined ? overrides.game : {
    phase: 'game_end',
    currentRound: 4,
    totalRounds: 4,
    questions: [0, 1, 2, 3],
    featuredPlayerOrder: ['p1', 'p2', 'p3', 'p4'],
    scores: { p1: 5, p2: 3, p3: 5, p4: 1 },
    currentRoundState: {
      questionIndex: 3,
      featuredPlayerId: 'p4',
      questionText: 'What would Diana do?',
      answers: {},
      votes: {},
      timerEndTime: 0,
    },
  };

  return {
    roomCode: 'ABCD',
    players,
    settings: {
      minPlayers: 4,
      maxPlayers: 7,
      answerTimerSeconds: 60,
      votingTimerSeconds: 30,
    },
    game,
  };
}

function renderWithProvider(ui: React.ReactElement, state: AppState) {
  return render(
    <GameProvider initialState={state}>{ui}</GameProvider>
  );
}

describe('FinalLeaderboard', () => {
  it('displays final rankings with cumulative scores', () => {
    const state = createTestState();
    renderWithProvider(
      <FinalLeaderboard onPlayAgain={vi.fn()} />,
      state
    );

    expect(screen.getByText('Game Over!')).toBeInTheDocument();
    expect(screen.getByText('Final Rankings')).toBeInTheDocument();

    // All players should be listed
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('Charlie')).toBeInTheDocument();
    expect(screen.getByText('Diana')).toBeInTheDocument();

    // Scores should be displayed (Alice and Charlie both have 5 pts)
    expect(screen.getAllByText('5 pts')).toHaveLength(2);
    expect(screen.getByText('3 pts')).toBeInTheDocument();
    expect(screen.getByText('1 pts')).toBeInTheDocument();
  });

  it('ranks players in descending order by score', () => {
    const state = createTestState({
      players: [
        { id: 'p1', name: 'Alice', isHost: true, isConnected: true, joinOrder: 1 },
        { id: 'p2', name: 'Bob', isHost: false, isConnected: true, joinOrder: 2 },
        { id: 'p3', name: 'Charlie', isHost: false, isConnected: true, joinOrder: 3 },
      ],
      game: {
        phase: 'game_end',
        currentRound: 3,
        totalRounds: 3,
        questions: [0, 1, 2],
        featuredPlayerOrder: ['p1', 'p2', 'p3'],
        scores: { p1: 2, p2: 5, p3: 3 },
        currentRoundState: {
          questionIndex: 2,
          featuredPlayerId: 'p3',
          questionText: 'Question?',
          answers: {},
          votes: {},
          timerEndTime: 0,
        },
      },
    });

    renderWithProvider(
      <FinalLeaderboard onPlayAgain={vi.fn()} />,
      state
    );

    const entries = screen.getAllByRole('listitem');
    // Bob (5) should be first, Charlie (3) second, Alice (2) third
    expect(entries[0]).toHaveTextContent('Bob');
    expect(entries[0]).toHaveTextContent('5 pts');
    expect(entries[1]).toHaveTextContent('Charlie');
    expect(entries[1]).toHaveTextContent('3 pts');
    expect(entries[2]).toHaveTextContent('Alice');
    expect(entries[2]).toHaveTextContent('2 pts');
  });

  it('shows tied players in join order (ascending)', () => {
    // Alice (joinOrder 1) and Charlie (joinOrder 3) both have 5 points
    // Alice should appear before Charlie in the tie
    const state = createTestState();
    renderWithProvider(
      <FinalLeaderboard onPlayAgain={vi.fn()} />,
      state
    );

    const entries = screen.getAllByRole('listitem');
    // Alice (5, joinOrder 1) and Charlie (5, joinOrder 3) are tied
    // Alice should come first due to lower joinOrder
    expect(entries[0]).toHaveTextContent('Alice');
    expect(entries[1]).toHaveTextContent('Charlie');
    // Both should have rank 1
    expect(entries[0]).toHaveTextContent('#1');
    expect(entries[1]).toHaveTextContent('#1');
  });

  it('calls onPlayAgain when Play Again button is clicked', () => {
    const onPlayAgain = vi.fn();
    const state = createTestState();
    renderWithProvider(
      <FinalLeaderboard onPlayAgain={onPlayAgain} />,
      state
    );

    const playAgainBtn = screen.getByRole('button', { name: 'Play Again' });
    expect(playAgainBtn).toBeInTheDocument();

    fireEvent.click(playAgainBtn);
    expect(onPlayAgain).toHaveBeenCalledTimes(1);
  });

  it('handles game with no scores (all zeros)', () => {
    const state = createTestState({
      game: {
        phase: 'game_end',
        currentRound: 4,
        totalRounds: 4,
        questions: [0, 1, 2, 3],
        featuredPlayerOrder: ['p1', 'p2', 'p3', 'p4'],
        scores: { p1: 0, p2: 0, p3: 0, p4: 0 },
        currentRoundState: {
          questionIndex: 3,
          featuredPlayerId: 'p4',
          questionText: 'Question?',
          answers: {},
          votes: {},
          timerEndTime: 0,
        },
      },
    });

    renderWithProvider(
      <FinalLeaderboard onPlayAgain={vi.fn()} />,
      state
    );

    // All players should have 0 pts and rank 1 (all tied)
    const entries = screen.getAllByRole('listitem');
    expect(entries).toHaveLength(4);
    entries.forEach((entry) => {
      expect(entry).toHaveTextContent('0 pts');
      expect(entry).toHaveTextContent('#1');
    });
  });

  it('handles null game state gracefully', () => {
    const state = createTestState({ game: null });
    renderWithProvider(
      <FinalLeaderboard onPlayAgain={vi.fn()} />,
      state
    );

    // Should still render without crashing
    expect(screen.getByText('Game Over!')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Play Again' })).toBeInTheDocument();
  });

  it('includes disconnected players in the leaderboard', () => {
    const state = createTestState({
      players: [
        { id: 'p1', name: 'Alice', isHost: true, isConnected: true, joinOrder: 1 },
        { id: 'p2', name: 'Bob', isHost: false, isConnected: false, joinOrder: 2 },
        { id: 'p3', name: 'Charlie', isHost: false, isConnected: true, joinOrder: 3 },
      ],
      game: {
        phase: 'game_end',
        currentRound: 3,
        totalRounds: 3,
        questions: [0, 1, 2],
        featuredPlayerOrder: ['p1', 'p2', 'p3'],
        scores: { p1: 2, p2: 4, p3: 1 },
        currentRoundState: {
          questionIndex: 2,
          featuredPlayerId: 'p3',
          questionText: 'Question?',
          answers: {},
          votes: {},
          timerEndTime: 0,
        },
      },
    });

    renderWithProvider(
      <FinalLeaderboard onPlayAgain={vi.fn()} />,
      state
    );

    // Bob (disconnected) should still appear with their score
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('4 pts')).toBeInTheDocument();
  });

  it('has proper accessibility attributes', () => {
    const state = createTestState();
    renderWithProvider(
      <FinalLeaderboard onPlayAgain={vi.fn()} />,
      state
    );

    expect(screen.getByRole('main', { name: 'Final Leaderboard' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Leaderboard' })).toBeInTheDocument();
  });
});
