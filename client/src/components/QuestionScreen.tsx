import { useEffect, useState } from 'react';
import { useGame } from '../context/GameContext';

/** Duration in milliseconds to display the question before transitioning */
const QUESTION_DISPLAY_DURATION_MS = 3000;

export interface QuestionScreenProps {
  /** Called when the display period ends and the game should transition to the answer phase */
  onTransitionToAnswer?: () => void;
  /** Override display duration for testing (ms) */
  displayDurationMs?: number;
}

/**
 * QuestionScreen displays the current round's question with the Featured_Player's
 * name substituted for "XYZ". It shows the round number and total rounds, then
 * automatically transitions to the AnswerScreen after a brief display period.
 *
 * Requirements: 4.3
 */
export function QuestionScreen({
  onTransitionToAnswer,
  displayDurationMs = QUESTION_DISPLAY_DURATION_MS,
}: QuestionScreenProps) {
  const { state } = useGame();
  const [transitioning, setTransitioning] = useState(false);

  const game = state.game;
  const currentRound = game?.currentRound ?? 0;
  const totalRounds = game?.totalRounds ?? 0;
  const questionText = game?.currentRoundState?.questionText ?? '';
  const featuredPlayerId = game?.currentRoundState?.featuredPlayerId ?? '';

  // Find the featured player's name for display
  const featuredPlayer = state.players.find((p) => p.id === featuredPlayerId);
  const featuredPlayerName = featuredPlayer?.name ?? '';

  // Substitute XYZ in the question text with the featured player's name.
  // The reducer may store a placeholder; this ensures the display always shows
  // the correct substitution regardless of how the state was populated.
  const displayQuestion = questionText.includes('XYZ')
    ? questionText.replaceAll('XYZ', featuredPlayerName)
    : questionText;

  useEffect(() => {
    if (transitioning) return;

    const timer = setTimeout(() => {
      setTransitioning(true);
      onTransitionToAnswer?.();
    }, displayDurationMs);

    return () => clearTimeout(timer);
  }, [displayDurationMs, onTransitionToAnswer, transitioning]);

  return (
    <div className="question-screen" role="main" aria-label="Question display">
      <header className="question-screen__header">
        <span className="question-screen__round-info" aria-label="Round progress">
          Round {currentRound} of {totalRounds}
        </span>
      </header>

      <section className="question-screen__content">
        {featuredPlayerName && (
          <p className="question-screen__featured" aria-label="Featured player">
            Featuring: <strong>{featuredPlayerName}</strong>
          </p>
        )}

        <h1 className="question-screen__question" aria-label="Current question">
          {displayQuestion}
        </h1>
      </section>

      <footer className="question-screen__footer">
        <p className="question-screen__hint">Get ready to answer...</p>
      </footer>
    </div>
  );
}
