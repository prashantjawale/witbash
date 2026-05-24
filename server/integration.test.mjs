/**
 * Integration test: Verifies server and client are wired together end-to-end.
 * - Server serves built React app (dist/index.html)
 * - Server serves questions.json
 * - WebSocket upgrade works
 * - Full game flow: join → relay messages between clients
 *
 * This test spawns the server as a child process to avoid port conflicts
 * with other test files that import the server module directly.
 *
 * Validates: Requirements 1.1, 1.2, 11.1, 11.3, 13.1
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import WebSocket from 'ws';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_PORT = 9878;
const baseUrl = `http://localhost:${TEST_PORT}`;
let serverProcess;

beforeAll(async () => {
  // Spawn the server as a child process on a unique port
  serverProcess = spawn('node', ['server.js', '--port', String(TEST_PORT)], {
    cwd: __dirname,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // Wait for server to be ready by polling
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

function httpGet(urlPath) {
  return new Promise((resolve, reject) => {
    http.get(`${baseUrl}${urlPath}`, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    }).on('error', reject);
  });
}

function connectWs() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${TEST_PORT}/ws`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function waitForMessage(ws) {
  return new Promise((resolve) => {
    ws.once('message', (data) => resolve(JSON.parse(data.toString())));
  });
}

describe('End-to-end integration', () => {
  describe('Static file serving', () => {
    it('serves index.html at root path', async () => {
      const res = await httpGet('/');
      expect(res.status).toBe(200);
      expect(res.body.toLowerCase()).toContain('<!doctype html');
      expect(res.body).toContain('<div id="root">');
    });

    it('serves built JS assets', async () => {
      // Read dist directory to find the JS file
      const distDir = path.join(__dirname, '..', 'dist', 'assets');
      const files = fs.readdirSync(distDir);
      const jsFile = files.find((f) => f.endsWith('.js'));
      expect(jsFile).toBeDefined();

      const res = await httpGet(`/assets/${jsFile}`);
      expect(res.status).toBe(200);
    });

    it('SPA fallback serves index.html for unknown routes', async () => {
      const res = await httpGet('/some/unknown/route');
      expect(res.status).toBe(200);
      expect(res.body.toLowerCase()).toContain('<!doctype html');
    });
  });

  describe('Questions.json serving', () => {
    it('serves questions.json with valid JSON array', async () => {
      const res = await httpGet('/questions.json');
      expect(res.status).toBe(200);

      const questions = JSON.parse(res.body);
      expect(Array.isArray(questions)).toBe(true);
      expect(questions.length).toBeGreaterThan(0);

      // All questions should be strings
      for (const q of questions) {
        expect(typeof q).toBe('string');
      }
    });

    it('questions contain XYZ placeholder', async () => {
      const res = await httpGet('/questions.json');
      const questions = JSON.parse(res.body);

      // At least some questions should have XYZ
      const withXYZ = questions.filter((q) => q.includes('XYZ'));
      expect(withXYZ.length).toBeGreaterThan(0);
    });
  });

  describe('WebSocket connection and relay', () => {
    it('accepts WebSocket upgrade on /ws path', async () => {
      const ws = await connectWs();
      expect(ws.readyState).toBe(WebSocket.OPEN);
      ws.close();
    });

    it('allows clients to join a room and relays messages', async () => {
      const ws1 = await connectWs();
      const ws2 = await connectWs();

      // Client 1 joins room
      ws1.send(JSON.stringify({
        type: 'join_room',
        roomCode: 'TEST',
        playerId: 'player1',
      }));

      // Client 2 joins same room
      ws2.send(JSON.stringify({
        type: 'join_room',
        roomCode: 'TEST',
        playerId: 'player2',
      }));

      // Wait a tick for room association
      await new Promise((r) => setTimeout(r, 50));

      // Client 1 sends a game message
      const msgPromise = waitForMessage(ws2);
      ws1.send(JSON.stringify({
        type: 'player_joined',
        player: { id: 'player1', name: 'Alice', isHost: true, isConnected: true, joinOrder: 1 },
      }));

      const received = await msgPromise;
      expect(received.type).toBe('player_joined');
      expect(received.player.name).toBe('Alice');

      ws1.close();
      ws2.close();
    });

    it('broadcasts disconnect notification when client leaves', async () => {
      const ws1 = await connectWs();
      const ws2 = await connectWs();

      // Both join same room
      ws1.send(JSON.stringify({ type: 'join_room', roomCode: 'DC_TEST', playerId: 'p1' }));
      ws2.send(JSON.stringify({ type: 'join_room', roomCode: 'DC_TEST', playerId: 'p2' }));

      await new Promise((r) => setTimeout(r, 50));

      // Listen for disconnect notification on ws2
      const msgPromise = waitForMessage(ws2);

      // Close ws1
      ws1.close();

      const notification = await msgPromise;
      expect(notification.type).toBe('player_disconnected');
      expect(notification.playerId).toBe('p1');

      ws2.close();
    });

    it('full game flow: join → relay game_start → relay answers → relay votes', async () => {
      const ws1 = await connectWs();
      const ws2 = await connectWs();
      const ws3 = await connectWs();

      // All join same room
      ws1.send(JSON.stringify({ type: 'join_room', roomCode: 'GAME1', playerId: 'host' }));
      ws2.send(JSON.stringify({ type: 'join_room', roomCode: 'GAME1', playerId: 'p2' }));
      ws3.send(JSON.stringify({ type: 'join_room', roomCode: 'GAME1', playerId: 'p3' }));

      await new Promise((r) => setTimeout(r, 50));

      // Host broadcasts game_start
      const msg2Promise = waitForMessage(ws2);
      const msg3Promise = waitForMessage(ws3);

      ws1.send(JSON.stringify({
        type: 'game_start',
        settings: { minPlayers: 3, maxPlayers: 7, answerTimerSeconds: 60, votingTimerSeconds: 30 },
        questions: [0, 1, 2],
        featuredPlayerOrder: ['host', 'p2', 'p3'],
        totalRounds: 3,
      }));

      const [recv2, recv3] = await Promise.all([msg2Promise, msg3Promise]);
      expect(recv2.type).toBe('game_start');
      expect(recv3.type).toBe('game_start');
      expect(recv2.totalRounds).toBe(3);

      // Player 2 submits answer, relayed to ws1 and ws3
      const ans1Promise = waitForMessage(ws1);
      const ans3Promise = waitForMessage(ws3);

      ws2.send(JSON.stringify({
        type: 'answer_submit',
        playerId: 'p2',
        answer: 'A funny answer',
        roundNumber: 1,
      }));

      const [ansRecv1, ansRecv3] = await Promise.all([ans1Promise, ans3Promise]);
      expect(ansRecv1.type).toBe('answer_submit');
      expect(ansRecv1.answer).toBe('A funny answer');
      expect(ansRecv3.type).toBe('answer_submit');

      // Player 3 casts vote, relayed to ws1 and ws2
      const vote1Promise = waitForMessage(ws1);
      const vote2Promise = waitForMessage(ws2);

      ws3.send(JSON.stringify({
        type: 'vote_cast',
        voterId: 'p3',
        answerId: 'p2',
        roundNumber: 1,
      }));

      const [voteRecv1, voteRecv2] = await Promise.all([vote1Promise, vote2Promise]);
      expect(voteRecv1.type).toBe('vote_cast');
      expect(voteRecv2.type).toBe('vote_cast');
      expect(voteRecv1.voterId).toBe('p3');

      ws1.close();
      ws2.close();
      ws3.close();
    });
  });
});
