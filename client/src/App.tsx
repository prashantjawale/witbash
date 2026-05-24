import { useCallback, useEffect, useRef, useState } from 'react';
import { GameProvider, useGame } from './context/GameContext';
import { useWebSocket } from './hooks/useWebSocket';
import { messageToAction } from './utils/messageHandler';
import { JoinScreen } from './components/JoinScreen';
import { LobbyScreen } from './components/LobbyScreen';
import { AnswerScreen } from './components/AnswerScreen';
import { VotingScreen } from './components/VotingScreen';
import { ResultsScreen } from './components/ResultsScreen';
import { FinalLeaderboard } from './components/FinalLeaderboard';
import {
  ErrorOverlay,
  createConnectionError,
  type OverlayError,
} from './components/ErrorOverlay';
import type {
  Player,
  GameSettings,
  GameState,
  WebSocketMessage,
} from './types';

function getWebSocketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

/**
 * Substitutes XYZ placeholders in a question template.
 * - If the question has 1 XYZ: replaces all with the featured player's name.
 * - If the question has 2+ XYZ: first occurrence = featured player, second = random other player.
 */
function substituteQuestion(
  template: string,
  featuredName: string,
  allPlayers: Player[],
  featuredPlayerId: string
): string {
  const xyzCount = (template.match(/XYZ/g) || []).length;

  if (xyzCount <= 1) {
    return template.replaceAll('XYZ', featuredName);
  }

  // 2+ XYZ: first = featured player, second = random other player
  const otherPlayers = allPlayers.filter(p => p.id !== featuredPlayerId && p.isConnected);
  const randomOther = otherPlayers[Math.floor(Math.random() * otherPlayers.length)];
  const secondName = randomOther?.name ?? 'Someone';

  let replaced = 0;
  return template.replace(/XYZ/g, () => {
    replaced++;
    if (replaced === 1) return featuredName;
    return secondName;
  });
}

function AppInner() {
  const { state, dispatch } = useGame();
  const [localPlayerId, setLocalPlayerId] = useState<string>('');
  const [roomCode, setRoomCode] = useState<string>('');
  const [errors, setErrors] = useState<OverlayError[]>([]);
  const [joined, setJoined] = useState(false);
  const [selectedQuestions, setSelectedQuestions] = useState<string[]>([]);

  const wsUrl = getWebSocketUrl();
  const { send, lastMessage, connectionStatus, reconnect } = useWebSocket({
    url: wsUrl,
    autoConnect: false,
  });

  const connectedPlayerCount = state.players.filter((p) => p.isConnected).length;
  const isHost = state.players.find((p) => p.id === localPlayerId)?.isHost ?? false;

  // ============================================================
  // Helper: Host broadcasts full game state to all clients
  // ============================================================
  const broadcastGameState = useCallback((gameState: GameState) => {
    const msg: WebSocketMessage = {
      type: 'full_state',
      senderId: localPlayerId,
      targetId: 'all',
      state: gameState,
    };
    send(msg);
  }, [send, localPlayerId]);

  // ============================================================
  // Incoming message routing
  // ============================================================
  const lastProcessedMsgRef = useRef<WebSocketMessage | null>(null);

  useEffect(() => {
    if (!lastMessage || lastMessage === lastProcessedMsgRef.current) return;
    lastProcessedMsgRef.current = lastMessage;

    // full_state from host → apply directly (this is the primary sync mechanism)
    if (lastMessage.type === 'full_state') {
      dispatch({ type: 'APPLY_FULL_STATE', state: (lastMessage as any).state });
      return;
    }

    // room_sync → sync players
    if (lastMessage.type === 'room_sync') {
      dispatch({ type: 'SYNC_PLAYERS', players: (lastMessage as any).players, settings: (lastMessage as any).settings });
      return;
    }

    // For other messages, use the standard routing
    const action = messageToAction(lastMessage);
    if (action) {
      dispatch(action);
    }

    // Host: when a new player joins, send room_sync
    if (lastMessage.type === 'player_joined' && isHost) {
      setTimeout(() => {
        const newPlayer = (lastMessage as any).player;
        const allPlayers = [...state.players.filter((p: Player) => p.id !== newPlayer.id), newPlayer];
        send({
          type: 'room_sync',
          players: allPlayers,
          settings: state.settings,
        } as any);
      }, 100);
    }
  }, [lastMessage, dispatch, isHost, state.players, state.settings, send]);

  // ============================================================
  // Connection error handling
  // ============================================================
  useEffect(() => {
    if (connectionStatus === 'disconnected' && joined) {
      setErrors((prev) => {
        if (prev.some((e) => e.type === 'connection')) return prev;
        return [...prev, createConnectionError('Connection lost. Please retry.')];
      });
    } else if (connectionStatus === 'connected') {
      setErrors((prev) => prev.filter((e) => e.type !== 'connection'));
    }
  }, [connectionStatus, joined]);

  // ============================================================
  // Handlers
  // ============================================================

  const handleJoined = useCallback((player: Player, code: string) => {
    setLocalPlayerId(player.id);
    setRoomCode(code);
    setJoined(true);
    dispatch({ type: 'ADD_PLAYER', player });
  }, [dispatch]);

  const handleStartGame = useCallback(async () => {
    const connectedPlayers = state.players.filter((p) => p.isConnected);
    if (connectedPlayers.length < state.settings.minPlayers) return;

    // Fetch questions
    let questions: string[];
    try {
      const res = await fetch('/questions.json');
      questions = await res.json();
    } catch { return; }

    const validQuestions = questions.filter((q: string) => q.includes('XYZ'));
    const totalRounds = connectedPlayers.length;
    if (validQuestions.length < totalRounds) return;

    const shuffled = [...validQuestions].sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, totalRounds);
    setSelectedQuestions(selected);

    const featuredOrder = [...connectedPlayers]
      .sort(() => Math.random() - 0.5)
      .map((p) => p.id);

    // Build the initial game state for round 1
    const firstFeaturedPlayer = connectedPlayers.find(p => p.id === featuredOrder[0]);
    const questionText = substituteQuestion(selected[0], firstFeaturedPlayer?.name ?? 'Player', connectedPlayers, featuredOrder[0]);

    const scores: Record<string, number> = {};
    connectedPlayers.forEach(p => { scores[p.id] = 0; });

    const gameState: GameState = {
      phase: 'answer_phase',
      currentRound: 1,
      totalRounds,
      questions: selected.map((_, i) => i),
      featuredPlayerOrder: featuredOrder,
      scores,
      currentRoundState: {
        questionIndex: 0,
        featuredPlayerId: featuredOrder[0],
        questionText,
        answers: {},
        votes: {},
        timerEndTime: 0,
      },
    };

    // Apply locally
    dispatch({ type: 'APPLY_FULL_STATE', state: gameState });
    // Broadcast to all other clients
    broadcastGameState(gameState);
  }, [state.players, state.settings, dispatch, broadcastGameState]);

  const handleSettingsChange = useCallback((settings: GameSettings) => {
    send({ type: 'settings_update', settings });
    dispatch({ type: 'UPDATE_SETTINGS', settings });
  }, [send, dispatch]);

  const handleSubmitAnswer = useCallback((playerId: string, answer: string) => {
    const message: WebSocketMessage = {
      type: 'answer_submit',
      playerId,
      answer,
      roundNumber: state.game?.currentRound ?? 0,
    };
    send(message);
    dispatch({ type: 'SUBMIT_ANSWER', playerId, answer });
  }, [send, dispatch, state.game?.currentRound]);

  const handleVoteCast = useCallback((voterId: string, answerId: string) => {
    const message: WebSocketMessage = {
      type: 'vote_cast',
      voterId,
      answerId,
      roundNumber: state.game?.currentRound ?? 0,
    };
    send(message);
    dispatch({ type: 'CAST_VOTE', voterId, answerId });
  }, [send, dispatch, state.game?.currentRound]);

  const handleProceedToVoting = useCallback(() => {
    if (!state.game || !isHost) return;

    const updatedGame: GameState = { ...state.game, phase: 'voting_phase' };
    dispatch({ type: 'APPLY_FULL_STATE', state: updatedGame });
    broadcastGameState(updatedGame);
  }, [state.game, dispatch, isHost, broadcastGameState]);

  const handleVotingComplete = useCallback(() => {
    if (!state.game || !isHost) return;

    // Calculate scores
    const { currentRoundState, scores } = state.game;
    const { votes, answers } = currentRoundState;
    const newScores = { ...scores };

    for (const answerId of Object.values(votes)) {
      const votedText = answers[answerId];
      if (!votedText) continue;
      const matchingAuthors = Object.entries(answers)
        .filter(([, text]) => text === votedText)
        .map(([pid]) => pid);
      for (const authorId of matchingAuthors) {
        newScores[authorId] = (newScores[authorId] ?? 0) + 1;
      }
    }

    const updatedGame: GameState = {
      ...state.game,
      phase: 'score_reveal',
      scores: newScores,
    };
    dispatch({ type: 'APPLY_FULL_STATE', state: updatedGame });
    broadcastGameState(updatedGame);
  }, [state.game, dispatch, isHost, broadcastGameState]);

  const handleNextRound = useCallback(() => {
    if (!state.game || !isHost) return;

    const nextRound = state.game.currentRound + 1;
    const nextFeaturedPlayerId = state.game.featuredPlayerOrder[nextRound - 1] ?? '';
    const nextQuestionIndex = state.game.questions[nextRound - 1] ?? 0;

    const featuredPlayer = state.players.find(p => p.id === nextFeaturedPlayerId);
    const template = selectedQuestions[nextQuestionIndex] ?? 'What would XYZ do?';
    const connectedPlayers = state.players.filter(p => p.isConnected);
    const questionText = substituteQuestion(template, featuredPlayer?.name ?? 'Player', connectedPlayers, nextFeaturedPlayerId);

    const updatedGame: GameState = {
      ...state.game,
      phase: 'answer_phase',
      currentRound: nextRound,
      currentRoundState: {
        questionIndex: nextQuestionIndex,
        featuredPlayerId: nextFeaturedPlayerId,
        questionText,
        answers: {},
        votes: {},
        timerEndTime: 0,
      },
    };
    dispatch({ type: 'APPLY_FULL_STATE', state: updatedGame });
    broadcastGameState(updatedGame);
  }, [state.game, state.players, isHost, dispatch, broadcastGameState, selectedQuestions]);

  const handleGameEnd = useCallback(() => {
    if (!state.game) return;
    const updatedGame: GameState = { ...state.game, phase: 'game_end' };
    dispatch({ type: 'APPLY_FULL_STATE', state: updatedGame });
    if (isHost) broadcastGameState(updatedGame);
  }, [state.game, dispatch, isHost, broadcastGameState]);

  const handlePlayAgain = useCallback(() => {
    // Reset game state — go back to lobby for all players
    if (isHost && state.game) {
      const lobbyState: GameState = {
        ...state.game,
        phase: 'lobby',
        currentRound: 0,
        currentRoundState: { questionIndex: 0, featuredPlayerId: '', questionText: '', answers: {}, votes: {}, timerEndTime: 0 },
      };
      dispatch({ type: 'APPLY_FULL_STATE', state: lobbyState });
      broadcastGameState(lobbyState);
    }
  }, [state.game, isHost, dispatch, broadcastGameState]);

  const handleRetry = useCallback(() => { reconnect(); }, [reconnect]);
  const handleDismissError = useCallback((errorId: string) => {
    setErrors((prev) => prev.filter((e) => e.id !== errorId));
  }, []);

  // ============================================================
  // Render
  // ============================================================
  const renderScreen = () => {
    if (!joined) {
      return (
        <JoinScreen
          wsUrl={wsUrl}
          onJoined={handleJoined}
          existingPlayerNames={state.players.map((p) => p.name)}
          send={send}
          connectionStatus={connectionStatus}
          reconnect={reconnect}
          lastMessage={lastMessage}
        />
      );
    }

    if (!state.game || state.game.phase === 'lobby') {
      return (
        <LobbyScreen
          roomCode={roomCode}
          players={state.players}
          settings={state.settings}
          isHost={isHost}
          onStartGame={handleStartGame}
          onSettingsChange={handleSettingsChange}
          activeGame={state.game}
        />
      );
    }

    switch (state.game.phase) {
      case 'question_display':
      case 'answer_phase':
        return (
          <AnswerScreen
            playerId={localPlayerId}
            onProceedToVoting={handleProceedToVoting}
            onSubmitAnswer={handleSubmitAnswer}
            timerDurationSeconds={state.settings.answerTimerSeconds}
          />
        );
      case 'voting_phase':
        return (
          <VotingScreen
            playerId={localPlayerId}
            votingTimerSeconds={state.settings.votingTimerSeconds}
            onVotingComplete={handleVotingComplete}
            onVoteCast={handleVoteCast}
          />
        );
      case 'score_reveal':
        return (
          <ResultsScreen
            playerId={localPlayerId}
            onNextRound={handleNextRound}
            onGameEnd={handleGameEnd}
          />
        );
      case 'game_end':
        return <FinalLeaderboard onPlayAgain={handlePlayAgain} />;
      default:
        return null;
    }
  };

  return (
    <>
      {renderScreen()}
      <ErrorOverlay errors={errors} onRetry={handleRetry} onDismiss={handleDismissError} />
    </>
  );
}

export function App() {
  return (
    <GameProvider>
      <AppInner />
    </GameProvider>
  );
}

export default App;
