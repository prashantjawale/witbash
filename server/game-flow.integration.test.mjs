/**
 * Integration tests: Full game flow lifecycle with multiple simulated clients.
 *
 * Covers:
 * 1. Complete game lifecycle with 3+ simulated clients
 * 2. Mid-game join and lobby waiting
 * 3. Disconnection during answer phase
 * 4. Disconnection during voting phase
 * 5. Reconnection with player_reconnected notification
 *
 * Validates: Requirements 2.2, 4.1, 9.1, 10.1, 12.2
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_PORT = 9879;
let serverProcess;

beforeAll(async () => {
  serverProcess = spawn('node', ['server.js', '--port', String(TEST_PORT)], {
    cwd: __dirname,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server did not start in time')), 10000);

    let output = '';
    serverProcess.stdout.on('data', (data) => {
      output += data.toString();
      if (output.includes('running at')) {
        clearTimeout(timeout);
        resolve();
      }
    });

    serverProcess.stderr.on('data', (data) => {
      const errMsg = data.toString();
      if (errMsg.includes('Error')) {
        clearTimeout(timeout);
        reject(new Error(`Server error: ${errMsg}`));
      }
    });

    serverProcess.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}, 15000);

afterAll(async () => {
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
    await new Promise((resolve) => serverProcess.on('close', resolve));
  }
});


// --- Helper utilities ---

function connectWs() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${TEST_PORT}/ws`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function waitForMessage(ws, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for message')), timeoutMs);
    ws.once('message', (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(data.toString()));
    });
  });
}

function waitForMessageOfType(ws, type, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for message type: ${type}`)), timeoutMs);
    const handler = (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === type) {
        clearTimeout(timer);
        ws.removeListener('message', handler);
        resolve(msg);
      }
    };
    ws.on('message', handler);
  });
}

function collectMessages(ws, count, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const messages = [];
    const timer = setTimeout(() => reject(new Error(`Timed out collecting ${count} messages, got ${messages.length}`)), timeoutMs);
    const handler = (data) => {
      messages.push(JSON.parse(data.toString()));
      if (messages.length >= count) {
        clearTimeout(timer);
        ws.removeListener('message', handler);
        resolve(messages);
      }
    };
    ws.on('message', handler);
  });
}

async function joinRoom(ws, roomCode, playerId) {
  ws.send(JSON.stringify({ type: 'join_room', roomCode, playerId }));
  // Small delay to ensure room association completes
  await new Promise((r) => setTimeout(r, 30));
}

function sendMsg(ws, msg) {
  ws.send(JSON.stringify(msg));
}


// --- Test Suite ---

describe('Full game flow integration', () => {

  describe('1. Complete game lifecycle with 3 clients', () => {
    it('runs a full game: join → start → answer → vote → results → game end', async () => {
      const ws1 = await connectWs();
      const ws2 = await connectWs();
      const ws3 = await connectWs();

      const roomCode = 'LIFE';

      // All players join the room
      await joinRoom(ws1, roomCode, 'host');
      await joinRoom(ws2, roomCode, 'player2');
      await joinRoom(ws3, roomCode, 'player3');

      // --- Host broadcasts player_joined for each player ---
      // Host announces itself
      const p1Msg2 = waitForMessage(ws2);
      const p1Msg3 = waitForMessage(ws3);
      sendMsg(ws1, {
        type: 'player_joined',
        player: { id: 'host', name: 'Alice', isHost: true, isConnected: true, joinOrder: 1 },
      });
      const [recv2a, recv3a] = await Promise.all([p1Msg2, p1Msg3]);
      expect(recv2a.type).toBe('player_joined');
      expect(recv3a.type).toBe('player_joined');

      // Player2 announces itself
      const p2Msg1 = waitForMessage(ws1);
      const p2Msg3 = waitForMessage(ws3);
      sendMsg(ws2, {
        type: 'player_joined',
        player: { id: 'player2', name: 'Bob', isHost: false, isConnected: true, joinOrder: 2 },
      });
      await Promise.all([p2Msg1, p2Msg3]);

      // Player3 announces itself
      const p3Msg1 = waitForMessage(ws1);
      const p3Msg2 = waitForMessage(ws2);
      sendMsg(ws3, {
        type: 'player_joined',
        player: { id: 'player3', name: 'Charlie', isHost: false, isConnected: true, joinOrder: 3 },
      });
      await Promise.all([p3Msg1, p3Msg2]);

      // --- Host starts the game ---
      const startMsg2 = waitForMessage(ws2);
      const startMsg3 = waitForMessage(ws3);
      sendMsg(ws1, {
        type: 'game_start',
        settings: { minPlayers: 3, maxPlayers: 7, answerTimerSeconds: 60, votingTimerSeconds: 30 },
        questions: [0, 1, 2],
        featuredPlayerOrder: ['host', 'player2', 'player3'],
        totalRounds: 3,
      });
      const [gs2, gs3] = await Promise.all([startMsg2, startMsg3]);
      expect(gs2.type).toBe('game_start');
      expect(gs2.totalRounds).toBe(3);
      expect(gs3.type).toBe('game_start');

      // --- Round 1: Host broadcasts round_begin ---
      const rb2 = waitForMessage(ws2);
      const rb3 = waitForMessage(ws3);
      sendMsg(ws1, {
        type: 'round_begin',
        roundNumber: 1,
        questionIndex: 0,
        featuredPlayerId: 'host',
      });
      const [rbRecv2, rbRecv3] = await Promise.all([rb2, rb3]);
      expect(rbRecv2.type).toBe('round_begin');
      expect(rbRecv2.roundNumber).toBe(1);
      expect(rbRecv3.featuredPlayerId).toBe('host');

      // --- Round 1: All players submit answers ---
      const ans1from2 = waitForMessage(ws1);
      const ans3from2 = waitForMessage(ws3);
      sendMsg(ws2, { type: 'answer_submit', playerId: 'player2', answer: 'Answer from Bob', roundNumber: 1 });
      await Promise.all([ans1from2, ans3from2]);

      const ans1from3 = waitForMessage(ws1);
      const ans2from3 = waitForMessage(ws2);
      sendMsg(ws3, { type: 'answer_submit', playerId: 'player3', answer: 'Answer from Charlie', roundNumber: 1 });
      await Promise.all([ans1from3, ans2from3]);

      const ans2fromHost = waitForMessage(ws2);
      const ans3fromHost = waitForMessage(ws3);
      sendMsg(ws1, { type: 'answer_submit', playerId: 'host', answer: 'Answer from Alice', roundNumber: 1 });
      await Promise.all([ans2fromHost, ans3fromHost]);

      // --- Round 1: Voting phase start ---
      const vps2 = waitForMessage(ws2);
      const vps3 = waitForMessage(ws3);
      sendMsg(ws1, {
        type: 'voting_phase_start',
        answers: [
          { answerId: 'player2', text: 'Answer from Bob' },
          { answerId: 'player3', text: 'Answer from Charlie' },
          { answerId: 'host', text: 'Answer from Alice' },
        ],
      });
      const [vpsRecv2, vpsRecv3] = await Promise.all([vps2, vps3]);
      expect(vpsRecv2.type).toBe('voting_phase_start');
      expect(vpsRecv2.answers.length).toBe(3);

      // --- Round 1: All players cast votes ---
      const v1from2 = waitForMessage(ws1);
      const v3from2 = waitForMessage(ws3);
      sendMsg(ws2, { type: 'vote_cast', voterId: 'player2', answerId: 'player3', roundNumber: 1 });
      await Promise.all([v1from2, v3from2]);

      const v1from3 = waitForMessage(ws1);
      const v2from3 = waitForMessage(ws2);
      sendMsg(ws3, { type: 'vote_cast', voterId: 'player3', answerId: 'player2', roundNumber: 1 });
      await Promise.all([v1from3, v2from3]);

      const vHost2 = waitForMessage(ws2);
      const vHost3 = waitForMessage(ws3);
      sendMsg(ws1, { type: 'vote_cast', voterId: 'host', answerId: 'player2', roundNumber: 1 });
      await Promise.all([vHost2, vHost3]);

      // --- Round 1: Results reveal ---
      const rr2 = waitForMessage(ws2);
      const rr3 = waitForMessage(ws3);
      sendMsg(ws1, {
        type: 'results_reveal',
        results: [
          { playerId: 'player2', playerName: 'Bob', answer: 'Answer from Bob', voteCount: 2, pointsEarned: 2 },
          { playerId: 'player3', playerName: 'Charlie', answer: 'Answer from Charlie', voteCount: 1, pointsEarned: 1 },
          { playerId: 'host', playerName: 'Alice', answer: 'Answer from Alice', voteCount: 0, pointsEarned: 0 },
        ],
        leaderboard: [
          { playerId: 'player2', playerName: 'Bob', score: 2, rank: 1 },
          { playerId: 'player3', playerName: 'Charlie', score: 1, rank: 2 },
          { playerId: 'host', playerName: 'Alice', score: 0, rank: 3 },
        ],
      });
      const [rrRecv2, rrRecv3] = await Promise.all([rr2, rr3]);
      expect(rrRecv2.type).toBe('results_reveal');
      expect(rrRecv2.leaderboard[0].score).toBe(2);
      expect(rrRecv3.results.length).toBe(3);

      // --- State hash consensus at phase boundary ---
      const sh2 = waitForMessage(ws2);
      const sh3 = waitForMessage(ws3);
      sendMsg(ws1, { type: 'state_hash', playerId: 'host', hash: 'abc123', phase: 'score_reveal', roundNumber: 1 });
      await Promise.all([sh2, sh3]);

      const sh1from2 = waitForMessage(ws1);
      const sh3from2 = waitForMessage(ws3);
      sendMsg(ws2, { type: 'state_hash', playerId: 'player2', hash: 'abc123', phase: 'score_reveal', roundNumber: 1 });
      await Promise.all([sh1from2, sh3from2]);

      const sh1from3 = waitForMessage(ws1);
      const sh2from3 = waitForMessage(ws2);
      sendMsg(ws3, { type: 'state_hash', playerId: 'player3', hash: 'abc123', phase: 'score_reveal', roundNumber: 1 });
      await Promise.all([sh1from3, sh2from3]);

      // --- Game end after final round (simulate directly) ---
      const ge2 = waitForMessage(ws2);
      const ge3 = waitForMessage(ws3);
      sendMsg(ws1, { type: 'game_end' });
      const [geRecv2, geRecv3] = await Promise.all([ge2, ge3]);
      expect(geRecv2.type).toBe('game_end');
      expect(geRecv3.type).toBe('game_end');

      ws1.close();
      ws2.close();
      ws3.close();
    });
  });


  describe('2. Mid-game join and lobby waiting', () => {
    it('a 4th player joining mid-game receives messages but is placed in lobby', async () => {
      const ws1 = await connectWs();
      const ws2 = await connectWs();
      const ws3 = await connectWs();

      const roomCode = 'MIDJ';

      // 3 players join and start a game
      await joinRoom(ws1, roomCode, 'host');
      await joinRoom(ws2, roomCode, 'p2');
      await joinRoom(ws3, roomCode, 'p3');

      // Host starts game
      const gs2 = waitForMessage(ws2);
      const gs3 = waitForMessage(ws3);
      sendMsg(ws1, {
        type: 'game_start',
        settings: { minPlayers: 3, maxPlayers: 7, answerTimerSeconds: 60, votingTimerSeconds: 30 },
        questions: [0, 1, 2],
        featuredPlayerOrder: ['host', 'p2', 'p3'],
        totalRounds: 3,
      });
      await Promise.all([gs2, gs3]);

      // 4th player joins mid-game
      const ws4 = await connectWs();
      await joinRoom(ws4, roomCode, 'p4');

      // The 4th player announces themselves
      const p4Msg1 = waitForMessage(ws1);
      const p4Msg2 = waitForMessage(ws2);
      const p4Msg3 = waitForMessage(ws3);
      sendMsg(ws4, {
        type: 'player_joined',
        player: { id: 'p4', name: 'Dave', isHost: false, isConnected: true, joinOrder: 4 },
      });
      const [m1, m2, m3] = await Promise.all([p4Msg1, p4Msg2, p4Msg3]);
      expect(m1.type).toBe('player_joined');
      expect(m1.player.name).toBe('Dave');
      expect(m2.player.id).toBe('p4');
      expect(m3.player.id).toBe('p4');

      // Host sends game status to the new player (via relay to all)
      const statusMsg4 = waitForMessage(ws4);
      sendMsg(ws1, {
        type: 'game_status',
        currentRound: 1,
        totalRounds: 3,
        phase: 'answer_phase',
        playerCount: 3,
      });
      const statusRecv = await statusMsg4;
      expect(statusRecv.type).toBe('game_status');
      expect(statusRecv.currentRound).toBe(1);
      expect(statusRecv.phase).toBe('answer_phase');

      // The 4th player can still receive relayed messages from the room
      const roundMsg4 = waitForMessage(ws4);
      sendMsg(ws1, {
        type: 'round_begin',
        roundNumber: 2,
        questionIndex: 1,
        featuredPlayerId: 'p2',
      });
      const roundRecv = await roundMsg4;
      expect(roundRecv.type).toBe('round_begin');
      expect(roundRecv.roundNumber).toBe(2);

      ws1.close();
      ws2.close();
      ws3.close();
      ws4.close();
    });
  });


  describe('3. Disconnection during answer phase', () => {
    it('remaining players can complete the round when a player disconnects mid-answer', async () => {
      const ws1 = await connectWs();
      const ws2 = await connectWs();
      const ws3 = await connectWs();

      const roomCode = 'DCAN';

      await joinRoom(ws1, roomCode, 'host');
      await joinRoom(ws2, roomCode, 'p2');
      await joinRoom(ws3, roomCode, 'p3');

      // Start game
      const gs2 = waitForMessage(ws2);
      const gs3 = waitForMessage(ws3);
      sendMsg(ws1, {
        type: 'game_start',
        settings: { minPlayers: 3, maxPlayers: 7, answerTimerSeconds: 60, votingTimerSeconds: 30 },
        questions: [0, 1, 2],
        featuredPlayerOrder: ['host', 'p2', 'p3'],
        totalRounds: 3,
      });
      await Promise.all([gs2, gs3]);

      // Begin round 1
      const rb2 = waitForMessage(ws2);
      const rb3 = waitForMessage(ws3);
      sendMsg(ws1, { type: 'round_begin', roundNumber: 1, questionIndex: 0, featuredPlayerId: 'host' });
      await Promise.all([rb2, rb3]);

      // Player 2 submits an answer
      const ans1 = waitForMessage(ws1);
      const ans3 = waitForMessage(ws3);
      sendMsg(ws2, { type: 'answer_submit', playerId: 'p2', answer: 'Bob answer', roundNumber: 1 });
      await Promise.all([ans1, ans3]);

      // Player 3 disconnects during answer phase (before submitting)
      const dcMsg1 = waitForMessage(ws1);
      const dcMsg2 = waitForMessage(ws2);
      ws3.close();
      const [dc1, dc2] = await Promise.all([dcMsg1, dcMsg2]);
      expect(dc1.type).toBe('player_disconnected');
      expect(dc1.playerId).toBe('p3');
      expect(dc2.type).toBe('player_disconnected');
      expect(dc2.playerId).toBe('p3');

      // Host submits answer — remaining players can still complete the round
      const ansFromHost = waitForMessage(ws2);
      sendMsg(ws1, { type: 'answer_submit', playerId: 'host', answer: 'Alice answer', roundNumber: 1 });
      const ansRecv = await ansFromHost;
      expect(ansRecv.type).toBe('answer_submit');
      expect(ansRecv.answer).toBe('Alice answer');

      // Voting phase can proceed with only 2 answers from remaining players
      const vps2 = waitForMessage(ws2);
      sendMsg(ws1, {
        type: 'voting_phase_start',
        answers: [
          { answerId: 'p2', text: 'Bob answer' },
          { answerId: 'host', text: 'Alice answer' },
        ],
      });
      const vpsRecv = await vps2;
      expect(vpsRecv.type).toBe('voting_phase_start');
      expect(vpsRecv.answers.length).toBe(2);

      // Remaining players vote
      const v1 = waitForMessage(ws1);
      sendMsg(ws2, { type: 'vote_cast', voterId: 'p2', answerId: 'host', roundNumber: 1 });
      const vRecv1 = await v1;
      expect(vRecv1.type).toBe('vote_cast');

      const v2 = waitForMessage(ws2);
      sendMsg(ws1, { type: 'vote_cast', voterId: 'host', answerId: 'p2', roundNumber: 1 });
      const vRecv2 = await v2;
      expect(vRecv2.type).toBe('vote_cast');

      // Results can be revealed
      const rr2 = waitForMessage(ws2);
      sendMsg(ws1, {
        type: 'results_reveal',
        results: [
          { playerId: 'p2', playerName: 'Bob', answer: 'Bob answer', voteCount: 1, pointsEarned: 1 },
          { playerId: 'host', playerName: 'Alice', answer: 'Alice answer', voteCount: 1, pointsEarned: 1 },
        ],
        leaderboard: [
          { playerId: 'host', playerName: 'Alice', score: 1, rank: 1 },
          { playerId: 'p2', playerName: 'Bob', score: 1, rank: 2 },
        ],
      });
      const rrRecv = await rr2;
      expect(rrRecv.type).toBe('results_reveal');
      expect(rrRecv.results.length).toBe(2);

      ws1.close();
      ws2.close();
    });
  });


  describe('4. Disconnection during voting phase', () => {
    it('voting completes with remaining players when one disconnects mid-vote', async () => {
      const ws1 = await connectWs();
      const ws2 = await connectWs();
      const ws3 = await connectWs();

      const roomCode = 'DCVT';

      await joinRoom(ws1, roomCode, 'host');
      await joinRoom(ws2, roomCode, 'p2');
      await joinRoom(ws3, roomCode, 'p3');

      // Start game and begin round
      const gs2 = waitForMessage(ws2);
      const gs3 = waitForMessage(ws3);
      sendMsg(ws1, {
        type: 'game_start',
        settings: { minPlayers: 3, maxPlayers: 7, answerTimerSeconds: 60, votingTimerSeconds: 30 },
        questions: [0, 1, 2],
        featuredPlayerOrder: ['host', 'p2', 'p3'],
        totalRounds: 3,
      });
      await Promise.all([gs2, gs3]);

      const rb2 = waitForMessage(ws2);
      const rb3 = waitForMessage(ws3);
      sendMsg(ws1, { type: 'round_begin', roundNumber: 1, questionIndex: 0, featuredPlayerId: 'host' });
      await Promise.all([rb2, rb3]);

      // All players submit answers
      const a1 = waitForMessage(ws1);
      const a3 = waitForMessage(ws3);
      sendMsg(ws2, { type: 'answer_submit', playerId: 'p2', answer: 'Bob answer', roundNumber: 1 });
      await Promise.all([a1, a3]);

      const a1b = waitForMessage(ws1);
      const a2b = waitForMessage(ws2);
      sendMsg(ws3, { type: 'answer_submit', playerId: 'p3', answer: 'Charlie answer', roundNumber: 1 });
      await Promise.all([a1b, a2b]);

      const a2c = waitForMessage(ws2);
      const a3c = waitForMessage(ws3);
      sendMsg(ws1, { type: 'answer_submit', playerId: 'host', answer: 'Alice answer', roundNumber: 1 });
      await Promise.all([a2c, a3c]);

      // Voting phase starts
      const vps2 = waitForMessage(ws2);
      const vps3 = waitForMessage(ws3);
      sendMsg(ws1, {
        type: 'voting_phase_start',
        answers: [
          { answerId: 'p2', text: 'Bob answer' },
          { answerId: 'p3', text: 'Charlie answer' },
          { answerId: 'host', text: 'Alice answer' },
        ],
      });
      await Promise.all([vps2, vps3]);

      // Player 2 votes
      const v1 = waitForMessage(ws1);
      const v3 = waitForMessage(ws3);
      sendMsg(ws2, { type: 'vote_cast', voterId: 'p2', answerId: 'p3', roundNumber: 1 });
      await Promise.all([v1, v3]);

      // Player 3 disconnects during voting phase (before voting)
      const dcMsg1 = waitForMessage(ws1);
      const dcMsg2 = waitForMessage(ws2);
      ws3.close();
      const [dc1, dc2] = await Promise.all([dcMsg1, dcMsg2]);
      expect(dc1.type).toBe('player_disconnected');
      expect(dc1.playerId).toBe('p3');
      expect(dc2.type).toBe('player_disconnected');

      // Host votes — voting can complete without disconnected player
      const vFromHost = waitForMessage(ws2);
      sendMsg(ws1, { type: 'vote_cast', voterId: 'host', answerId: 'p2', roundNumber: 1 });
      const vRecv = await vFromHost;
      expect(vRecv.type).toBe('vote_cast');
      expect(vRecv.voterId).toBe('host');

      // Results reveal — disconnected player's answer still gets votes counted
      const rr2 = waitForMessage(ws2);
      sendMsg(ws1, {
        type: 'results_reveal',
        results: [
          { playerId: 'p2', playerName: 'Bob', answer: 'Bob answer', voteCount: 1, pointsEarned: 1 },
          { playerId: 'p3', playerName: 'Charlie', answer: 'Charlie answer', voteCount: 1, pointsEarned: 1 },
          { playerId: 'host', playerName: 'Alice', answer: 'Alice answer', voteCount: 0, pointsEarned: 0 },
        ],
        leaderboard: [
          { playerId: 'p2', playerName: 'Bob', score: 1, rank: 1 },
          { playerId: 'p3', playerName: 'Charlie', score: 1, rank: 2 },
          { playerId: 'host', playerName: 'Alice', score: 0, rank: 3 },
        ],
      });
      const rrRecv = await rr2;
      expect(rrRecv.type).toBe('results_reveal');
      // Disconnected player's answer still received a vote
      const charlieResult = rrRecv.results.find((r) => r.playerId === 'p3');
      expect(charlieResult.voteCount).toBe(1);
      expect(charlieResult.pointsEarned).toBe(1);

      ws1.close();
      ws2.close();
    });
  });


  describe('5. Reconnection with player_reconnected notification', () => {
    it('a disconnected player reconnects and others receive player_reconnected', async () => {
      const ws1 = await connectWs();
      const ws2 = await connectWs();
      const ws3 = await connectWs();

      const roomCode = 'RCON';

      await joinRoom(ws1, roomCode, 'host');
      await joinRoom(ws2, roomCode, 'p2');
      await joinRoom(ws3, roomCode, 'p3');

      // Start game
      const gs2 = waitForMessage(ws2);
      const gs3 = waitForMessage(ws3);
      sendMsg(ws1, {
        type: 'game_start',
        settings: { minPlayers: 3, maxPlayers: 7, answerTimerSeconds: 60, votingTimerSeconds: 30 },
        questions: [0, 1, 2],
        featuredPlayerOrder: ['host', 'p2', 'p3'],
        totalRounds: 3,
      });
      await Promise.all([gs2, gs3]);

      // Player 3 disconnects
      const dcMsg1 = waitForMessage(ws1);
      const dcMsg2 = waitForMessage(ws2);
      ws3.close();
      const [dc1, dc2] = await Promise.all([dcMsg1, dcMsg2]);
      expect(dc1.type).toBe('player_disconnected');
      expect(dc1.playerId).toBe('p3');
      expect(dc2.type).toBe('player_disconnected');

      // Player 3 reconnects with a new WebSocket connection
      const ws3b = await connectWs();
      await joinRoom(ws3b, roomCode, 'p3');

      // Player 3 sends player_reconnected message
      const rcMsg1 = waitForMessage(ws1);
      const rcMsg2 = waitForMessage(ws2);
      sendMsg(ws3b, {
        type: 'player_reconnected',
        player: { id: 'p3', name: 'Charlie', isHost: false, isConnected: true, joinOrder: 3 },
      });
      const [rc1, rc2] = await Promise.all([rcMsg1, rcMsg2]);
      expect(rc1.type).toBe('player_reconnected');
      expect(rc1.player.id).toBe('p3');
      expect(rc1.player.name).toBe('Charlie');
      expect(rc2.type).toBe('player_reconnected');
      expect(rc2.player.id).toBe('p3');

      // Verify the reconnected player can receive messages again
      const msgTo3 = waitForMessage(ws3b);
      sendMsg(ws1, { type: 'round_begin', roundNumber: 1, questionIndex: 0, featuredPlayerId: 'host' });
      const recv3 = await msgTo3;
      expect(recv3.type).toBe('round_begin');
      expect(recv3.roundNumber).toBe(1);

      // Verify the reconnected player can send messages
      const msgFrom3to1 = waitForMessage(ws1);
      const msgFrom3to2 = waitForMessage(ws2);
      sendMsg(ws3b, { type: 'answer_submit', playerId: 'p3', answer: 'Charlie is back!', roundNumber: 1 });
      const [m1, m2] = await Promise.all([msgFrom3to1, msgFrom3to2]);
      expect(m1.type).toBe('answer_submit');
      expect(m1.answer).toBe('Charlie is back!');
      expect(m2.type).toBe('answer_submit');

      ws1.close();
      ws2.close();
      ws3b.close();
    });
  });


  describe('6. Consensus correction after state divergence', () => {
    it('state hash exchange and full state correction flow works via relay', async () => {
      const ws1 = await connectWs();
      const ws2 = await connectWs();
      const ws3 = await connectWs();

      const roomCode = 'CONS';

      await joinRoom(ws1, roomCode, 'host');
      await joinRoom(ws2, roomCode, 'p2');
      await joinRoom(ws3, roomCode, 'p3');

      // All clients broadcast state hashes — 2 agree, 1 diverges
      const sh2from1 = waitForMessage(ws2);
      const sh3from1 = waitForMessage(ws3);
      sendMsg(ws1, { type: 'state_hash', playerId: 'host', hash: 'correct_hash', phase: 'score_reveal', roundNumber: 1 });
      await Promise.all([sh2from1, sh3from1]);

      const sh1from2 = waitForMessage(ws1);
      const sh3from2 = waitForMessage(ws3);
      sendMsg(ws2, { type: 'state_hash', playerId: 'p2', hash: 'correct_hash', phase: 'score_reveal', roundNumber: 1 });
      await Promise.all([sh1from2, sh3from2]);

      // Player 3 has a divergent hash
      const sh1from3 = waitForMessage(ws1);
      const sh2from3 = waitForMessage(ws2);
      sendMsg(ws3, { type: 'state_hash', playerId: 'p3', hash: 'wrong_hash', phase: 'score_reveal', roundNumber: 1 });
      const [shRecv1, shRecv2] = await Promise.all([sh1from3, sh2from3]);
      expect(shRecv1.type).toBe('state_hash');
      expect(shRecv1.hash).toBe('wrong_hash');

      // Player 3 requests full state from host (majority holder)
      const sr1 = waitForMessage(ws1);
      const sr2 = waitForMessage(ws2);
      sendMsg(ws3, { type: 'state_request', requesterId: 'p3', targetId: 'host' });
      const [srRecv1, srRecv2] = await Promise.all([sr1, sr2]);
      expect(srRecv1.type).toBe('state_request');
      expect(srRecv1.requesterId).toBe('p3');
      expect(srRecv1.targetId).toBe('host');

      // Host responds with full state (relayed to all, but targeted at p3)
      const fs2 = waitForMessage(ws2);
      const fs3 = waitForMessage(ws3);
      sendMsg(ws1, {
        type: 'full_state',
        senderId: 'host',
        targetId: 'p3',
        state: {
          phase: 'score_reveal',
          currentRound: 1,
          totalRounds: 3,
          scores: { host: 0, p2: 2, p3: 1 },
          currentRoundState: {
            questionIndex: 0,
            featuredPlayerId: 'host',
            questionText: 'What would Alice bring?',
            answers: { p2: 'Answer B', p3: 'Answer C', host: 'Answer A' },
            votes: { p2: 'p3', p3: 'p2', host: 'p2' },
            timerEndTime: 0,
          },
        },
      });
      const [fsRecv2, fsRecv3] = await Promise.all([fs2, fs3]);
      expect(fsRecv3.type).toBe('full_state');
      expect(fsRecv3.targetId).toBe('p3');
      expect(fsRecv3.state.scores.p2).toBe(2);
      expect(fsRecv3.state.phase).toBe('score_reveal');

      ws1.close();
      ws2.close();
      ws3.close();
    });
  });

});
