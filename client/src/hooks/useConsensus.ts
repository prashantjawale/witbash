import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  GameState,
  GamePhase,
  WebSocketMessage,
  StateHashMessage,
  StateRequestMessage,
  FullStateMessage,
} from '../types';
import { computeStateHash } from '../utils/hashState';

export type ConsensusStatus = 'pending' | 'agreed' | 'diverged' | 'corrected';

export interface UseConsensusOptions {
  /** Current game state (null if no game active) */
  gameState: GameState | null;
  /** Local player ID */
  playerId: string;
  /** Whether the local player is the host */
  isHost: boolean;
  /** Total connected player count in the room */
  connectedPlayerCount: number;
  /** Send a WebSocket message */
  send: (message: WebSocketMessage) => void;
  /** Last received WebSocket message (for listening to hash/state messages) */
  lastMessage: WebSocketMessage | null;
  /** Callback to apply corrected state */
  onStateCorrection: (state: GameState) => void;
}

export interface UseConsensusReturn {
  /** Trigger hash computation and broadcast at a phase boundary */
  broadcastHash: () => void;
  /** Current consensus status */
  consensusStatus: ConsensusStatus;
}

/** Time window (ms) to collect hashes from other clients */
const CONSENSUS_WINDOW_MS = 5000;

/**
 * Determines majority consensus from collected hashes.
 * Returns the majority hash if >50% of expected clients agree, or null.
 */
export function findMajorityHash(
  hashes: Map<string, string>,
  totalExpected: number
): string | null {
  const hashCounts = new Map<string, number>();

  for (const hash of hashes.values()) {
    hashCounts.set(hash, (hashCounts.get(hash) ?? 0) + 1);
  }

  const majorityThreshold = totalExpected / 2;

  for (const [hash, count] of hashCounts.entries()) {
    if (count > majorityThreshold) {
      return hash;
    }
  }

  return null;
}

/**
 * useConsensus hook — computes and broadcasts state hashes at phase boundaries,
 * collects hashes from other clients, determines majority consensus,
 * and triggers state correction when the local client diverges.
 *
 * Requirements: 12.1, 12.2, 12.3, 12.4
 */
export function useConsensus(options: UseConsensusOptions): UseConsensusReturn {
  const {
    gameState,
    playerId,
    isHost,
    connectedPlayerCount,
    send,
    lastMessage,
    onStateCorrection,
  } = options;

  const [consensusStatus, setConsensusStatus] = useState<ConsensusStatus>('pending');

  // Collected hashes: playerId → hash
  const collectedHashesRef = useRef<Map<string, string>>(new Map());
  // Timer for the consensus window
  const windowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Local hash for the current phase boundary
  const localHashRef = useRef<string | null>(null);
  // Track the phase + round we're collecting for
  const collectingForRef = useRef<{ phase: GamePhase; round: number } | null>(null);
  // Whether we've already requested state correction for this phase
  const correctionRequestedRef = useRef(false);

  /**
   * Clean up the consensus window timer.
   */
  const clearWindowTimer = useCallback(() => {
    if (windowTimerRef.current !== null) {
      clearTimeout(windowTimerRef.current);
      windowTimerRef.current = null;
    }
  }, []);

  /**
   * Resolve consensus after the collection window expires.
   */
  const resolveConsensus = useCallback(() => {
    const hashes = collectedHashesRef.current;
    const localHash = localHashRef.current;

    if (!localHash || !gameState) return;

    // Include our own hash in the collection
    hashes.set(playerId, localHash);

    const majorityHash = findMajorityHash(hashes, connectedPlayerCount);

    if (majorityHash !== null) {
      // Majority reached
      if (localHash === majorityHash) {
        // We agree with the majority
        setConsensusStatus('agreed');
      } else {
        // We diverge — request full state from a client with the majority hash
        setConsensusStatus('diverged');
        requestStateFromMajority(hashes, majorityHash);
      }
    } else {
      // No majority — fall back to host state (Requirement 12.4)
      if (isHost) {
        // We are the host, our state is authoritative
        setConsensusStatus('agreed');
      } else {
        // Request state from host
        setConsensusStatus('diverged');
        requestStateFromHost();
      }
    }

    // Reset collection
    collectedHashesRef.current = new Map();
    collectingForRef.current = null;
  }, [gameState, playerId, connectedPlayerCount, isHost]);

  /**
   * Request full state from a client holding the majority hash.
   */
  const requestStateFromMajority = useCallback(
    (hashes: Map<string, string>, majorityHash: string) => {
      if (correctionRequestedRef.current) return;
      correctionRequestedRef.current = true;

      // Find a player with the majority hash (prefer host if they have it)
      let targetId: string | null = null;
      for (const [pid, hash] of hashes.entries()) {
        if (hash === majorityHash && pid !== playerId) {
          targetId = pid;
          break;
        }
      }

      if (targetId) {
        const request: StateRequestMessage = {
          type: 'state_request',
          requesterId: playerId,
          targetId,
        };
        send(request);
      }
    },
    [playerId, send]
  );

  /**
   * Request full state from the host player (fallback when no majority).
   */
  const requestStateFromHost = useCallback(() => {
    if (correctionRequestedRef.current) return;
    correctionRequestedRef.current = true;

    // We don't know the host's playerId directly here, so we broadcast
    // a state_request with targetId empty — the host will respond.
    // Actually, per protocol, we broadcast to room and host responds.
    // We'll use a special convention: targetId = 'host'
    // But looking at the protocol, state_request has a targetId field.
    // We need to find the host. Since we don't have the player list here,
    // we'll broadcast a request and rely on the host responding.
    const request: StateRequestMessage = {
      type: 'state_request',
      requesterId: playerId,
      targetId: 'host', // Convention: host will respond to requests targeting 'host'
    };
    send(request);
  }, [playerId, send]);

  /**
   * Broadcast the current state hash to all other clients.
   * Called at phase boundaries.
   */
  const broadcastHash = useCallback(async () => {
    if (!gameState) return;

    // Reset state for new consensus round
    correctionRequestedRef.current = false;
    collectedHashesRef.current = new Map();
    setConsensusStatus('pending');

    const hash = await computeStateHash(gameState);
    localHashRef.current = hash;
    collectingForRef.current = {
      phase: gameState.phase,
      round: gameState.currentRound,
    };

    // Broadcast our hash
    const message: StateHashMessage = {
      type: 'state_hash',
      playerId,
      hash,
      phase: gameState.phase,
      roundNumber: gameState.currentRound,
    };
    send(message);

    // Start the collection window timer
    clearWindowTimer();
    windowTimerRef.current = setTimeout(() => {
      resolveConsensus();
    }, CONSENSUS_WINDOW_MS);
  }, [gameState, playerId, send, clearWindowTimer, resolveConsensus]);

  /**
   * Handle incoming messages related to consensus.
   */
  useEffect(() => {
    if (!lastMessage || !gameState) return;

    const msg = lastMessage;

    // Handle state_hash messages from other clients
    if (msg.type === 'state_hash') {
      const hashMsg = msg as StateHashMessage;

      // Only collect if we're in a consensus window for the same phase/round
      const collecting = collectingForRef.current;
      if (
        collecting &&
        hashMsg.phase === collecting.phase &&
        hashMsg.roundNumber === collecting.round &&
        hashMsg.playerId !== playerId
      ) {
        collectedHashesRef.current.set(hashMsg.playerId, hashMsg.hash);
      }
    }

    // Handle state_request messages (respond if we're the target or host)
    if (msg.type === 'state_request') {
      const reqMsg = msg as StateRequestMessage;

      const shouldRespond =
        reqMsg.targetId === playerId || (reqMsg.targetId === 'host' && isHost);

      if (shouldRespond && gameState) {
        const response: FullStateMessage = {
          type: 'full_state',
          senderId: playerId,
          targetId: reqMsg.requesterId,
          state: gameState,
        };
        send(response);
      }
    }

    // Handle full_state messages (apply if targeted at us)
    if (msg.type === 'full_state') {
      const stateMsg = msg as FullStateMessage;

      if (stateMsg.targetId === playerId) {
        onStateCorrection(stateMsg.state);
        setConsensusStatus('corrected');
        correctionRequestedRef.current = false;
      }
    }
  }, [lastMessage, gameState, playerId, isHost, send, onStateCorrection]);

  /**
   * Cleanup on unmount.
   */
  useEffect(() => {
    return () => {
      clearWindowTimer();
    };
  }, [clearWindowTimer]);

  return {
    broadcastHash,
    consensusStatus,
  };
}
