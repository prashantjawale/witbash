import React, { useState, useCallback, useMemo } from 'react';
import { useGame } from '../context/GameContext';
import { useTimer } from '../hooks/useTimer';
import { validateAnswer } from '../utils/validation';

export interface AnswerScreenProps {
  /** Current player's ID */
  playerId: string;
  /** Called when the answer phase should transition to voting */
  onProceedToVoting?: () => void;
  /** Called when the round should be skipped (fewer than 2 answers at timer expiry) */
  onSkipRound?: () => void;
  /** Called when a player submits an answer (for broadcasting) */
  onSubmitAnswer?: (playerId: string, answer: string) => void;
  /** Override timer duration for testing (seconds) */
  timerDurationSeconds?: number;
}

/**
 * AnswerScreen displays the current question and allows players to submit answers
 * within a countdown timer. After submission, the input is disabled.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7
 */
export function AnswerScreen({
  playerId,
  onProceedToVoting,
  onSkipRound,
  onSubmitAnswer,
  timerDurationSeconds,
}: AnswerScreenProps) {
  const { state, dispatch } = useGame();
  const [answerText, setAnswerText] = useState('');
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const game = state.game;
  const currentRoundState = game?.currentRoundState;
  const questionText = currentRoundState?.questionText ?? '';
  const featuredPlayerId = currentRoundState?.featuredPlayerId ?? '';
  const answers = currentRoundState?.answers ?? {};

  // Find the featured player's name
  const featuredPlayer = state.players.find((p) => p.id === featuredPlayerId);
  const featuredPlayerName = featuredPlayer?.name ?? '';

  // Substitute XYZ in the question text with the featured player's name
  const displayQuestion = questionText.includes('XYZ')
    ? questionText.replaceAll('XYZ', featuredPlayerName)
    : questionText;

  // Determine timer duration from settings or prop override
  const duration = timerDurationSeconds ?? state.settings.answerTimerSeconds;

  // Count connected players (excluding featured player who doesn't answer their own question)
  const connectedPlayers = state.players.filter((p) => p.isConnected);
  const eligiblePlayerCount = connectedPlayers.length;

  // Check if all players have submitted
  const allSubmitted = useMemo(() => {
    const submittedCount = Object.keys(answers).length;
    return submittedCount >= eligiblePlayerCount;
  }, [answers, eligiblePlayerCount]);

  // Handle timer expiry
  const handleTimerExpiry = useCallback(() => {
    const submittedCount = Object.keys(answers).length;
    if (submittedCount < 2) {
      // Skip round: fewer than 2 answers
      onSkipRound?.();
    } else {
      // Proceed to voting with whatever answers have been submitted
      onProceedToVoting?.();
    }
  }, [answers, onProceedToVoting, onSkipRound]);

  const { secondsRemaining, isActive, start } = useTimer({
    onExpiry: handleTimerExpiry,
  });

  // Start timer on mount
  React.useEffect(() => {
    start(duration);
  }, [start, duration]);

  // Handle early completion: all players submitted
  React.useEffect(() => {
    if (allSubmitted && isActive && Object.keys(answers).length >= 2) {
      onProceedToVoting?.();
    }
  }, [allSubmitted, isActive, answers, onProceedToVoting]);

  // Check if current player already submitted (e.g., from state sync)
  const hasAlreadySubmitted = playerId in answers;
  const isDisabled = submitted || hasAlreadySubmitted;

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();

      if (isDisabled) return;

      const validation = validateAnswer(answerText);
      if (!validation.valid) {
        setError(validation.message);
        return;
      }

      setError('');
      setSubmitted(true);

      // Dispatch to local state
      dispatch({ type: 'SUBMIT_ANSWER', playerId, answer: answerText });

      // Notify parent for broadcasting
      onSubmitAnswer?.(playerId, answerText);
    },
    [answerText, isDisabled, dispatch, playerId, onSubmitAnswer]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (isDisabled) return;
      setAnswerText(e.target.value);
      // Clear error on input change
      if (error) setError('');
    },
    [isDisabled, error]
  );

  return (
    <div className="answer-screen" role="main" aria-label="Answer submission">
      <header className="answer-screen__header">
        <span className="answer-screen__timer" aria-label="Time remaining" aria-live="polite">
          {secondsRemaining}s
        </span>
      </header>

      <section className="answer-screen__content">
        {featuredPlayerName && (
          <p className="answer-screen__featured" aria-label="Featured player">
            Featuring: <strong>{featuredPlayerName}</strong>
          </p>
        )}

        <h1 className="answer-screen__question" aria-label="Current question">
          {displayQuestion}
        </h1>

        <form onSubmit={handleSubmit} className="answer-screen__form" aria-label="Answer form">
          <label htmlFor="answer-input" className="answer-screen__label">
            Your answer:
          </label>
          <input
            id="answer-input"
            type="text"
            className="answer-screen__input"
            value={answerText}
            onChange={handleInputChange}
            disabled={isDisabled}
            maxLength={280}
            placeholder="Type your answer..."
            aria-describedby={error ? 'answer-error' : undefined}
            aria-invalid={error ? true : undefined}
          />

          {error && (
            <p id="answer-error" className="answer-screen__error" role="alert">
              {error}
            </p>
          )}

          {isDisabled ? (
            <p className="answer-screen__confirmation" aria-live="polite">
              Answer submitted! Waiting for other players...
            </p>
          ) : (
            <button
              type="submit"
              className="answer-screen__submit"
              disabled={isDisabled}
            >
              Submit Answer
            </button>
          )}
        </form>
      </section>
    </div>
  );
}
