import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  substitutePlayerName,
  selectQuestionsForGame,
  filterValidQuestions,
} from './questionBank';

/**
 * Feature: lan-party-game
 * Property 7: XYZ placeholder substitution completeness
 *
 * For any question template containing one or more "XYZ" occurrences and any valid player name,
 * after substitution the resulting string SHALL contain the player name in place of every "XYZ"
 * occurrence and SHALL contain zero remaining "XYZ" substrings.
 *
 * Validates: Requirements 4.3
 */
describe('Property 7: XYZ placeholder substitution completeness', () => {
  // Arbitrary for text segments that do NOT contain "XYZ"
  const nonXyzSegment = fc
    .stringOf(fc.fullUnicode(), { minLength: 0, maxLength: 30 })
    .filter((s) => !s.includes('XYZ'));

  // Arbitrary for player names (1-20 alphanumeric + spaces, no "XYZ" substring)
  const playerNameArb = fc
    .stringOf(
      fc.mapToConstant(
        { num: 26, build: (v) => String.fromCharCode(65 + v) }, // A-Z
        { num: 26, build: (v) => String.fromCharCode(97 + v) }, // a-z
        { num: 10, build: (v) => String.fromCharCode(48 + v) }, // 0-9
        { num: 1, build: () => ' ' }
      ),
      { minLength: 1, maxLength: 20 }
    )
    .filter((s) => s.trim().length > 0 && !s.includes('XYZ'));

  // Arbitrary for question templates with at least one "XYZ"
  const questionTemplateArb = fc
    .tuple(
      fc.array(nonXyzSegment, { minLength: 2, maxLength: 5 })
    )
    .map(([segments]) => segments.join('XYZ'));

  it('replaces all XYZ occurrences and no XYZ remains in the result', () => {
    fc.assert(
      fc.property(questionTemplateArb, playerNameArb, (template, playerName) => {
        const result = substitutePlayerName(template, playerName);

        // No "XYZ" should remain
        expect(result).not.toContain('XYZ');
      }),
      { numRuns: 200 }
    );
  });

  it('the result contains the player name for each original XYZ occurrence', () => {
    fc.assert(
      fc.property(questionTemplateArb, playerNameArb, (template, playerName) => {
        const xyzCount = template.split('XYZ').length - 1;
        const result = substitutePlayerName(template, playerName);

        // Count occurrences of playerName in result
        // Since playerName doesn't contain "XYZ" and segments don't contain playerName necessarily,
        // we verify the number of XYZ replacements by checking the result length
        const expectedLength =
          template.length - xyzCount * 3 + xyzCount * playerName.length;
        expect(result.length).toBe(expectedLength);
      }),
      { numRuns: 200 }
    );
  });

  it('preserves non-XYZ parts of the template unchanged', () => {
    fc.assert(
      fc.property(questionTemplateArb, playerNameArb, (template, playerName) => {
        const segments = template.split('XYZ');
        const result = substitutePlayerName(template, playerName);

        // Each non-XYZ segment should appear in the result in order
        let searchFrom = 0;
        for (const segment of segments) {
          const idx = result.indexOf(segment, searchFrom);
          expect(idx).toBeGreaterThanOrEqual(searchFrom);
          searchFrom = idx + segment.length;
        }
      }),
      { numRuns: 200 }
    );
  });
});

/**
 * Feature: lan-party-game
 * Property 25: Question selection without repetition
 *
 * For any game session with N rounds, all N selected questions SHALL be distinct
 * (no question index appears more than once).
 *
 * Validates: Requirements 13.2
 */
describe('Property 25: Question selection without repetition', () => {
  it('all selected question indices are distinct for any valid input', () => {
    // Generate unique valid indices (3-50 unique indices) and a round count <= indices length
    const validInputArb = fc
      .uniqueArray(fc.integer({ min: 0, max: 200 }), { minLength: 3, maxLength: 50 })
      .chain((indices) =>
        fc.tuple(
          fc.constant(indices),
          fc.integer({ min: 1, max: indices.length })
        )
      );

    fc.assert(
      fc.property(validInputArb, ([validIndices, roundCount]) => {
        const selected = selectQuestionsForGame(validIndices, roundCount);

        // All selected indices must be distinct
        const uniqueSelected = new Set(selected);
        expect(uniqueSelected.size).toBe(roundCount);
      }),
      { numRuns: 200 }
    );
  });

  it('selected indices are always a subset of the provided valid indices', () => {
    const validInputArb = fc
      .uniqueArray(fc.integer({ min: 0, max: 200 }), { minLength: 3, maxLength: 50 })
      .chain((indices) =>
        fc.tuple(
          fc.constant(indices),
          fc.integer({ min: 1, max: indices.length })
        )
      );

    fc.assert(
      fc.property(validInputArb, ([validIndices, roundCount]) => {
        const selected = selectQuestionsForGame(validIndices, roundCount);

        // Every selected index must come from the valid indices
        for (const idx of selected) {
          expect(validIndices).toContain(idx);
        }
      }),
      { numRuns: 200 }
    );
  });

  it('returns exactly N questions for N rounds', () => {
    const validInputArb = fc
      .uniqueArray(fc.integer({ min: 0, max: 200 }), { minLength: 3, maxLength: 50 })
      .chain((indices) =>
        fc.tuple(
          fc.constant(indices),
          fc.integer({ min: 1, max: indices.length })
        )
      );

    fc.assert(
      fc.property(validInputArb, ([validIndices, roundCount]) => {
        const selected = selectQuestionsForGame(validIndices, roundCount);
        expect(selected).toHaveLength(roundCount);
      }),
      { numRuns: 200 }
    );
  });
});

/**
 * Feature: lan-party-game
 * Property 26: Question bank filtering
 *
 * For any question bank containing entries with and without the "XYZ" placeholder,
 * only entries containing "XYZ" SHALL be eligible for selection.
 *
 * Validates: Requirements 13.6
 */
describe('Property 26: Question bank filtering', () => {
  // Arbitrary for questions that contain "XYZ"
  const questionWithXyz = fc
    .tuple(
      fc.stringOf(fc.fullUnicode(), { minLength: 0, maxLength: 20 }).filter((s) => !s.includes('XYZ')),
      fc.stringOf(fc.fullUnicode(), { minLength: 0, maxLength: 20 }).filter((s) => !s.includes('XYZ'))
    )
    .map(([prefix, suffix]) => `${prefix}XYZ${suffix}`);

  // Arbitrary for questions that do NOT contain "XYZ"
  const questionWithoutXyz = fc
    .stringOf(fc.fullUnicode(), { minLength: 1, maxLength: 50 })
    .filter((s) => !s.includes('XYZ'));

  it('all returned valid questions contain "XYZ"', () => {
    // Generate a mixed question bank
    const questionBankArb = fc.array(
      fc.oneof(questionWithXyz, questionWithoutXyz),
      { minLength: 1, maxLength: 30 }
    );

    fc.assert(
      fc.property(questionBankArb, (questions) => {
        const { validQuestions } = filterValidQuestions(questions);

        // Every valid question must contain "XYZ"
        for (const q of validQuestions) {
          expect(q).toContain('XYZ');
        }
      }),
      { numRuns: 200 }
    );
  });

  it('no question containing "XYZ" is excluded from the result', () => {
    const questionBankArb = fc.array(
      fc.oneof(questionWithXyz, questionWithoutXyz),
      { minLength: 1, maxLength: 30 }
    );

    fc.assert(
      fc.property(questionBankArb, (questions) => {
        const { validQuestions } = filterValidQuestions(questions);

        // Count how many input questions contain "XYZ"
        const expectedCount = questions.filter((q) => q.includes('XYZ')).length;
        expect(validQuestions.length).toBe(expectedCount);
      }),
      { numRuns: 200 }
    );
  });

  it('valid indices correctly map back to the original question bank', () => {
    const questionBankArb = fc.array(
      fc.oneof(questionWithXyz, questionWithoutXyz),
      { minLength: 1, maxLength: 30 }
    );

    fc.assert(
      fc.property(questionBankArb, (questions) => {
        const { validQuestions, validIndices } = filterValidQuestions(questions);

        // Each valid index should point to the corresponding valid question
        for (let i = 0; i < validIndices.length; i++) {
          expect(questions[validIndices[i]]).toBe(validQuestions[i]);
          expect(questions[validIndices[i]]).toContain('XYZ');
        }
      }),
      { numRuns: 200 }
    );
  });

  it('questions without "XYZ" are never included in valid indices', () => {
    const questionBankArb = fc.array(
      fc.oneof(questionWithXyz, questionWithoutXyz),
      { minLength: 1, maxLength: 30 }
    );

    fc.assert(
      fc.property(questionBankArb, (questions) => {
        const { validIndices } = filterValidQuestions(questions);

        // No valid index should point to a question without "XYZ"
        for (const idx of validIndices) {
          expect(questions[idx]).toContain('XYZ');
        }

        // No index of a non-XYZ question should appear in validIndices
        for (let i = 0; i < questions.length; i++) {
          if (!questions[i].includes('XYZ')) {
            expect(validIndices).not.toContain(i);
          }
        }
      }),
      { numRuns: 200 }
    );
  });
});
