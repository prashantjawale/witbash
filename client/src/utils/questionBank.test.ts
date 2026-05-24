import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchQuestionBank,
  filterValidQuestions,
  selectQuestionsForGame,
  randomizeFeaturedOrder,
  substitutePlayerName,
  prepareGameStart,
  buildGameStartMessage,
  QuestionBankError,
} from './questionBank';
import type { GameSettings, Player } from '../types';

// ============================================================
// Test helpers
// ============================================================

const SAMPLE_QUESTIONS = [
  'What would XYZ bring to a deserted island?',
  'What is XYZ\'s secret talent?',
  'What would XYZ\'s autobiography be titled?',
  'What is XYZ most likely to be famous for?',
  'What would XYZ do if they were invisible for a day?',
];

const MIXED_QUESTIONS = [
  'What would XYZ bring to a deserted island?',
  'This question has no placeholder',
  'What is XYZ\'s secret talent?',
  'Another question without the placeholder',
  'What would XYZ do if they were invisible for a day?',
];

function createPlayer(id: string, name: string, isHost = false, joinOrder = 0): Player {
  return { id, name, isHost, isConnected: true, joinOrder };
}

function createSettings(overrides: Partial<GameSettings> = {}): GameSettings {
  return {
    minPlayers: 4,
    maxPlayers: 7,
    answerTimerSeconds: 60,
    votingTimerSeconds: 30,
    ...overrides,
  };
}

function mockFetchSuccess(data: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(data),
  });
}

function mockFetchNetworkError() {
  return vi.fn().mockRejectedValue(new Error('Network error'));
}

function mockFetchHttpError(status: number) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: () => Promise.resolve(null),
  });
}

function mockFetchInvalidJson() {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.reject(new SyntaxError('Unexpected token')),
  });
}

// ============================================================
// fetchQuestionBank
// ============================================================

describe('fetchQuestionBank', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetchSuccess(SAMPLE_QUESTIONS));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches and returns valid question bank', async () => {
    const result = await fetchQuestionBank();
    expect(result).toEqual(SAMPLE_QUESTIONS);
    expect(fetch).toHaveBeenCalledWith('/questions.json');
  });

  it('throws QuestionBankError on network failure', async () => {
    vi.stubGlobal('fetch', mockFetchNetworkError());
    await expect(fetchQuestionBank()).rejects.toThrow(QuestionBankError);
    await expect(fetchQuestionBank()).rejects.toThrow('network error');
  });

  it('throws QuestionBankError on HTTP error', async () => {
    vi.stubGlobal('fetch', mockFetchHttpError(404));
    await expect(fetchQuestionBank()).rejects.toThrow(QuestionBankError);
    await expect(fetchQuestionBank()).rejects.toThrow('server returned 404');
  });

  it('throws QuestionBankError on invalid JSON', async () => {
    vi.stubGlobal('fetch', mockFetchInvalidJson());
    await expect(fetchQuestionBank()).rejects.toThrow(QuestionBankError);
    await expect(fetchQuestionBank()).rejects.toThrow('invalid JSON');
  });

  it('throws QuestionBankError if response is not an array', async () => {
    vi.stubGlobal('fetch', mockFetchSuccess({ questions: [] }));
    await expect(fetchQuestionBank()).rejects.toThrow(QuestionBankError);
    await expect(fetchQuestionBank()).rejects.toThrow('expected an array of strings');
  });

  it('throws QuestionBankError if array contains non-strings', async () => {
    vi.stubGlobal('fetch', mockFetchSuccess(['valid', 123, 'also valid']));
    await expect(fetchQuestionBank()).rejects.toThrow(QuestionBankError);
    await expect(fetchQuestionBank()).rejects.toThrow('entry at index 1 is not a string');
  });

  it('returns empty array for empty question bank', async () => {
    vi.stubGlobal('fetch', mockFetchSuccess([]));
    const result = await fetchQuestionBank();
    expect(result).toEqual([]);
  });
});

// ============================================================
// filterValidQuestions
// ============================================================

describe('filterValidQuestions', () => {
  it('returns all questions when all contain XYZ', () => {
    const result = filterValidQuestions(SAMPLE_QUESTIONS);
    expect(result.validQuestions).toEqual(SAMPLE_QUESTIONS);
    expect(result.validIndices).toEqual([0, 1, 2, 3, 4]);
  });

  it('filters out questions without XYZ', () => {
    const result = filterValidQuestions(MIXED_QUESTIONS);
    expect(result.validQuestions).toHaveLength(3);
    expect(result.validIndices).toEqual([0, 2, 4]);
    expect(result.validQuestions).toEqual([
      'What would XYZ bring to a deserted island?',
      'What is XYZ\'s secret talent?',
      'What would XYZ do if they were invisible for a day?',
    ]);
  });

  it('returns empty arrays when no questions contain XYZ', () => {
    const noXyz = ['Question one', 'Question two'];
    const result = filterValidQuestions(noXyz);
    expect(result.validQuestions).toEqual([]);
    expect(result.validIndices).toEqual([]);
  });

  it('returns empty arrays for empty input', () => {
    const result = filterValidQuestions([]);
    expect(result.validQuestions).toEqual([]);
    expect(result.validIndices).toEqual([]);
  });

  it('is case-sensitive for XYZ (lowercase xyz not matched)', () => {
    const questions = ['What would xyz do?', 'What would XYZ do?'];
    const result = filterValidQuestions(questions);
    expect(result.validQuestions).toEqual(['What would XYZ do?']);
    expect(result.validIndices).toEqual([1]);
  });
});

// ============================================================
// selectQuestionsForGame
// ============================================================

describe('selectQuestionsForGame', () => {
  it('selects the correct number of questions', () => {
    const indices = [0, 1, 2, 3, 4];
    const result = selectQuestionsForGame(indices, 3);
    expect(result).toHaveLength(3);
  });

  it('selects unique questions (no repetition)', () => {
    const indices = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const result = selectQuestionsForGame(indices, 5);
    const unique = new Set(result);
    expect(unique.size).toBe(5);
  });

  it('only selects from provided indices', () => {
    const indices = [2, 5, 8, 11, 14];
    const result = selectQuestionsForGame(indices, 3);
    for (const idx of result) {
      expect(indices).toContain(idx);
    }
  });

  it('throws QuestionBankError when insufficient questions', () => {
    const indices = [0, 1, 2];
    expect(() => selectQuestionsForGame(indices, 5)).toThrow(QuestionBankError);
    expect(() => selectQuestionsForGame(indices, 5)).toThrow('Insufficient questions');
  });

  it('works when roundCount equals available questions', () => {
    const indices = [0, 1, 2, 3, 4];
    const result = selectQuestionsForGame(indices, 5);
    expect(result).toHaveLength(5);
    const unique = new Set(result);
    expect(unique.size).toBe(5);
  });

  it('does not mutate the input array', () => {
    const indices = [0, 1, 2, 3, 4];
    const original = [...indices];
    selectQuestionsForGame(indices, 3);
    expect(indices).toEqual(original);
  });
});

// ============================================================
// randomizeFeaturedOrder
// ============================================================

describe('randomizeFeaturedOrder', () => {
  it('returns array of same length', () => {
    const ids = ['p1', 'p2', 'p3', 'p4'];
    const result = randomizeFeaturedOrder(ids);
    expect(result).toHaveLength(4);
  });

  it('contains all original player IDs', () => {
    const ids = ['p1', 'p2', 'p3', 'p4', 'p5'];
    const result = randomizeFeaturedOrder(ids);
    expect(result.sort()).toEqual([...ids].sort());
  });

  it('does not mutate the input array', () => {
    const ids = ['p1', 'p2', 'p3', 'p4'];
    const original = [...ids];
    randomizeFeaturedOrder(ids);
    expect(ids).toEqual(original);
  });

  it('handles single player', () => {
    const ids = ['p1'];
    const result = randomizeFeaturedOrder(ids);
    expect(result).toEqual(['p1']);
  });

  it('handles empty array', () => {
    const result = randomizeFeaturedOrder([]);
    expect(result).toEqual([]);
  });
});

// ============================================================
// substitutePlayerName
// ============================================================

describe('substitutePlayerName', () => {
  it('replaces single XYZ occurrence', () => {
    const result = substitutePlayerName('What would XYZ do?', 'Alice');
    expect(result).toBe('What would Alice do?');
  });

  it('replaces multiple XYZ occurrences', () => {
    const result = substitutePlayerName('XYZ met XYZ at XYZ\'s house', 'Bob');
    expect(result).toBe('Bob met Bob at Bob\'s house');
  });

  it('returns original string if no XYZ present', () => {
    const result = substitutePlayerName('No placeholder here', 'Alice');
    expect(result).toBe('No placeholder here');
  });

  it('handles empty player name', () => {
    const result = substitutePlayerName('What would XYZ do?', '');
    expect(result).toBe('What would  do?');
  });

  it('handles player name with special characters', () => {
    const result = substitutePlayerName('What would XYZ do?', 'O\'Brien');
    expect(result).toBe('What would O\'Brien do?');
  });
});

// ============================================================
// prepareGameStart
// ============================================================

describe('prepareGameStart', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetchSuccess(SAMPLE_QUESTIONS));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('prepares game start with valid inputs', async () => {
    const settings = createSettings();
    const players = [
      createPlayer('p1', 'Alice', true, 1),
      createPlayer('p2', 'Bob', false, 2),
      createPlayer('p3', 'Charlie', false, 3),
      createPlayer('p4', 'Diana', false, 4),
    ];

    const result = await prepareGameStart(settings, players);

    expect(result.totalRounds).toBe(4);
    expect(result.questions).toHaveLength(4);
    expect(result.featuredOrder).toHaveLength(4);
    expect(result.questionTexts).toHaveLength(4);

    // All selected questions should be unique
    const uniqueQuestions = new Set(result.questions);
    expect(uniqueQuestions.size).toBe(4);

    // Featured order should contain all player IDs
    expect(result.featuredOrder.sort()).toEqual(['p1', 'p2', 'p3', 'p4']);
  });

  it('throws when not enough players', async () => {
    const settings = createSettings({ minPlayers: 4 });
    const players = [
      createPlayer('p1', 'Alice', true, 1),
      createPlayer('p2', 'Bob', false, 2),
    ];

    await expect(prepareGameStart(settings, players)).rejects.toThrow(QuestionBankError);
    await expect(prepareGameStart(settings, players)).rejects.toThrow('Not enough players');
  });

  it('excludes disconnected players', async () => {
    const settings = createSettings({ minPlayers: 3 });
    const players = [
      createPlayer('p1', 'Alice', true, 1),
      createPlayer('p2', 'Bob', false, 2),
      { ...createPlayer('p3', 'Charlie', false, 3), isConnected: false },
      createPlayer('p4', 'Diana', false, 4),
    ];

    const result = await prepareGameStart(settings, players);

    // Only 3 connected players
    expect(result.totalRounds).toBe(3);
    expect(result.featuredOrder).toHaveLength(3);
    expect(result.featuredOrder).not.toContain('p3');
  });

  it('throws when question bank has insufficient valid questions', async () => {
    // Only 2 valid questions but need 4 rounds
    vi.stubGlobal('fetch', mockFetchSuccess([
      'What would XYZ do?',
      'No placeholder here',
      'What is XYZ\'s talent?',
      'Another without placeholder',
    ]));

    const settings = createSettings({ minPlayers: 4 });
    const players = [
      createPlayer('p1', 'Alice', true, 1),
      createPlayer('p2', 'Bob', false, 2),
      createPlayer('p3', 'Charlie', false, 3),
      createPlayer('p4', 'Diana', false, 4),
    ];

    await expect(prepareGameStart(settings, players)).rejects.toThrow(QuestionBankError);
    await expect(prepareGameStart(settings, players)).rejects.toThrow('Insufficient questions');
  });

  it('propagates fetch errors', async () => {
    vi.stubGlobal('fetch', mockFetchNetworkError());

    const settings = createSettings({ minPlayers: 3 });
    const players = [
      createPlayer('p1', 'Alice', true, 1),
      createPlayer('p2', 'Bob', false, 2),
      createPlayer('p3', 'Charlie', false, 3),
    ];

    await expect(prepareGameStart(settings, players)).rejects.toThrow(QuestionBankError);
  });
});

// ============================================================
// buildGameStartMessage
// ============================================================

describe('buildGameStartMessage', () => {
  it('builds correct GameStartMessage', () => {
    const settings = createSettings();
    const preparation = {
      questions: [0, 2, 4, 1],
      featuredOrder: ['p3', 'p1', 'p4', 'p2'],
      totalRounds: 4,
      questionTexts: [
        'What would XYZ bring to a deserted island?',
        'What would XYZ\'s autobiography be titled?',
        'What would XYZ do if they were invisible for a day?',
        'What is XYZ\'s secret talent?',
      ],
    };

    const message = buildGameStartMessage(preparation, settings);

    expect(message).toEqual({
      type: 'game_start',
      settings,
      questions: [0, 2, 4, 1],
      featuredPlayerOrder: ['p3', 'p1', 'p4', 'p2'],
      totalRounds: 4,
    });
  });
});
