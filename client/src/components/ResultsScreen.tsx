import { useEffect, useState, useCallback, useMemo } from 'react';
import { useGame, computeLeaderboard } from '../context/GameContext';
import { useTimer } from '../hooks/useTimer';
import type { RoundResult, LeaderboardEntry } from '../types';

export interface ResultsScreenProps {
  /** The current player's ID */
  playerId: string;
  /** Minimum display time in seconds before enabling "Next Round" (default 10) */
  minimumDisplaySeconds?: number;
  /** Called when the host triggers the next round */
  onNextRound?: () => void;
  /** Called when the game should end (final round complete) */
  onGameEnd?: () => void;
}

/**
 * ResultsScreen reveals the author of each answer with vote count,
 * displays points earned per player for the round, and shows the
 * leaderboard sorted by cumulative score (descending), ties broken
 * by join order. A minimum 10-second display is enforced before
 * enabling the "Next Round" option.
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 8.2
 */
export function ResultsScreen({
  playerId,
  minimumDisplaySeconds = 10,
  onNextRound,
  onGameEnd,
}: ResultsScreenProps) {
  const { state } = useGame();
  const [canProceed, setCanProceed] = useState(false);

  const game = state.game;
  const currentRoundState = game?.currentRoundState;
  const answers = currentRoundState?.answers ?? {};
  const votes = currentRoundState?.votes ?? {};
  const scores = game?.scores ?? {};

  // Determine if this is the final round
  const isFinalRound = game
    ? game.currentRound >= game.totalRounds
    : false;

  // Determine if the current player is the host
  const isHost = state.players.find((p) => p.id === playerId)?.isHost ?? false;

  // Timer expiry enables the proceed button
  const handleTimerExpiry = useCallback(() => {
    setCanProceed(true);
  }, []);

  const { secondsRemaining, start } = useTimer({
    onExpiry: handleTimerExpiry,
  });

  // Start the minimum display timer on mount
  useEffect(() => {
    start(minimumDisplaySeconds);
  }, [minimumDisplaySeconds, start]);

  // Compute round results: each answer with author, vote count, and points earned
  const roundResults: RoundResult[] = useMemo(() => {
    const results: RoundResult[] = [];

    // Calculate points per player for this round
    const roundPoints: Record<string, number> = {};
    for (const authorId of Object.keys(answers)) {
      roundPoints[authorId] = 0;
    }

    // Count votes per answer author (handling duplicate answers)
    for (const answerId of Object.values(votes)) {
      const votedAnswerText = answers[answerId];
      if (votedAnswerText === undefined) continue;

      // Find all players who submitted the exact same answer text
      const matchingAuthors = Object.entries(answers)
        .filter(([, text]) => text === votedAnswerText)
        .map(([pid]) => pid);

      for (const authorId of matchingAuthors) {
        roundPoints[authorId] = (roundPoints[authorId] ?? 0) + 1;
      }
    }

    // Build result entries
    for (const [authorId, answerText] of Object.entries(answers)) {
      const player = state.players.find((p) => p.id === authorId);
      const voteCount = roundPoints[authorId] ?? 0;

      results.push({
        playerId: authorId,
        playerName: player?.name ?? 'Unknown',
        answer: answerText,
        voteCount,
        pointsEarned: voteCount,
      });
    }

    // Sort by vote count descending
    results.sort((a, b) => b.voteCount - a.voteCount);

    return results;
  }, [answers, votes, state.players]);

  // Compute leaderboard from cumulative scores
  const leaderboard: LeaderboardEntry[] = useMemo(() => {
    return computeLeaderboard(scores, state.players);
  }, [scores, state.players]);

  // Handle proceed action
  const handleProceed = () => {
    if (!canProceed) return;

    if (isFinalRound) {
      onGameEnd?.();
    } else {
      onNextRound?.();
    }
  };

  return (
    <div className="results-screen" role="main" aria-label="Round results">
      <header className="results-screen__header">
        <span className="results-screen__round-info" aria-label="Round progress">
          Round {game?.currentRound ?? 0} of {game?.totalRounds ?? 0}
        </span>
        {!canProceed && (
          <span className="results-screen__timer" aria-label="Results timer" aria-live="polite">
            {secondsRemaining}s
          </span>
        )}
      </header>

      <section className="results-screen__answers" aria-label="Answer results">
        <h1 className="results-screen__title">Round Results</h1>

        <div className="results-screen__answer-list" role="list" aria-label="Answers with authors">
          {roundResults.map((result) => (
            <div
              key={result.playerId}
              className="results-screen__answer-item"
              role="listitem"
              aria-label={`${result.playerName}'s answer`}
            >
              <div className="results-screen__answer-text">
                &ldquo;{result.answer}&rdquo;
              </div>
              <div className="results-screen__answer-meta">
                <span className="results-screen__author">— {result.playerName}</span>
                <span className="results-screen__votes" aria-label={`${result.voteCount} votes`}>
                  {result.voteCount} {result.voteCount === 1 ? 'vote' : 'votes'}
                </span>
                <span className="results-screen__points" aria-label={`${result.pointsEarned} points earned`}>
                  +{result.pointsEarned} {result.pointsEarned === 1 ? 'point' : 'points'}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="results-screen__leaderboard" aria-label="Leaderboard">
        <h2 className="results-screen__leaderboard-title">Leaderboard</h2>

        <div className="results-screen__leaderboard-list" role="list" aria-label="Player rankings">
          {leaderboard.map((entry) => (
            <div
              key={entry.playerId}
              className={[
                'results-screen__leaderboard-entry',
                entry.playerId === playerId ? 'results-screen__leaderboard-entry--self' : '',
              ].filter(Boolean).join(' ')}
              role="listitem"
              aria-label={`Rank ${entry.rank}: ${entry.playerName} with ${entry.score} points`}
            >
              <span className="results-screen__rank">#{entry.rank}</span>
              <span className="results-screen__player-name">{entry.playerName}</span>
              <span className="results-screen__score">{entry.score} pts</span>
            </div>
          ))}
        </div>
      </section>

      {isHost && (
        <footer className="results-screen__footer">
          <button
            className="results-screen__proceed-btn"
            onClick={handleProceed}
            disabled={!canProceed}
            aria-disabled={!canProceed}
            aria-label={isFinalRound ? 'End game' : 'Next round'}
          >
            {isFinalRound ? 'End Game' : 'Next Round'}
          </button>
        </footer>
      )}
    </div>
  );
}
