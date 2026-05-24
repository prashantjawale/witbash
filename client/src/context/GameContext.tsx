import React, { createContext, useContext, useReducer } from 'react';
import type {
  Player,
  GameSettings,
  GameState,
  RoundState,
  LeaderboardEntry,
  GameAction,
} from '../types';

// ============================================================
// App-level state (wraps Room concept for the local client)
// ============================================================

export interface AppState {
  roomCode: string;
  players: Player[];
  settings: GameSettings;
  game: GameState | null;
}

// ============================================================
// Default values
// ============================================================

export const DEFAULT_SETTINGS: GameSettings = {
  minPlayers: 4,
  maxPlayers: 7,
  answerTimerSeconds: 60,
  votingTimerSeconds: 30,
};

const EMPTY_ROUND_STATE: RoundState = {
  questionIndex: -1,
  featuredPlayerId: '',
  questionText: '',
  answers: {},
  votes: {},
  timerEndTime: 0,
};

export const INITIAL_STATE: AppState = {
  roomCode: '',
  players: [],
  settings: { ...DEFAULT_SETTINGS },
  game: null,
};

// ============================================================
// Helper: compute leaderboard from scores and players
// ============================================================

export function computeLeaderboard(
  scores: Record<string, number>,
  players: Player[]
): LeaderboardEntry[] {
  const entries: LeaderboardEntry[] = players.map((p) => ({
    playerId: p.id,
    playerName: p.name,
    score: scores[p.id] ?? 0,
    rank: 0,
  }));

  // Sort descending by score, ties broken by ascending joinOrder
  entries.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const playerA = players.find((p) => p.id === a.playerId);
    const playerB = players.find((p) => p.id === b.playerId);
    return (playerA?.joinOrder ?? 0) - (playerB?.joinOrder ?? 0);
  });

  // Assign ranks (tied players get the same rank)
  let currentRank = 1;
  for (let i = 0; i < entries.length; i++) {
    if (i > 0 && entries[i].score < entries[i - 1].score) {
      currentRank = i + 1;
    }
    entries[i].rank = currentRank;
  }

  return entries;
}

// ============================================================
// Reducer
// ============================================================

export function gameReducer(state: AppState, action: GameAction): AppState {
  switch (action.type) {
    case 'ADD_PLAYER':
      return handleAddPlayer(state, action.player);

    case 'REMOVE_PLAYER':
      return handleRemovePlayer(state, action.playerId);

    case 'SYNC_PLAYERS':
      return { ...state, players: action.players, settings: action.settings };

    case 'START_GAME':
      return handleStartGame(state, action.settings, action.questions, action.featuredOrder);

    case 'BEGIN_ROUND':
      return handleBeginRound(state, action.roundNumber, action.questionIndex, action.featuredPlayerId, action.questionText);

    case 'SUBMIT_ANSWER':
      return handleSubmitAnswer(state, action.playerId, action.answer);

    case 'CAST_VOTE':
      return handleCastVote(state, action.voterId, action.answerId);

    case 'REVEAL_RESULTS':
      return handleRevealResults(state);

    case 'END_GAME':
      return handleEndGame(state);

    case 'APPLY_FULL_STATE':
      return handleApplyFullState(state, action.state);

    case 'UPDATE_SETTINGS':
      return handleUpdateSettings(state, action.settings);

    default:
      return state;
  }
}

// ============================================================
// Action Handlers
// ============================================================

/**
 * ADD_PLAYER: Add player to room, enforce max capacity.
 * Requirements: 3.1, 3.2
 */
function handleAddPlayer(state: AppState, player: Player): AppState {
  // Enforce max capacity
  if (state.players.length >= state.settings.maxPlayers) {
    return state;
  }

  // Don't add duplicate player IDs
  if (state.players.some((p) => p.id === player.id)) {
    return state;
  }

  return {
    ...state,
    players: [...state.players, player],
  };
}

/**
 * REMOVE_PLAYER: Remove player, adjust featured order and round count if needed.
 * Requirements: 8.4, 10.1
 */
function handleRemovePlayer(state: AppState, playerId: string): AppState {
  const newPlayers = state.players.map((p) =>
    p.id === playerId ? { ...p, isConnected: false } : p
  );

  // If no active game, just update players
  if (!state.game) {
    return { ...state, players: newPlayers };
  }

  const game = state.game;
  const { featuredPlayerOrder, currentRound } = game;

  // Check if the removed player has not yet been featured
  // Players who haven't been featured are those at index >= currentRound - 1
  // (currentRound is 1-indexed, so rounds already played = currentRound - 1 if in progress)
  const currentFeaturedIndex = currentRound - 1; // index of current round's featured player
  const notYetFeaturedIndices = featuredPlayerOrder
    .map((id, idx) => ({ id, idx }))
    .filter(({ idx }) => idx > currentFeaturedIndex);

  const isUnfeaturedPlayer = notYetFeaturedIndices.some(({ id }) => id === playerId);

  let newFeaturedOrder = featuredPlayerOrder;
  let newTotalRounds = game.totalRounds;

  if (isUnfeaturedPlayer) {
    // Remove from featured order and reduce total rounds
    newFeaturedOrder = featuredPlayerOrder.filter((id) => id !== playerId);
    newTotalRounds = game.totalRounds - 1;
  }

  return {
    ...state,
    players: newPlayers,
    game: {
      ...game,
      featuredPlayerOrder: newFeaturedOrder,
      totalRounds: newTotalRounds,
    },
  };
}

/**
 * START_GAME: Set total rounds = player count, initialize scores, set phase.
 * Requirements: 4.1, 4.2
 */
function handleStartGame(
  state: AppState,
  settings: GameSettings,
  questions: number[],
  featuredOrder: string[]
): AppState {
  const connectedPlayers = state.players.filter((p) => p.isConnected);

  // Initialize scores to 0 for all players in the featured order
  const scores: Record<string, number> = {};
  for (const playerId of featuredOrder) {
    scores[playerId] = 0;
  }
  // Also include any connected players not in featured order
  for (const player of connectedPlayers) {
    if (!(player.id in scores)) {
      scores[player.id] = 0;
    }
  }

  const totalRounds = featuredOrder.length;

  const gameState: GameState = {
    phase: 'question_display',
    currentRound: 0, // Will be set by BEGIN_ROUND
    totalRounds,
    questions,
    featuredPlayerOrder: featuredOrder,
    scores,
    currentRoundState: { ...EMPTY_ROUND_STATE },
  };

  return {
    ...state,
    settings,
    game: gameState,
  };
}

/**
 * BEGIN_ROUND: Set current round, question, featured player.
 * Requirements: 4.1, 4.2
 */
function handleBeginRound(
  state: AppState,
  roundNumber: number,
  questionIndex: number,
  featuredPlayerId: string,
  questionText: string
): AppState {
  if (!state.game) return state;

  const newRoundState: RoundState = {
    questionIndex,
    featuredPlayerId,
    questionText,
    answers: {},
    votes: {},
    timerEndTime: 0,
  };

  return {
    ...state,
    game: {
      ...state.game,
      phase: 'answer_phase',
      currentRound: roundNumber,
      currentRoundState: newRoundState,
    },
  };
}

/**
 * SUBMIT_ANSWER: Store answer, reject duplicates from same player.
 * Requirements: 5.2, 5.3
 */
function handleSubmitAnswer(state: AppState, playerId: string, answer: string): AppState {
  if (!state.game) return state;

  const { currentRoundState } = state.game;

  // Reject duplicate submission from same player (idempotence)
  if (playerId in currentRoundState.answers) {
    return state;
  }

  return {
    ...state,
    game: {
      ...state.game,
      phase: 'answer_phase',
      currentRoundState: {
        ...currentRoundState,
        answers: {
          ...currentRoundState.answers,
          [playerId]: answer,
        },
      },
    },
  };
}

/**
 * CAST_VOTE: Store vote, reject self-votes and duplicate votes.
 * Requirements: 6.2, 6.3
 */
function handleCastVote(state: AppState, voterId: string, answerId: string): AppState {
  if (!state.game) return state;

  const { currentRoundState } = state.game;

  // Reject duplicate vote from same voter
  if (voterId in currentRoundState.votes) {
    return state;
  }

  // Reject self-vote (answerId is the playerId of the answer author)
  if (voterId === answerId) {
    return state;
  }

  return {
    ...state,
    game: {
      ...state.game,
      phase: 'voting_phase',
      currentRoundState: {
        ...currentRoundState,
        votes: {
          ...currentRoundState.votes,
          [voterId]: answerId,
        },
      },
    },
  };
}

/**
 * REVEAL_RESULTS: Calculate scores, update leaderboard.
 * Requirements: 7.1, 7.2, 7.3
 */
function handleRevealResults(state: AppState): AppState {
  if (!state.game) return state;

  const { currentRoundState, scores } = state.game;
  const { votes, answers } = currentRoundState;

  // Calculate points for this round: each player gets points = number of votes their answer received
  const roundPoints: Record<string, number> = {};

  // Initialize round points for all players who submitted answers
  for (const playerId of Object.keys(answers)) {
    roundPoints[playerId] = 0;
  }

  // Count votes per answer author
  // Handle duplicate answers: if vote is for an answerId (playerId) whose answer text
  // matches other players' answers, all matching authors get the point
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

  // Update cumulative scores
  const newScores: Record<string, number> = { ...scores };
  for (const [playerId, points] of Object.entries(roundPoints)) {
    newScores[playerId] = (newScores[playerId] ?? 0) + points;
  }

  return {
    ...state,
    game: {
      ...state.game,
      phase: 'score_reveal',
      scores: newScores,
    },
  };
}

/**
 * END_GAME: Transition to game_end phase.
 * Requirements: 8.1
 */
function handleEndGame(state: AppState): AppState {
  if (!state.game) return state;

  return {
    ...state,
    game: {
      ...state.game,
      phase: 'game_end',
    },
  };
}

/**
 * APPLY_FULL_STATE: Replace entire game state (for consensus correction).
 * Requirements: 12.3
 */
function handleApplyFullState(state: AppState, gameState: GameState): AppState {
  return {
    ...state,
    game: gameState,
  };
}

/**
 * UPDATE_SETTINGS: Update settings only in lobby phase.
 * Requirements: 14.6
 */
function handleUpdateSettings(state: AppState, settings: GameSettings): AppState {
  // Only allow settings updates when not in an active game (lobby phase)
  if (state.game !== null && state.game.phase !== 'lobby') {
    return state;
  }

  return {
    ...state,
    settings,
  };
}

// ============================================================
// Context
// ============================================================

interface GameContextValue {
  state: AppState;
  dispatch: React.Dispatch<GameAction>;
}

const GameContext = createContext<GameContextValue | null>(null);

// ============================================================
// Provider
// ============================================================

interface GameProviderProps {
  children: React.ReactNode;
  initialState?: AppState;
}

export function GameProvider({ children, initialState }: GameProviderProps) {
  const [state, dispatch] = useReducer(gameReducer, initialState ?? INITIAL_STATE);

  return (
    <GameContext.Provider value={{ state, dispatch }}>
      {children}
    </GameContext.Provider>
  );
}

// ============================================================
// Hook
// ============================================================

export function useGame(): GameContextValue {
  const context = useContext(GameContext);
  if (!context) {
    throw new Error('useGame must be used within a GameProvider');
  }
  return context;
}

export { GameContext };
