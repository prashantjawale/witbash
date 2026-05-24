import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QuestionScreen } from './QuestionScreen';
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
  ];

  const game: GameState | null = overrides?.game !== undefined ? overrides.game : {
    phase: 'question_display',
    currentRound: 2,
    totalRounds: 3,
    questions: [0, 1, 2],
    featuredPlayerOrder: ['p1', 'p2', 'p3'],
    scores: { p1: 1, p2: 0, p3: 2 },
    currentRoundState: {
      questionIndex: 1,
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
      minPlayers: 3,
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

describe('QuestionScreen', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('displays the question with Featured_Player name substituted for XYZ', () => {
    const state = createTestState();
    renderWithProvider(<QuestionScreen />, state);

    // "XYZ" should be replaced with "Bob" (featured player)
    expect(screen.getByLabelText('Current question')).toHaveTextContent(
      'What would Bob bring to a deserted island?'
    );
  });

  it('shows round number and total rounds', () => {
    const state = createTestState();
    renderWithProvider(<QuestionScreen />, state);

    expect(screen.getByLabelText('Round progress')).toHaveTextContent('Round 2 of 3');
  });

  it('displays the featured player name', () => {
    const state = createTestState();
    renderWithProvider(<QuestionScreen />, state);

    expect(screen.getByLabelText('Featured player')).toHaveTextContent('Featuring: Bob');
  });

  it('transitions to AnswerScreen after display duration', () => {
    const onTransition = vi.fn();
    const state = createTestState();
    renderWithProvider(
      <QuestionScreen onTransitionToAnswer={onTransition} displayDurationMs={2000} />,
      state
    );

    expect(onTransition).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(onTransition).toHaveBeenCalledTimes(1);
  });

  it('does not call transition callback before duration elapses', () => {
    const onTransition = vi.fn();
    const state = createTestState();
    renderWithProvider(
      <QuestionScreen onTransitionToAnswer={onTransition} displayDurationMs={3000} />,
      state
    );

    act(() => {
      vi.advanceTimersByTime(2999);
    });

    expect(onTransition).not.toHaveBeenCalled();
  });

  it('handles question text that already has the name substituted (no XYZ)', () => {
    const state = createTestState({
      game: {
        phase: 'question_display',
        currentRound: 1,
        totalRounds: 3,
        questions: [0, 1, 2],
        featuredPlayerOrder: ['p1', 'p2', 'p3'],
        scores: { p1: 0, p2: 0, p3: 0 },
        currentRoundState: {
          questionIndex: 0,
          featuredPlayerId: 'p1',
          questionText: 'What would Alice bring to a deserted island?',
          answers: {},
          votes: {},
          timerEndTime: 0,
        },
      },
    });
    renderWithProvider(<QuestionScreen />, state);

    expect(screen.getByLabelText('Current question')).toHaveTextContent(
      'What would Alice bring to a deserted island?'
    );
  });

  it('handles multiple XYZ occurrences in the question', () => {
    const state = createTestState({
      game: {
        phase: 'question_display',
        currentRound: 1,
        totalRounds: 3,
        questions: [0, 1, 2],
        featuredPlayerOrder: ['p1', 'p2', 'p3'],
        scores: { p1: 0, p2: 0, p3: 0 },
        currentRoundState: {
          questionIndex: 0,
          featuredPlayerId: 'p3',
          questionText: 'If XYZ met XYZ from the future, what would they say?',
          answers: {},
          votes: {},
          timerEndTime: 0,
        },
      },
    });
    renderWithProvider(<QuestionScreen />, state);

    expect(screen.getByLabelText('Current question')).toHaveTextContent(
      'If Charlie met Charlie from the future, what would they say?'
    );
  });

  it('renders gracefully when game state is null', () => {
    const state = createTestState({ game: null });
    renderWithProvider(<QuestionScreen />, state);

    // Should still render without crashing
    expect(screen.getByLabelText('Round progress')).toHaveTextContent('Round 0 of 0');
  });

  it('only fires transition callback once', () => {
    const onTransition = vi.fn();
    const state = createTestState();
    renderWithProvider(
      <QuestionScreen onTransitionToAnswer={onTransition} displayDurationMs={1000} />,
      state
    );

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(onTransition).toHaveBeenCalledTimes(1);
  });
});
