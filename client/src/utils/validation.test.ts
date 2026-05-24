import { describe, it, expect } from 'vitest';
import {
  validatePort,
  validatePlayerName,
  isPlayerNameUnique,
  generateRoomCode,
  validateRoomCode,
  validateAnswer,
  validateGameSettings,
} from './validation';

describe('validatePort', () => {
  it('accepts valid port numbers', () => {
    expect(validatePort(1024)).toEqual({ valid: true, message: '' });
    expect(validatePort(3000)).toEqual({ valid: true, message: '' });
    expect(validatePort(65535)).toEqual({ valid: true, message: '' });
  });

  it('rejects ports below 1024', () => {
    expect(validatePort(0).valid).toBe(false);
    expect(validatePort(80).valid).toBe(false);
    expect(validatePort(1023).valid).toBe(false);
  });

  it('rejects ports above 65535', () => {
    expect(validatePort(65536).valid).toBe(false);
    expect(validatePort(100000).valid).toBe(false);
  });

  it('rejects non-integer values', () => {
    expect(validatePort(3000.5).valid).toBe(false);
    expect(validatePort(NaN).valid).toBe(false);
    expect(validatePort(Infinity).valid).toBe(false);
  });

  it('rejects non-number types', () => {
    expect(validatePort(null).valid).toBe(false);
    expect(validatePort(undefined).valid).toBe(false);
    expect(validatePort('abc').valid).toBe(false);
  });

  it('accepts valid port as string', () => {
    expect(validatePort('3000')).toEqual({ valid: true, message: '' });
    expect(validatePort('1024')).toEqual({ valid: true, message: '' });
  });

  it('rejects invalid port as string', () => {
    expect(validatePort('80').valid).toBe(false);
    expect(validatePort('3000.5').valid).toBe(false);
  });
});

describe('validatePlayerName', () => {
  it('accepts valid names', () => {
    expect(validatePlayerName('Alice').valid).toBe(true);
    expect(validatePlayerName('Player 1').valid).toBe(true);
    expect(validatePlayerName('A').valid).toBe(true);
    expect(validatePlayerName('12345678901234567890').valid).toBe(true); // 20 chars
  });

  it('rejects empty names', () => {
    expect(validatePlayerName('').valid).toBe(false);
  });

  it('rejects names longer than 20 characters', () => {
    expect(validatePlayerName('123456789012345678901').valid).toBe(false); // 21 chars
  });

  it('rejects names with special characters', () => {
    expect(validatePlayerName('Alice!').valid).toBe(false);
    expect(validatePlayerName('Bob@home').valid).toBe(false);
    expect(validatePlayerName('test_name').valid).toBe(false);
  });

  it('rejects whitespace-only names', () => {
    expect(validatePlayerName('   ').valid).toBe(false);
  });

  it('accepts names with spaces between alphanumeric chars', () => {
    expect(validatePlayerName('John Doe').valid).toBe(true);
    expect(validatePlayerName('Player 42').valid).toBe(true);
  });
});

describe('isPlayerNameUnique', () => {
  it('returns true when name is unique', () => {
    expect(isPlayerNameUnique('Alice', ['Bob', 'Charlie'])).toBe(true);
  });

  it('returns false when name matches exactly', () => {
    expect(isPlayerNameUnique('Alice', ['Alice', 'Bob'])).toBe(false);
  });

  it('returns false for case-insensitive match', () => {
    expect(isPlayerNameUnique('alice', ['Alice', 'Bob'])).toBe(false);
    expect(isPlayerNameUnique('ALICE', ['alice', 'Bob'])).toBe(false);
    expect(isPlayerNameUnique('AlIcE', ['aLiCe'])).toBe(false);
  });

  it('returns true for empty existing names list', () => {
    expect(isPlayerNameUnique('Alice', [])).toBe(true);
  });
});

describe('generateRoomCode', () => {
  it('generates a 4-character code', () => {
    const code = generateRoomCode();
    expect(code).toHaveLength(4);
  });

  it('generates only uppercase alphanumeric characters', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateRoomCode();
      expect(code).toMatch(/^[A-Z0-9]{4}$/);
    }
  });
});

describe('validateRoomCode', () => {
  it('accepts valid room codes', () => {
    expect(validateRoomCode('ABCD').valid).toBe(true);
    expect(validateRoomCode('1234').valid).toBe(true);
    expect(validateRoomCode('A1B2').valid).toBe(true);
  });

  it('rejects empty codes', () => {
    expect(validateRoomCode('').valid).toBe(false);
  });

  it('rejects codes with wrong length', () => {
    expect(validateRoomCode('ABC').valid).toBe(false);
    expect(validateRoomCode('ABCDE').valid).toBe(false);
  });

  it('rejects lowercase characters', () => {
    expect(validateRoomCode('abcd').valid).toBe(false);
    expect(validateRoomCode('Abcd').valid).toBe(false);
  });

  it('rejects special characters', () => {
    expect(validateRoomCode('AB!D').valid).toBe(false);
    expect(validateRoomCode('AB D').valid).toBe(false);
  });
});

describe('validateAnswer', () => {
  it('accepts valid answers', () => {
    expect(validateAnswer('Hello').valid).toBe(true);
    expect(validateAnswer('A').valid).toBe(true);
    expect(validateAnswer('a'.repeat(280)).valid).toBe(true);
  });

  it('rejects empty answers', () => {
    expect(validateAnswer('').valid).toBe(false);
  });

  it('rejects answers longer than 280 characters', () => {
    expect(validateAnswer('a'.repeat(281)).valid).toBe(false);
  });

  it('rejects whitespace-only answers', () => {
    expect(validateAnswer('   ').valid).toBe(false);
    expect(validateAnswer('\t\n').valid).toBe(false);
  });

  it('accepts answers with leading/trailing whitespace if non-whitespace exists', () => {
    expect(validateAnswer('  hello  ').valid).toBe(true);
  });
});

describe('validateGameSettings', () => {
  it('accepts valid default settings', () => {
    const result = validateGameSettings({
      minPlayers: 4,
      maxPlayers: 7,
      answerTimerSeconds: 60,
      votingTimerSeconds: 30,
    });
    expect(result.valid).toBe(true);
  });

  it('accepts edge case valid settings', () => {
    expect(
      validateGameSettings({
        minPlayers: 3,
        maxPlayers: 3,
        answerTimerSeconds: 10,
        votingTimerSeconds: 10,
      }).valid
    ).toBe(true);

    expect(
      validateGameSettings({
        minPlayers: 10,
        maxPlayers: 10,
        answerTimerSeconds: 300,
        votingTimerSeconds: 300,
      }).valid
    ).toBe(true);
  });

  it('rejects minPlayers below 3', () => {
    expect(
      validateGameSettings({
        minPlayers: 2,
        maxPlayers: 7,
        answerTimerSeconds: 60,
        votingTimerSeconds: 30,
      }).valid
    ).toBe(false);
  });

  it('rejects minPlayers greater than maxPlayers', () => {
    expect(
      validateGameSettings({
        minPlayers: 8,
        maxPlayers: 7,
        answerTimerSeconds: 60,
        votingTimerSeconds: 30,
      }).valid
    ).toBe(false);
  });

  it('rejects maxPlayers above 10', () => {
    expect(
      validateGameSettings({
        minPlayers: 3,
        maxPlayers: 11,
        answerTimerSeconds: 60,
        votingTimerSeconds: 30,
      }).valid
    ).toBe(false);
  });

  it('rejects answerTimerSeconds below 10', () => {
    expect(
      validateGameSettings({
        minPlayers: 4,
        maxPlayers: 7,
        answerTimerSeconds: 9,
        votingTimerSeconds: 30,
      }).valid
    ).toBe(false);
  });

  it('rejects answerTimerSeconds above 300', () => {
    expect(
      validateGameSettings({
        minPlayers: 4,
        maxPlayers: 7,
        answerTimerSeconds: 301,
        votingTimerSeconds: 30,
      }).valid
    ).toBe(false);
  });

  it('rejects votingTimerSeconds below 10', () => {
    expect(
      validateGameSettings({
        minPlayers: 4,
        maxPlayers: 7,
        answerTimerSeconds: 60,
        votingTimerSeconds: 9,
      }).valid
    ).toBe(false);
  });

  it('rejects votingTimerSeconds above 300', () => {
    expect(
      validateGameSettings({
        minPlayers: 4,
        maxPlayers: 7,
        answerTimerSeconds: 60,
        votingTimerSeconds: 301,
      }).valid
    ).toBe(false);
  });

  it('rejects non-integer values', () => {
    expect(
      validateGameSettings({
        minPlayers: 4.5,
        maxPlayers: 7,
        answerTimerSeconds: 60,
        votingTimerSeconds: 30,
      }).valid
    ).toBe(false);
  });
});
