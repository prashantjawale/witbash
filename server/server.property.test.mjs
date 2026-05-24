import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import fc from "fast-check";
import WebSocket from "ws";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { httpServer, wss, rooms } = require("./server");

const PORT = 9877;

function createClient() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${PORT}`);
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

function waitForMessage(ws, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Message timeout")), timeoutMs);
    ws.once("message", (data) => {
      clearTimeout(timer);
      resolve(data.toString());
    });
  });
}

function waitForClose(ws, timeoutMs = 2000) {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) {
      resolve();
      return;
    }
    const timer = setTimeout(() => resolve(), timeoutMs);
    ws.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function collectMessages(ws, count, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const messages = [];
    const timer = setTimeout(() => resolve(messages), timeoutMs);
    const handler = (data) => {
      messages.push(data.toString());
      if (messages.length >= count) {
        clearTimeout(timer);
        ws.removeListener("message", handler);
        resolve(messages);
      }
    };
    ws.on("message", handler);
  });
}

async function joinRoom(ws, roomCode, playerId) {
  ws.send(JSON.stringify({ type: "join_room", roomCode, playerId }));
  await new Promise((r) => setTimeout(r, 30));
}

async function closeAllClients(clients) {
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.close();
    }
  }
  await Promise.all(clients.map((c) => waitForClose(c)));
}

describe("Feature: lan-party-game - Server Relay Property Tests", () => {
  beforeAll(async () => {
    await new Promise((resolve) => httpServer.listen(PORT, resolve));
  });

  afterAll(async () => {
    for (const client of wss.clients) {
      client.terminate();
    }
    await new Promise((resolve) => httpServer.close(resolve));
  });

  beforeEach(() => {
    rooms.clear();
  });

  describe("Property 20: WebSocket relay broadcast correctness", () => {
    /**
     * For any message sent by a client in a room of N clients,
     * verify relay to exactly N-1 others unmodified.
     *
     * Validates: Requirements 11.1
     */
    it("Property 20: WebSocket relay broadcast correctness - For any message sent by a client in a room of N clients, verify relay to exactly N-1 others unmodified", async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate room size between 2 and 5 (keep small for test speed)
          fc.integer({ min: 2, max: 5 }),
          // Generate a random message payload (valid JSON object with type field)
          fc.record({
            type: fc.constantFrom("answer_submit", "vote_cast", "game_start", "round_begin"),
            playerId: fc.string({ minLength: 1, maxLength: 10 }),
            data: fc.string({ minLength: 1, maxLength: 100 }),
          }),
          async (roomSize, messagePayload) => {
            const roomCode = `R${Date.now().toString(36).slice(-3).toUpperCase()}`;
            const clients = [];

            try {
              // Create N clients and join them to the same room
              for (let i = 0; i < roomSize; i++) {
                const client = await createClient();
                clients.push(client);
                await joinRoom(client, roomCode, `player${i}`);
              }

              // Set up message collectors on all clients except the sender (index 0)
              const receivers = clients.slice(1);
              const messagePromises = receivers.map((c) => waitForMessage(c));

              // Sender sends the message
              const sentPayload = JSON.stringify(messagePayload);
              clients[0].send(sentPayload);

              // All N-1 receivers should get the message
              const receivedMessages = await Promise.all(messagePromises);

              // Verify exactly N-1 messages received, all unmodified
              expect(receivedMessages.length).toBe(roomSize - 1);
              for (const msg of receivedMessages) {
                expect(msg).toBe(sentPayload);
              }
            } finally {
              await closeAllClients(clients);
              await new Promise((r) => setTimeout(r, 50));
            }
          }
        ),
        { numRuns: 20 }
      );
    });

    it("Property 20: sender does not receive its own message", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            type: fc.constantFrom("answer_submit", "vote_cast", "game_start"),
            content: fc.string({ minLength: 1, maxLength: 50 }),
          }),
          async (messagePayload) => {
            const roomCode = `S${Date.now().toString(36).slice(-3).toUpperCase()}`;
            const clients = [];

            try {
              // Create 2 clients in the same room
              for (let i = 0; i < 2; i++) {
                const client = await createClient();
                clients.push(client);
                await joinRoom(client, roomCode, `p${i}`);
              }

              // Listen for messages on the sender
              let senderReceived = false;
              clients[0].on("message", () => {
                senderReceived = true;
              });

              // Send message from client 0
              clients[0].send(JSON.stringify(messagePayload));

              // Wait a bit to ensure no message arrives at sender
              await new Promise((r) => setTimeout(r, 100));

              expect(senderReceived).toBe(false);
            } finally {
              await closeAllClients(clients);
              await new Promise((r) => setTimeout(r, 50));
            }
          }
        ),
        { numRuns: 20 }
      );
    });
  });

  describe("Property 21: Disconnect notification relay", () => {
    /**
     * For any client that disconnects from a room, the server SHALL remove
     * that connection from the room mapping and relay a disconnect notification
     * to all remaining clients in that room.
     *
     * Validates: Requirements 11.4
     */
    it("Property 21: Disconnect notification relay - For any client disconnect, verify removal from room map and notification to remaining clients", async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate room size between 2 and 5
          fc.integer({ min: 2, max: 5 }),
          // Which client disconnects (index into the array, excluding last to always have receivers)
          fc.integer({ min: 0, max: 100 }),
          async (roomSize, disconnectIndexRaw) => {
            const disconnectIndex = disconnectIndexRaw % roomSize;
            const roomCode = `D${Date.now().toString(36).slice(-3).toUpperCase()}`;
            const clients = [];

            try {
              // Create N clients and join them to the same room
              for (let i = 0; i < roomSize; i++) {
                const client = await createClient();
                clients.push(client);
                await joinRoom(client, roomCode, `player${i}`);
              }

              // Verify room has N clients
              expect(rooms.get(roomCode).size).toBe(roomSize);

              // Set up message collectors on remaining clients
              const remainingClients = clients.filter((_, idx) => idx !== disconnectIndex);
              const messagePromises = remainingClients.map((c) => waitForMessage(c));

              // Disconnect the chosen client
              const disconnectedPlayerId = `player${disconnectIndex}`;
              clients[disconnectIndex].close();
              await waitForClose(clients[disconnectIndex]);

              // Wait for disconnect notification to propagate
              if (remainingClients.length > 0) {
                const notifications = await Promise.all(messagePromises);

                // Verify all remaining clients received the disconnect notification
                for (const notification of notifications) {
                  const parsed = JSON.parse(notification);
                  expect(parsed.type).toBe("player_disconnected");
                  expect(parsed.playerId).toBe(disconnectedPlayerId);
                }
              }

              // Verify the disconnected client was removed from the room map
              await new Promise((r) => setTimeout(r, 50));
              const room = rooms.get(roomCode);
              if (room) {
                expect(room.size).toBe(roomSize - 1);
              } else {
                // Room was cleaned up because it became empty
                expect(roomSize).toBe(1);
              }
            } finally {
              await closeAllClients(clients);
              await new Promise((r) => setTimeout(r, 50));
            }
          }
        ),
        { numRuns: 20 }
      );
    });

    it("Property 21: empty room is cleaned up after last client disconnects", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 8 }),
          async (playerName) => {
            const roomCode = `E${Date.now().toString(36).slice(-3).toUpperCase()}`;
            const client = await createClient();

            try {
              await joinRoom(client, roomCode, playerName);
              expect(rooms.has(roomCode)).toBe(true);

              client.close();
              await waitForClose(client);
              await new Promise((r) => setTimeout(r, 50));

              // Room should be cleaned up
              expect(rooms.has(roomCode)).toBe(false);
            } finally {
              if (client.readyState === WebSocket.OPEN) {
                client.close();
                await waitForClose(client);
              }
            }
          }
        ),
        { numRuns: 20 }
      );
    });
  });

  describe("Property 22: Message size enforcement", () => {
    /**
     * For any message, verify acceptance if ≤64 KB and connection close if >64 KB.
     *
     * Validates: Requirements 11.6
     */
    it("Property 22: Message size enforcement - messages ≤64 KB are accepted and relayed", async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate message sizes that are within the 64 KB limit
          // Use sizes from 1 byte to 60 KB (leaving room for JSON overhead)
          fc.integer({ min: 1, max: 60 * 1024 }),
          async (payloadSize) => {
            const roomCode = `M${Date.now().toString(36).slice(-3).toUpperCase()}`;
            const clients = [];

            try {
              const sender = await createClient();
              const receiver = await createClient();
              clients.push(sender, receiver);

              await joinRoom(sender, roomCode, "sender");
              await joinRoom(receiver, roomCode, "receiver");

              // Create a message within the size limit
              const payload = JSON.stringify({
                type: "answer_submit",
                data: "x".repeat(Math.min(payloadSize, 60 * 1024)),
              });

              // Only test if the total payload is within 64KB
              if (Buffer.byteLength(payload) <= 64 * 1024) {
                const msgPromise = waitForMessage(receiver);
                sender.send(payload);

                const received = await msgPromise;
                expect(received).toBe(payload);
              }
            } finally {
              await closeAllClients(clients);
              await new Promise((r) => setTimeout(r, 50));
            }
          }
        ),
        { numRuns: 10 }
      );
    });

    it("Property 22: Message size enforcement - messages >64 KB cause connection close", async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate sizes just over 64 KB (65 KB to 70 KB)
          fc.integer({ min: 65 * 1024, max: 70 * 1024 }),
          async (payloadSize) => {
            const roomCode = `L${Date.now().toString(36).slice(-3).toUpperCase()}`;

            const client = await createClient();
            // Suppress expected error from ws library when connection is closed
            client.on("error", () => {});

            try {
              await joinRoom(client, roomCode, "bigSender");

              const closePromise = waitForClose(client);

              // Send a message larger than 64 KB
              const largePayload = "x".repeat(payloadSize);
              client.send(largePayload);

              await closePromise;
              expect(client.readyState).toBe(WebSocket.CLOSED);
            } finally {
              if (client.readyState === WebSocket.OPEN) {
                client.close();
                await waitForClose(client);
              }
              await new Promise((r) => setTimeout(r, 50));
            }
          }
        ),
        { numRuns: 10 }
      );
    });
  });
});
