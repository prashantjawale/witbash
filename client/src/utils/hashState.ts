import type { GameState, GamePhase } from '../types';

/**
 * Hashable subset of game state used for consensus verification.
 * Keys are sorted alphabetically before serialization to ensure
 * deterministic output across all clients.
 */
export interface HashableState {
  answers: Record<string, string>;
  phase: GamePhase;
  roundNumber: number;
  scores: Record<string, number>;
  votes: Record<string, string>;
}

/**
 * Sort object keys alphabetically (recursive for nested objects).
 * Ensures deterministic JSON serialization regardless of insertion order.
 */
export function sortObjectKeys<T>(obj: T): T {
  if (obj === null || obj === undefined || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(sortObjectKeys) as unknown as T;
  }

  const sorted: Record<string, unknown> = {};
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  for (const key of keys) {
    sorted[key] = sortObjectKeys((obj as Record<string, unknown>)[key]);
  }
  return sorted as T;
}

/**
 * Extract the hashable subset from a full GameState.
 * Only includes fields relevant for consensus verification.
 */
export function extractHashableState(gameState: GameState): HashableState {
  return {
    answers: gameState.currentRoundState.answers,
    phase: gameState.phase,
    roundNumber: gameState.currentRound,
    scores: gameState.scores,
    votes: gameState.currentRoundState.votes,
  };
}

/**
 * Serialize a hashable state deterministically.
 * All object keys are sorted alphabetically before JSON stringification.
 */
export function serializeState(hashableState: HashableState): string {
  const sorted = sortObjectKeys(hashableState);
  return JSON.stringify(sorted);
}

/**
 * Compute SHA-256 hash of a game state.
 * Uses the Web Crypto API (available in all modern browsers).
 * Returns a hex-encoded hash string.
 */
export async function computeStateHash(gameState: GameState): Promise<string> {
  const hashable = extractHashableState(gameState);
  const serialized = serializeState(hashable);
  const encoded = new TextEncoder().encode(serialized);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Synchronous version that returns the serialized string for testing.
 * Useful when you need the deterministic serialization without hashing.
 */
export function serializeGameState(gameState: GameState): string {
  const hashable = extractHashableState(gameState);
  return serializeState(hashable);
}
