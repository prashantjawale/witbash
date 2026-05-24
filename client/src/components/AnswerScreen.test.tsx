import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnswerScreen } from './AnswerScreen';
import { GameProvider, AppState } from '../context/GameContext';
import type { GameState, Player } from '../types';

function createTestState(overrides?: Partial<{
  players: Player[];
  game: GameState | null;
  answerTimerSeconds: number;
}>): AppState {
  const players: Player[] = overrides?.players ?? [
    { id: 'p1', name: 'Alice', isHost: true, isConnected: true, joinOrder: 1 },
    { id: 'p2', name: 'Bob', isHost: false, isConnected: true, joinOrder: 2 },
    { id: 'p3', name: 'Charlie', isHost: false, isConnected: true, joinOrder: 3 },
    { id: 'p4', name: 'Diana', isHost: false, isConnected: true, joinOrder: 4 },
  ];

  const game: GameState | null = overrides?.game !== undefined ? overrides.game : {
    phase: 'answer_phase',
    currentRound: 1,
    totalRounds: 4,
    questions: [0, 1, 2, 3],
    featuredPlayerOrder: ['p1', 'p2', 'p3', 'p4'],
    scores: { p1: 0, p2: 0, p3: 0, p4: 0 },
    currentRoundState: {
      questionIndex: 0,
      featuredPlayerId: 'p2',
      questionText: 'What would XYZ bring to a deserted island?',
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
      answerTimerSeconds: overrides?.answerTimerSeconds ?? 60,
      votingTimerSeconds: 30,
    },
    game,
  };
}

function renderWithProvider(
  ui: React.ReactElement,
  state: AppState
) {
  return render(
    <GameProvider initialState={state}>{ui}</GameProvider>
  );
}

describe('AnswerScreen', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('displays the question with featured player name substituted for XYZ', () => {
    const state = createTestState();
    renderWithProvider(
      <AnswerScreen playerId="p1" timerDurationSeconds={60} />,
      state
    );

    expect(screen.getByLabelText('Current question')).toHaveTextContent(
      'What would Bob bring to a deserted island?'
    );
  });

  it('displays the featured player name', () => {
    const state = createTestState();
    renderWithProvider(
      <AnswerScreen playerId="p1" timerDurationSeconds={60} />,
      state
    );

    expect(screen.getByLabelText('Featured player')).toHaveTextContent('Featuring: Bob');
  });

  it('shows a visible countdown timer', () => {
    const state = createTestState();
    renderWithProvider(
      <AnswerScreen playerId="p1" timerDurationSeconds={30} />,
      state
    );

    expect(screen.getByLabelText('Time remaining')).toHaveTextContent('30s');
  });

  it('decrements the timer over time', () => {
    const state = createTestState();
    renderWithProvider(
      <AnswerScreen playerId="p1" timerDurationSeconds={30} />,
      state
    );

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    const timerEl = screen.getByLabelText('Time remaining');
    const seconds = parseInt(timerEl.textContent ?? '0');
    expect(seconds).toBeLessThanOrEqual(30);
    expect(seconds).toBeGreaterThanOrEqual(28);
  });

  it('allows submitting a valid answer', () => {
    const onSubmit = vi.fn();
    const state = createTestState();
    renderWithProvider(
      <AnswerScreen playerId="p1" onSubmitAnswer={onSubmit} timerDurationSeconds={60} />,
      state
    );

    const input = screen.getByLabelText('Your answer:');
    fireEvent.change(input, { target: { value: 'A rubber duck' } });
    fireEvent.submit(screen.getByLabelText('Answer form'));

    expect(onSubmit).toHaveBeenCalledWith('p1', 'A rubber duck');
  });

  it('shows confirmation after submission', () => {
    const state = createTestState();
    renderWithProvider(
      <AnswerScreen playerId="p1" timerDurationSeconds={60} />,
      state
    );

    const input = screen.getByLabelText('Your answer:');
    fireEvent.change(input, { target: { value: 'A rubber duck' } });
    fireEvent.submit(screen.getByLabelText('Answer form'));

    expect(screen.getByText('Answer submitted! Waiting for other players...')).toBeInTheDocument();
  });

  it('disables input after submission', () => {
    const state = createTestState();
    renderWithProvider(
      <AnswerScreen playerId="p1" timerDurationSeconds={60} />,
      state
    );

    const input = screen.getByLabelText('Your answer:') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'A rubber duck' } });
    fireEvent.submit(screen.getByLabelText('Answer form'));

    expect(input).toBeDisabled();
  });

  it('rejects empty submissions with error message', () => {
    const onSubmit = vi.fn();
    const state = createTestState();
    renderWithProvider(
      <AnswerScreen playerId="p1" onSubmitAnswer={onSubmit} timerDurationSeconds={60} />,
      state
    );

    fireEvent.submit(screen.getByLabelText('Answer form'));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('rejects whitespace-only submissions', () => {
    const onSubmit = vi.fn();
    const state = createTestState();
    renderWithProvider(
      <AnswerScreen playerId="p1" onSubmitAnswer={onSubmit} timerDurationSeconds={60} />,
      state
    );

    const input = screen.getByLabelText('Your answer:');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.submit(screen.getByLabelText('Answer form'));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Answer must contain at least one non-whitespace character'
    );
  });

  it('calls onSkipRound when timer expires with fewer than 2 answers', () => {
    const onSkip = vi.fn();
    const state = createTestState();
    renderWithProvider(
      <AnswerScreen playerId="p1" onSkipRound={onSkip} timerDurationSeconds={5} />,
      state
    );

    act(() => {
      vi.advanceTimersByTime(6000);
    });

    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('calls onProceedToVoting when timer expires with 2+ answers', () => {
    const onProceed = vi.fn();
    const state = createTestState({
      game: {
        phase: 'answer_phase',
        currentRound: 1,
        totalRounds: 4,
        questions: [0, 1, 2, 3],
        featuredPlayerOrder: ['p1', 'p2', 'p3', 'p4'],
        scores: { p1: 0, p2: 0, p3: 0, p4: 0 },
        currentRoundState: {
          questionIndex: 0,
          featuredPlayerId: 'p2',
          questionText: 'What would XYZ bring to a deserted island?',
          answers: { p1: 'A book', p3: 'A knife' },
          votes: {},
          timerEndTime: 0,
        },
      },
    });
    renderWithProvider(
      <AnswerScreen playerId="p4" onProceedToVoting={onProceed} timerDurationSeconds={5} />,
      state
    );

    act(() => {
      vi.advanceTimersByTime(6000);
    });

    expect(onProceed).toHaveBeenCalledTimes(1);
  });

  it('prevents modification after submission (does not change input value)', () => {
    const state = createTestState();
    renderWithProvider(
      <AnswerScreen playerId="p1" timerDurationSeconds={60} />,
      state
    );

    const input = screen.getByLabelText('Your answer:') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'My answer' } });
    fireEvent.submit(screen.getByLabelText('Answer form'));

    // Try to change the input after submission
    fireEvent.change(input, { target: { value: 'Changed answer' } });

    // Input should still show original answer since it's disabled
    expect(input.value).toBe('My answer');
  });

  it('shows input as disabled if player already submitted in state', () => {
    const state = createTestState({
      game: {
        phase: 'answer_phase',
        currentRound: 1,
        totalRounds: 4,
        questions: [0, 1, 2, 3],
        featuredPlayerOrder: ['p1', 'p2', 'p3', 'p4'],
        scores: { p1: 0, p2: 0, p3: 0, p4: 0 },
        currentRoundState: {
          questionIndex: 0,
          featuredPlayerId: 'p2',
          questionText: 'What would XYZ bring to a deserted island?',
          answers: { p1: 'Already submitted' },
          votes: {},
          timerEndTime: 0,
        },
      },
    });
    renderWithProvider(
      <AnswerScreen playerId="p1" timerDurationSeconds={60} />,
      state
    );

    const input = screen.getByLabelText('Your answer:') as HTMLInputElement;
    expect(input).toBeDisabled();
    expect(screen.getByText('Answer submitted! Waiting for other players...')).toBeInTheDocument();
  });

  it('clears error message when user types', () => {
    const state = createTestState();
    renderWithProvider(
      <AnswerScreen playerId="p1" timerDurationSeconds={60} />,
      state
    );

    // Submit empty to trigger error
    fireEvent.submit(screen.getByLabelText('Answer form'));
    expect(screen.getByRole('alert')).toBeInTheDocument();

    // Type something to clear error
    const input = screen.getByLabelText('Your answer:');
    fireEvent.change(input, { target: { value: 'a' } });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
