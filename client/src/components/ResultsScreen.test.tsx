import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ResultsScreen } from './ResultsScreen';
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
    phase: 'score_reveal',
    currentRound: 1,
    totalRounds: 4,
    questions: [0, 1, 2, 3],
    featuredPlayerOrder: ['p1', 'p2', 'p3', 'p4'],
    scores: { p1: 0, p2: 2, p3: 1, p4: 0 },
    currentRoundState: {
      questionIndex: 0,
      featuredPlayerId: 'p1',
      questionText: 'What would Alice bring to a deserted island?',
      answers: {
        p2: 'A rubber duck',
        p3: 'A library of books',
        p4: 'A solar-powered phone',
      },
      votes: {
        p1: 'p2',
        p3: 'p2',
        p4: 'p3',
      },
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

describe('ResultsScreen', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reveals author of each answer with vote count', () => {
    const state = createTestState();
    renderWithProvider(
      <ResultsScreen playerId="p1" minimumDisplaySeconds={10} />,
      state
    );

    // Authors should be revealed
    expect(screen.getByText('— Bob')).toBeInTheDocument();
    expect(screen.getByText('— Charlie')).toBeInTheDocument();
    expect(screen.getByText('— Diana')).toBeInTheDocument();

    // Answers should be visible (with quotes)
    expect(screen.getByText(/A rubber duck/)).toBeInTheDocument();
    expect(screen.getByText(/A library of books/)).toBeInTheDocument();
    expect(screen.getByText(/A solar-powered phone/)).toBeInTheDocument();

    // Vote counts should be displayed
    expect(screen.getByLabelText("2 votes")).toHaveTextContent('2 votes');
    expect(screen.getByLabelText("1 votes")).toHaveTextContent('1 vote');
    expect(screen.getByLabelText("0 votes")).toHaveTextContent('0 votes');
  });

  it('displays points earned per player for the round', () => {
    const state = createTestState();
    renderWithProvider(
      <ResultsScreen playerId="p1" minimumDisplaySeconds={10} />,
      state
    );

    // Points earned should be displayed
    expect(screen.getByLabelText("2 points earned")).toHaveTextContent('+2 points');
    expect(screen.getByLabelText("1 points earned")).toHaveTextContent('+1 point');
    expect(screen.getByLabelText("0 points earned")).toHaveTextContent('+0 points');
  });

  it('displays leaderboard sorted by cumulative score descending', () => {
    const state = createTestState();
    renderWithProvider(
      <ResultsScreen playerId="p1" minimumDisplaySeconds={10} />,
      state
    );

    const leaderboardEntries = screen.getAllByRole('listitem', { name: /Rank/ });
    expect(leaderboardEntries).toHaveLength(4);

    // Bob (2 pts) should be first
    expect(leaderboardEntries[0]).toHaveTextContent('Bob');
    expect(leaderboardEntries[0]).toHaveTextContent('2 pts');

    // Charlie (1 pt) should be second
    expect(leaderboardEntries[1]).toHaveTextContent('Charlie');
    expect(leaderboardEntries[1]).toHaveTextContent('1 pts');
  });

  it('breaks ties by join order (ascending)', () => {
    // Alice (joinOrder 1) and Diana (joinOrder 4) both have 0 points
    const state = createTestState();
    renderWithProvider(
      <ResultsScreen playerId="p1" minimumDisplaySeconds={10} />,
      state
    );

    const leaderboardEntries = screen.getAllByRole('listitem', { name: /Rank/ });

    // Alice (joinOrder 1) should come before Diana (joinOrder 4) when tied
    expect(leaderboardEntries[2]).toHaveTextContent('Alice');
    expect(leaderboardEntries[3]).toHaveTextContent('Diana');
  });

  it('disables Next Round button for minimum 10 seconds', () => {
    const state = createTestState();
    renderWithProvider(
      <ResultsScreen playerId="p1" minimumDisplaySeconds={10} />,
      state
    );

    const proceedBtn = screen.getByRole('button', { name: 'Next round' });
    expect(proceedBtn).toBeDisabled();

    // Advance 5 seconds — still disabled
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(proceedBtn).toBeDisabled();
  });

  it('enables Next Round button after minimum display time', () => {
    const state = createTestState();
    renderWithProvider(
      <ResultsScreen playerId="p1" minimumDisplaySeconds={10} />,
      state
    );

    const proceedBtn = screen.getByRole('button', { name: 'Next round' });
    expect(proceedBtn).toBeDisabled();

    // Advance past 10 seconds
    act(() => {
      vi.advanceTimersByTime(10500);
    });

    expect(proceedBtn).not.toBeDisabled();
  });

  it('calls onNextRound when host clicks Next Round', () => {
    const onNextRound = vi.fn();
    const state = createTestState();
    renderWithProvider(
      <ResultsScreen playerId="p1" minimumDisplaySeconds={10} onNextRound={onNextRound} />,
      state
    );

    // Enable the button
    act(() => {
      vi.advanceTimersByTime(10500);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Next round' }));
    expect(onNextRound).toHaveBeenCalledTimes(1);
  });

  it('calls onGameEnd on final round', () => {
    const onGameEnd = vi.fn();
    const state = createTestState({
      game: {
        phase: 'score_reveal',
        currentRound: 4,
        totalRounds: 4,
        questions: [0, 1, 2, 3],
        featuredPlayerOrder: ['p1', 'p2', 'p3', 'p4'],
        scores: { p1: 3, p2: 5, p3: 2, p4: 4 },
        currentRoundState: {
          questionIndex: 3,
          featuredPlayerId: 'p4',
          questionText: 'What would Diana do?',
          answers: { p1: 'Dance', p2: 'Sing', p3: 'Sleep' },
          votes: { p2: 'p1', p3: 'p1', p4: 'p2' },
          timerEndTime: 0,
        },
      },
    });

    renderWithProvider(
      <ResultsScreen playerId="p1" minimumDisplaySeconds={10} onGameEnd={onGameEnd} />,
      state
    );

    // Button should say "End Game" on final round
    const endBtn = screen.getByRole('button', { name: 'End game' });
    expect(endBtn).toBeInTheDocument();

    // Enable and click
    act(() => {
      vi.advanceTimersByTime(10500);
    });

    fireEvent.click(endBtn);
    expect(onGameEnd).toHaveBeenCalledTimes(1);
  });

  it('does not show proceed button for non-host players', () => {
    const state = createTestState();
    renderWithProvider(
      <ResultsScreen playerId="p2" minimumDisplaySeconds={10} />,
      state
    );

    expect(screen.queryByRole('button', { name: 'Next round' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'End game' })).not.toBeInTheDocument();
  });

  it('shows round progress information', () => {
    const state = createTestState();
    renderWithProvider(
      <ResultsScreen playerId="p1" minimumDisplaySeconds={10} />,
      state
    );

    expect(screen.getByLabelText('Round progress')).toHaveTextContent('Round 1 of 4');
  });

  it('shows countdown timer while waiting', () => {
    const state = createTestState();
    renderWithProvider(
      <ResultsScreen playerId="p1" minimumDisplaySeconds={10} />,
      state
    );

    expect(screen.getByLabelText('Results timer')).toHaveTextContent('10s');
  });

  it('hides timer after minimum display time elapses', () => {
    const state = createTestState();
    renderWithProvider(
      <ResultsScreen playerId="p1" minimumDisplaySeconds={10} />,
      state
    );

    act(() => {
      vi.advanceTimersByTime(10500);
    });

    expect(screen.queryByLabelText('Results timer')).not.toBeInTheDocument();
  });
});
