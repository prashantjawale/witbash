import { useGame, computeLeaderboard } from '../context/GameContext';

// ============================================================
// Types
// ============================================================

export interface FinalLeaderboardProps {
  /** Callback when "Play Again" is clicked — returns all connected players to lobby */
  onPlayAgain: () => void;
}

// ============================================================
// Component
// ============================================================

/**
 * FinalLeaderboard displays the end-of-game rankings with cumulative scores.
 * Tied players are shown in join order (ascending).
 * A "Play Again" button returns all connected players to the lobby.
 *
 * Requirements: 8.2, 8.3, 8.5
 */
export function FinalLeaderboard({ onPlayAgain }: FinalLeaderboardProps) {
  const { state } = useGame();
  const { game, players } = state;

  const scores = game?.scores ?? {};
  const leaderboard = computeLeaderboard(scores, players);

  return (
    <div className="final-leaderboard" role="main" aria-label="Final Leaderboard">
      <h1 className="final-leaderboard__title">Game Over!</h1>

      <section className="final-leaderboard__rankings" aria-label="Final Rankings">
        <h2>Final Rankings</h2>
        <ol className="final-leaderboard__list" aria-label="Leaderboard">
          {leaderboard.map((entry) => (
            <li
              key={entry.playerId}
              className="final-leaderboard__entry"
              aria-label={`Rank ${entry.rank}: ${entry.playerName} with ${entry.score} points`}
            >
              <span className="final-leaderboard__rank">#{entry.rank}</span>
              <span className="final-leaderboard__name">{entry.playerName}</span>
              <span className="final-leaderboard__score">{entry.score} pts</span>
            </li>
          ))}
        </ol>
      </section>

      <div className="final-leaderboard__actions">
        <button
          type="button"
          className="final-leaderboard__play-again-btn"
          onClick={onPlayAgain}
          aria-label="Play Again"
        >
          Play Again
        </button>
      </div>
    </div>
  );
}
