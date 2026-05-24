import { useState, useEffect, useMemo, useCallback } from 'react';
import { useGame } from '../context/GameContext';
import { useTimer } from '../hooks/useTimer';

export interface VotingScreenProps {
  /** The current player's ID */
  playerId: string;
  /** Voting timer duration in seconds (from game settings) */
  votingTimerSeconds?: number;
  /** Called when voting phase completes (all voted or timer expires) */
  onVotingComplete?: () => void;
  /** Called when a vote is cast (to broadcast via WebSocket) */
  onVoteCast?: (voterId: string, answerId: string) => void;
}

/**
 * Shuffles an array using Fisher-Yates algorithm.
 * Returns a new array without mutating the original.
 */
function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * VotingScreen displays all submitted answers in randomized order without
 * revealing authorship. Players can vote for exactly one answer (not their own).
 * The phase completes when all eligible voters have voted or the timer expires.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7
 */
export function VotingScreen({
  playerId,
  votingTimerSeconds = 30,
  onVotingComplete,
  onVoteCast,
}: VotingScreenProps) {
  const { state, dispatch } = useGame();
  const [selectedAnswerId, setSelectedAnswerId] = useState<string | null>(null);
  const [hasVoted, setHasVoted] = useState(false);

  const game = state.game;
  const currentRoundState = game?.currentRoundState;
  const answers = currentRoundState?.answers ?? {};
  const votes = currentRoundState?.votes ?? {};

  // Determine if this player has already voted (from state)
  const alreadyVoted = playerId in votes;

  // Compute eligible voters: all connected players (including non-submitters)
  // except disconnected players
  const connectedPlayers = state.players.filter((p) => p.isConnected);
  const eligibleVoterCount = connectedPlayers.length;

  // Count current votes
  const currentVoteCount = Object.keys(votes).length;

  // Check if all eligible voters have voted
  const allVoted = currentVoteCount >= eligibleVoterCount;

  // Randomize answers once on mount (stable across re-renders)
  // Each answer is displayed as { answerId (playerId of author), text }
  const randomizedAnswers = useMemo(() => {
    const answerEntries = Object.entries(answers).map(([authorId, text]) => ({
      answerId: authorId,
      text,
    }));
    return shuffleArray(answerEntries);
  }, [Object.keys(answers).sort().join(',')]);

  // Timer expiry handler
  const handleTimerExpiry = useCallback(() => {
    onVotingComplete?.();
  }, [onVotingComplete]);

  const { secondsRemaining, isActive, start } = useTimer({
    onExpiry: handleTimerExpiry,
  });

  // Start the voting timer on mount
  useEffect(() => {
    start(votingTimerSeconds);
  }, [votingTimerSeconds, start]);

  // Handle early completion: all eligible voters have voted
  useEffect(() => {
    if (allVoted && isActive) {
      onVotingComplete?.();
    }
  }, [allVoted, isActive, onVotingComplete]);

  // Handle vote selection
  const handleSelectAnswer = (answerId: string) => {
    if (hasVoted || alreadyVoted) return;
    // Cannot select own answer
    if (answerId === playerId) return;
    setSelectedAnswerId(answerId);
  };

  // Handle vote confirmation
  const handleConfirmVote = () => {
    if (!selectedAnswerId || hasVoted || alreadyVoted) return;

    // Dispatch vote to game state
    dispatch({
      type: 'CAST_VOTE',
      voterId: playerId,
      answerId: selectedAnswerId,
    });

    // Notify parent for WebSocket broadcast
    onVoteCast?.(playerId, selectedAnswerId);

    setHasVoted(true);
  };

  const voteConfirmed = hasVoted || alreadyVoted;

  return (
    <div className="voting-screen" role="main" aria-label="Voting phase">
      <header className="voting-screen__header">
        <span className="voting-screen__round-info" aria-label="Round progress">
          Round {game?.currentRound ?? 0} of {game?.totalRounds ?? 0}
        </span>
        <span className="voting-screen__timer" aria-label="Voting timer" aria-live="polite">
          {secondsRemaining}s
        </span>
      </header>

      <section className="voting-screen__content">
        <h1 className="voting-screen__title">Vote for the best answer!</h1>

        {voteConfirmed && (
          <p className="voting-screen__confirmation" aria-live="polite" role="status">
            Your vote has been recorded!
          </p>
        )}

        <div className="voting-screen__answers" role="list" aria-label="Answer options">
          {randomizedAnswers.map((answer) => {
            const isOwnAnswer = answer.answerId === playerId;
            const isSelected = selectedAnswerId === answer.answerId;
            const isDisabled = isOwnAnswer || voteConfirmed;

            return (
              <button
                key={answer.answerId}
                className={[
                  'voting-screen__answer-card',
                  isSelected ? 'voting-screen__answer-card--selected' : '',
                  isOwnAnswer ? 'voting-screen__answer-card--own' : '',
                  isDisabled ? 'voting-screen__answer-card--disabled' : '',
                ].filter(Boolean).join(' ')}
                role="listitem"
                onClick={() => handleSelectAnswer(answer.answerId)}
                disabled={isDisabled}
                aria-disabled={isDisabled}
                aria-pressed={isSelected}
                aria-label={isOwnAnswer ? 'Your answer (cannot vote for own answer)' : `Vote for: ${answer.text}`}
              >
                <span className="voting-screen__answer-text">{answer.text}</span>
                {isOwnAnswer && (
                  <span className="voting-screen__own-badge" aria-hidden="true">
                    (Your answer)
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {!voteConfirmed && selectedAnswerId && (
          <button
            className="voting-screen__confirm-btn"
            onClick={handleConfirmVote}
            aria-label="Confirm vote"
          >
            Confirm Vote
          </button>
        )}
      </section>

      <footer className="voting-screen__footer">
        <p className="voting-screen__vote-count" aria-label="Vote progress">
          {currentVoteCount} of {eligibleVoterCount} votes cast
        </p>
      </footer>
    </div>
  );
}
