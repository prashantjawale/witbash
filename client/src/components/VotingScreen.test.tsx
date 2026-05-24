import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VotingScreen } from './VotingScreen';
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
    phase: 'voting_phase',
    currentRound: 1,
    totalRounds: 4,
    questions: [0, 1, 2, 3],
    featuredPlayerOrder: ['p1', 'p2', 'p3', 'p4'],
    scores: { p1: 0, p2: 0, p3: 0, p4: 0 },
    currentRoundState: {
      questionIndex: 0,
      featuredPlayerId: 'p1',
      questionText: 'What would Alice bring to a deserted island?',
      answers: {
        p2: 'A rubber duck',
        p3: 'A library of books',
        p4: 'A solar-powered phone',
      },
      votes: {},
      timerEndTime: Date.now() + 30000,
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

describe('VotingScreen', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('displays all submitted answers without authorship', () => {
    const state = createTestState();
    renderWithProvider(
      <VotingScreen playerId="p1" votingTimerSeconds={30} />,
      state
    );

    // All answer texts should be visible
    expect(screen.getByText('A rubber duck')).toBeInTheDocument();
    expect(screen.getByText('A library of books')).toBeInTheDocument();
    expect(screen.getByText('A solar-powered phone')).toBeInTheDocument();

    // No player names should be visible in the answer list
    const answerList = screen.getByRole('list', { name: 'Answer options' });
    expect(answerList.textContent).not.toContain('Bob');
    expect(answerList.textContent).not.toContain('Charlie');
    expect(answerList.textContent).not.toContain('Diana');
  });

  it('disables own answer as voting option (self-vote prevention)', () => {
    const state = createTestState();
    // p2 submitted "A rubber duck" — render as p2
    renderWithProvider(
      <VotingScreen playerId="p2" votingTimerSeconds={30} />,
      state
    );

    // The button for p2's own answer should be disabled
    const ownAnswerBtn = screen.getByLabelText('Your answer (cannot vote for own answer)');
    expect(ownAnswerBtn).toBeDisabled();
  });

  it('allows selecting and confirming a vote', () => {
    const onVoteCast = vi.fn();
    const state = createTestState();
    renderWithProvider(
      <VotingScreen playerId="p1" votingTimerSeconds={30} onVoteCast={onVoteCast} />,
      state
    );

    // Select an answer
    const answerBtn = screen.getByText('A rubber duck').closest('button')!;
    fireEvent.click(answerBtn);

    // Confirm button should appear
    const confirmBtn = screen.getByLabelText('Confirm vote');
    expect(confirmBtn).toBeInTheDocument();

    // Confirm the vote
    fireEvent.click(confirmBtn);

    // Callback should be called
    expect(onVoteCast).toHaveBeenCalledWith('p1', 'p2');

    // Confirmation message should appear
    expect(screen.getByText('Your vote has been recorded!')).toBeInTheDocument();
  });

  it('prevents voting more than once', () => {
    const onVoteCast = vi.fn();
    const state = createTestState();
    renderWithProvider(
      <VotingScreen playerId="p1" votingTimerSeconds={30} onVoteCast={onVoteCast} />,
      state
    );

    // Vote for first answer
    const answerBtn = screen.getByText('A rubber duck').closest('button')!;
    fireEvent.click(answerBtn);
    fireEvent.click(screen.getByLabelText('Confirm vote'));

    expect(onVoteCast).toHaveBeenCalledTimes(1);

    // Try to vote again — all answer buttons should be disabled
    const allButtons = screen.getAllByRole('listitem');
    allButtons.forEach((btn) => {
      expect(btn).toBeDisabled();
    });
  });

  it('displays voting countdown timer', () => {
    const state = createTestState();
    renderWithProvider(
      <VotingScreen playerId="p1" votingTimerSeconds={30} />,
      state
    );

    expect(screen.getByLabelText('Voting timer')).toHaveTextContent('30s');
  });

  it('calls onVotingComplete when timer expires', () => {
    const onVotingComplete = vi.fn();
    const state = createTestState();
    renderWithProvider(
      <VotingScreen playerId="p1" votingTimerSeconds={5} onVotingComplete={onVotingComplete} />,
      state
    );

    expect(onVotingComplete).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(5500);
    });

    expect(onVotingComplete).toHaveBeenCalledTimes(1);
  });

  it('allows non-submitters to vote', () => {
    const onVoteCast = vi.fn();
    const state = createTestState();
    // p1 did not submit an answer (featured player), but should still be able to vote
    renderWithProvider(
      <VotingScreen playerId="p1" votingTimerSeconds={30} onVoteCast={onVoteCast} />,
      state
    );

    // p1 has no own answer in the list, so all answers should be selectable
    const answerBtn = screen.getByText('A library of books').closest('button')!;
    expect(answerBtn).not.toBeDisabled();

    fireEvent.click(answerBtn);
    fireEvent.click(screen.getByLabelText('Confirm vote'));

    expect(onVoteCast).toHaveBeenCalledWith('p1', 'p3');
  });

  it('calls onVotingComplete when all eligible voters have voted', () => {
    const onVotingComplete = vi.fn();
    // Set up state where 3 of 4 players have already voted
    const state = createTestState({
      game: {
        phase: 'voting_phase',
        currentRound: 1,
        totalRounds: 4,
        questions: [0, 1, 2, 3],
        featuredPlayerOrder: ['p1', 'p2', 'p3', 'p4'],
        scores: { p1: 0, p2: 0, p3: 0, p4: 0 },
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
            p2: 'p3',
            p3: 'p4',
            p4: 'p2',
          },
          timerEndTime: Date.now() + 30000,
        },
      },
    });

    renderWithProvider(
      <VotingScreen playerId="p1" votingTimerSeconds={30} onVotingComplete={onVotingComplete} />,
      state
    );

    // p1 is the last voter — cast their vote
    const answerBtn = screen.getByText('A rubber duck').closest('button')!;
    fireEvent.click(answerBtn);
    fireEvent.click(screen.getByLabelText('Confirm vote'));

    // After p1 votes, all 4 eligible voters have voted → early completion
    expect(onVotingComplete).toHaveBeenCalled();
  });

  it('shows vote progress count', () => {
    const state = createTestState({
      game: {
        phase: 'voting_phase',
        currentRound: 1,
        totalRounds: 4,
        questions: [0, 1, 2, 3],
        featuredPlayerOrder: ['p1', 'p2', 'p3', 'p4'],
        scores: { p1: 0, p2: 0, p3: 0, p4: 0 },
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
            p2: 'p3',
          },
          timerEndTime: Date.now() + 30000,
        },
      },
    });

    renderWithProvider(
      <VotingScreen playerId="p1" votingTimerSeconds={30} />,
      state
    );

    expect(screen.getByLabelText('Vote progress')).toHaveTextContent('1 of 4 votes cast');
  });

  it('shows round information', () => {
    const state = createTestState();
    renderWithProvider(
      <VotingScreen playerId="p1" votingTimerSeconds={30} />,
      state
    );

    expect(screen.getByLabelText('Round progress')).toHaveTextContent('Round 1 of 4');
  });

  it('does not show confirm button before selecting an answer', () => {
    const state = createTestState();
    renderWithProvider(
      <VotingScreen playerId="p1" votingTimerSeconds={30} />,
      state
    );

    expect(screen.queryByLabelText('Confirm vote')).not.toBeInTheDocument();
  });

  it('handles player who already voted in state', () => {
    const state = createTestState({
      game: {
        phase: 'voting_phase',
        currentRound: 1,
        totalRounds: 4,
        questions: [0, 1, 2, 3],
        featuredPlayerOrder: ['p1', 'p2', 'p3', 'p4'],
        scores: { p1: 0, p2: 0, p3: 0, p4: 0 },
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
            p1: 'p2', // p1 already voted
          },
          timerEndTime: Date.now() + 30000,
        },
      },
    });

    renderWithProvider(
      <VotingScreen playerId="p1" votingTimerSeconds={30} />,
      state
    );

    // Should show confirmation since already voted
    expect(screen.getByText('Your vote has been recorded!')).toBeInTheDocument();

    // All answer buttons should be disabled
    const allButtons = screen.getAllByRole('listitem');
    allButtons.forEach((btn) => {
      expect(btn).toBeDisabled();
    });
  });
});
