import type { GameSettings, Player, GameStartMessage } from '../types';

/**
 * Question Bank utilities for loading, filtering, and selecting questions
 * for the LAN party game.
 *
 * Requirements: 4.1, 4.2, 13.1, 13.2, 13.3, 13.4, 13.5, 13.6
 */

export interface GameStartPreparation {
  questions: number[];
  featuredOrder: string[];
  totalRounds: number;
  questionTexts: string[];
}

export class QuestionBankError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuestionBankError';
  }
}

/**
 * Fetches and validates questions.json from the server.
 * Requirement 13.1: Load questions from JSON file served by Host_Server
 * Requirement 13.5: Display error if fetch fails or JSON is invalid
 *
 * @returns Array of question template strings
 * @throws QuestionBankError if fetch fails or JSON is invalid
 */
export async function fetchQuestionBank(): Promise<string[]> {
  let response: Response;
  try {
    response = await fetch('/questions.json');
  } catch (error) {
    throw new QuestionBankError(
      'Failed to fetch question bank: network error'
    );
  }

  if (!response.ok) {
    throw new QuestionBankError(
      `Failed to fetch question bank: server returned ${response.status}`
    );
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch (error) {
    throw new QuestionBankError(
      'Failed to parse question bank: invalid JSON'
    );
  }

  // Validate structure: must be an array of strings
  if (!Array.isArray(data)) {
    throw new QuestionBankError(
      'Invalid question bank format: expected an array of strings'
    );
  }

  for (let i = 0; i < data.length; i++) {
    if (typeof data[i] !== 'string') {
      throw new QuestionBankError(
        `Invalid question bank format: entry at index ${i} is not a string`
      );
    }
  }

  return data as string[];
}

/**
 * Filters questions to only those containing the "XYZ" placeholder.
 * Requirement 13.6: Skip entries that do not contain "XYZ"
 *
 * @param questions - Raw question bank array
 * @returns Object with validQuestions (strings containing "XYZ") and their original indices
 */
export function filterValidQuestions(questions: string[]): {
  validQuestions: string[];
  validIndices: number[];
} {
  const validQuestions: string[] = [];
  const validIndices: number[] = [];

  for (let i = 0; i < questions.length; i++) {
    if (questions[i].includes('XYZ')) {
      validQuestions.push(questions[i]);
      validIndices.push(i);
    }
  }

  return { validQuestions, validIndices };
}

/**
 * Selects N random unique questions without repetition for all rounds.
 * Requirement 13.2: Select questions randomly without repetition within a game session
 *
 * @param validIndices - Array of valid question indices (those containing "XYZ")
 * @param roundCount - Number of rounds (questions needed)
 * @returns Array of selected question indices (length = roundCount)
 * @throws QuestionBankError if insufficient questions available
 */
export function selectQuestionsForGame(
  validIndices: number[],
  roundCount: number
): number[] {
  if (validIndices.length < roundCount) {
    throw new QuestionBankError(
      `Insufficient questions: need ${roundCount} but only ${validIndices.length} valid questions available`
    );
  }

  // Fisher-Yates shuffle on a copy, then take first N
  const shuffled = [...validIndices];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled.slice(0, roundCount);
}

/**
 * Randomizes the order of player IDs for featured player selection.
 * Requirement 4.2: Each player featured exactly once in random order
 *
 * @param playerIds - Array of connected player IDs
 * @returns Shuffled copy of player IDs
 */
export function randomizeFeaturedOrder(playerIds: string[]): string[] {
  const shuffled = [...playerIds];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Substitutes all occurrences of "XYZ" in a question with the featured player's name.
 * Requirement 13.3: Substitute all "XYZ" occurrences with Featured_Player's name
 *
 * @param questionTemplate - Question text containing "XYZ" placeholder(s)
 * @param playerName - The featured player's name to substitute
 * @returns Question text with all "XYZ" replaced by playerName
 */
export function substitutePlayerName(
  questionTemplate: string,
  playerName: string
): string {
  return questionTemplate.split('XYZ').join(playerName);
}

/**
 * Orchestrates the full game start flow:
 * 1. Fetch question bank from server
 * 2. Filter to valid questions (containing "XYZ")
 * 3. Verify sufficient questions for player count
 * 4. Select random questions without repetition
 * 5. Randomize featured player order
 *
 * Requirements: 4.1, 4.2, 13.1, 13.2, 13.3, 13.4, 13.5, 13.6
 *
 * @param settings - Current game settings
 * @param players - Array of connected players
 * @returns GameStartPreparation with questions, featured order, and metadata
 * @throws QuestionBankError if any step fails
 */
export async function prepareGameStart(
  settings: GameSettings,
  players: Player[]
): Promise<GameStartPreparation> {
  const connectedPlayers = players.filter((p) => p.isConnected);

  // Requirement 3.1: Enforce minimum player count
  if (connectedPlayers.length < settings.minPlayers) {
    throw new QuestionBankError(
      `Not enough players: need at least ${settings.minPlayers} but only ${connectedPlayers.length} connected`
    );
  }

  // Requirement 13.1: Fetch question bank
  const allQuestions = await fetchQuestionBank();

  // Requirement 13.6: Filter to valid questions
  const { validIndices } = filterValidQuestions(allQuestions);

  // Requirement 4.1: Total rounds = number of connected players
  const totalRounds = connectedPlayers.length;

  // Requirement 13.4: Verify sufficient questions
  if (validIndices.length < totalRounds) {
    throw new QuestionBankError(
      `Insufficient questions: need ${totalRounds} but only ${validIndices.length} valid questions available`
    );
  }

  // Requirement 13.2: Select random questions without repetition
  const selectedIndices = selectQuestionsForGame(validIndices, totalRounds);

  // Requirement 4.2: Randomize featured player order
  const playerIds = connectedPlayers.map((p) => p.id);
  const featuredOrder = randomizeFeaturedOrder(playerIds);

  // Collect the actual question texts for the selected indices
  const questionTexts = selectedIndices.map((idx) => allQuestions[idx]);

  return {
    questions: selectedIndices,
    featuredOrder,
    totalRounds,
    questionTexts,
  };
}

/**
 * Builds a GameStartMessage from the preparation result.
 *
 * @param preparation - Result from prepareGameStart
 * @param settings - Current game settings
 * @returns GameStartMessage ready to broadcast
 */
export function buildGameStartMessage(
  preparation: GameStartPreparation,
  settings: GameSettings
): GameStartMessage {
  return {
    type: 'game_start',
    settings,
    questions: preparation.questions,
    featuredPlayerOrder: preparation.featuredOrder,
    totalRounds: preparation.totalRounds,
  };
}
