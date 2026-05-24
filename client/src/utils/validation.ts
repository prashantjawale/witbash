import type { GameSettings } from '../types';

// ============================================================
// Validation Result Type
// ============================================================

export interface ValidationResult {
  valid: boolean;
  message: string;
}

// ============================================================
// Port Validation
// ============================================================

/**
 * Validates that a port value is a valid integer in the range 1024–65535.
 */
export function validatePort(port: unknown): ValidationResult {
  if (typeof port === 'string') {
    const parsed = Number(port);
    if (!Number.isInteger(parsed)) {
      return { valid: false, message: 'Port must be a valid integer' };
    }
    return validatePort(parsed);
  }

  if (typeof port !== 'number' || !Number.isInteger(port)) {
    return { valid: false, message: 'Port must be a valid integer' };
  }

  if (port < 1024 || port > 65535) {
    return { valid: false, message: 'Port must be between 1024 and 65535' };
  }

  return { valid: true, message: '' };
}

// ============================================================
// Player Name Validation
// ============================================================

/**
 * Validates a player name: 1–20 characters, alphanumeric + spaces, non-empty.
 */
export function validatePlayerName(name: string): ValidationResult {
  if (typeof name !== 'string' || name.length === 0) {
    return { valid: false, message: 'Player name is required' };
  }

  if (name.length > 20) {
    return { valid: false, message: 'Player name must be 20 characters or fewer' };
  }

  if (!/^[a-zA-Z0-9 ]+$/.test(name)) {
    return { valid: false, message: 'Player name must contain only letters, numbers, and spaces' };
  }

  if (name.trim().length === 0) {
    return { valid: false, message: 'Player name must contain at least one non-space character' };
  }

  return { valid: true, message: '' };
}

/**
 * Checks if a player name is unique among existing players (case-insensitive).
 */
export function isPlayerNameUnique(name: string, existingNames: string[]): boolean {
  const lowerName = name.toLowerCase();
  return !existingNames.some((existing) => existing.toLowerCase() === lowerName);
}

// ============================================================
// Room Code Generation & Validation
// ============================================================

const ROOM_CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const ROOM_CODE_LENGTH = 4;

/**
 * Generates a random 4-character uppercase alphanumeric room code.
 */
export function generateRoomCode(): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    const index = Math.floor(Math.random() * ROOM_CODE_CHARS.length);
    code += ROOM_CODE_CHARS[index];
  }
  return code;
}

/**
 * Validates that a room code is exactly 4 uppercase alphanumeric characters.
 */
export function validateRoomCode(code: string): ValidationResult {
  if (typeof code !== 'string' || code.length === 0) {
    return { valid: false, message: 'Room code is required' };
  }

  if (code.length !== 4) {
    return { valid: false, message: 'Room code must be exactly 4 characters' };
  }

  if (!/^[A-Z0-9]{4}$/.test(code)) {
    return { valid: false, message: 'Room code must contain only uppercase letters and digits' };
  }

  return { valid: true, message: '' };
}

// ============================================================
// Answer Validation
// ============================================================

/**
 * Validates an answer: 1–280 characters, at least one non-whitespace character.
 */
export function validateAnswer(answer: string): ValidationResult {
  if (typeof answer !== 'string' || answer.length === 0) {
    return { valid: false, message: 'Answer is required' };
  }

  if (answer.length > 280) {
    return { valid: false, message: 'Answer must be 280 characters or fewer' };
  }

  if (answer.trim().length === 0) {
    return { valid: false, message: 'Answer must contain at least one non-whitespace character' };
  }

  return { valid: true, message: '' };
}

// ============================================================
// Game Settings Validation
// ============================================================

/**
 * Validates game settings:
 * - minPlayers: 3 to maxPlayers
 * - maxPlayers: minPlayers to 10
 * - answerTimerSeconds: 10 to 300
 * - votingTimerSeconds: 10 to 300
 */
export function validateGameSettings(settings: GameSettings): ValidationResult {
  const { minPlayers, maxPlayers, answerTimerSeconds, votingTimerSeconds } = settings;

  if (!Number.isInteger(minPlayers) || minPlayers < 3 || minPlayers > maxPlayers) {
    return {
      valid: false,
      message: `Minimum players must be between 3 and ${maxPlayers}`,
    };
  }

  if (!Number.isInteger(maxPlayers) || maxPlayers < minPlayers || maxPlayers > 10) {
    return {
      valid: false,
      message: `Maximum players must be between ${minPlayers} and 10`,
    };
  }

  if (!Number.isInteger(answerTimerSeconds) || answerTimerSeconds < 10 || answerTimerSeconds > 300) {
    return {
      valid: false,
      message: 'Answer timer must be between 10 and 300 seconds',
    };
  }

  if (!Number.isInteger(votingTimerSeconds) || votingTimerSeconds < 10 || votingTimerSeconds > 300) {
    return {
      valid: false,
      message: 'Voting timer must be between 10 and 300 seconds',
    };
  }

  return { valid: true, message: '' };
}
