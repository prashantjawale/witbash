import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import WebSocket from "ws";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { httpServer, wss, rooms } = require("./server");

const PORT = 9876;

function createClient() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${PORT}`);
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

function waitForMessage(ws) {
  return new Promise((resolve) => {
    ws.once("message", (data) => resolve(JSON.parse(data.toString())));
  });
}

function waitForClose(ws) {
  return new Promise((resolve) => {
    ws.once("close", () => resolve());
  });
}

describe("WebSocket Relay", () => {
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

  it("should associate a client with a room on join_room message", async () => {
    const client = await createClient();

    client.send(
      JSON.stringify({
        type: "join_room",
        roomCode: "ABCD",
        playerId: "player1",
      })
    );

    await new Promise((r) => setTimeout(r, 50));

    expect(rooms.has("ABCD")).toBe(true);
    expect(rooms.get("ABCD").size).toBe(1);

    client.close();
    await waitForClose(client);
  });

  it("should relay messages to other clients in the same room (exclude sender)", async () => {
    const client1 = await createClient();
    const client2 = await createClient();
    const client3 = await createClient();

    client1.send(JSON.stringify({ type: "join_room", roomCode: "ROOM1", playerId: "p1" }));
    client2.send(JSON.stringify({ type: "join_room", roomCode: "ROOM1", playerId: "p2" }));
    client3.send(JSON.stringify({ type: "join_room", roomCode: "ROOM1", playerId: "p3" }));

    await new Promise((r) => setTimeout(r, 50));

    const msg2Promise = waitForMessage(client2);
    const msg3Promise = waitForMessage(client3);

    const gameMsg = {
      type: "answer_submit",
      playerId: "p1",
      answer: "test answer",
      roundNumber: 1,
    };
    client1.send(JSON.stringify(gameMsg));

    const received2 = await msg2Promise;
    const received3 = await msg3Promise;

    expect(received2).toEqual(gameMsg);
    expect(received3).toEqual(gameMsg);

    client1.close();
    client2.close();
    client3.close();
    await Promise.all([
      waitForClose(client1),
      waitForClose(client2),
      waitForClose(client3),
    ]);
  });

  it("should discard messages from clients not yet associated with a room", async () => {
    const client1 = await createClient();
    const client2 = await createClient();

    client2.send(JSON.stringify({ type: "join_room", roomCode: "ROOM2", playerId: "p2" }));
    await new Promise((r) => setTimeout(r, 50));

    // Client1 sends a non-join message without being associated
    client1.send(JSON.stringify({ type: "answer_submit", playerId: "p1", answer: "hello" }));
    await new Promise((r) => setTimeout(r, 50));

    let received = false;
    client2.once("message", () => {
      received = true;
    });
    await new Promise((r) => setTimeout(r, 100));
    expect(received).toBe(false);

    client1.close();
    client2.close();
    await Promise.all([waitForClose(client1), waitForClose(client2)]);
  });

  it("should broadcast player_disconnected on client disconnect", async () => {
    const client1 = await createClient();
    const client2 = await createClient();

    client1.send(JSON.stringify({ type: "join_room", roomCode: "ROOM3", playerId: "p1" }));
    client2.send(JSON.stringify({ type: "join_room", roomCode: "ROOM3", playerId: "p2" }));
    await new Promise((r) => setTimeout(r, 50));

    const msgPromise = waitForMessage(client2);

    client1.close();

    const notification = await msgPromise;
    expect(notification.type).toBe("player_disconnected");
    expect(notification.playerId).toBe("p1");

    client2.close();
    await waitForClose(client2);
  });

  it("should remove disconnected client from room map", async () => {
    const client1 = await createClient();

    client1.send(JSON.stringify({ type: "join_room", roomCode: "ROOM4", playerId: "p1" }));
    await new Promise((r) => setTimeout(r, 50));

    expect(rooms.get("ROOM4").size).toBe(1);

    client1.close();
    await waitForClose(client1);
    await new Promise((r) => setTimeout(r, 50));

    // Room should be cleaned up (empty rooms are deleted)
    expect(rooms.has("ROOM4")).toBe(false);
  });

  it("should not relay join_room message to other clients", async () => {
    const client1 = await createClient();
    const client2 = await createClient();

    client1.send(JSON.stringify({ type: "join_room", roomCode: "ROOM5", playerId: "p1" }));
    await new Promise((r) => setTimeout(r, 50));

    let received = false;
    client1.on("message", () => {
      received = true;
    });

    client2.send(JSON.stringify({ type: "join_room", roomCode: "ROOM5", playerId: "p2" }));
    await new Promise((r) => setTimeout(r, 100));

    expect(received).toBe(false);

    client1.close();
    client2.close();
    await Promise.all([waitForClose(client1), waitForClose(client2)]);
  });

  it("should not relay messages between different rooms", async () => {
    const client1 = await createClient();
    const client2 = await createClient();

    client1.send(JSON.stringify({ type: "join_room", roomCode: "AAAA", playerId: "p1" }));
    client2.send(JSON.stringify({ type: "join_room", roomCode: "BBBB", playerId: "p2" }));
    await new Promise((r) => setTimeout(r, 50));

    let received = false;
    client2.on("message", () => {
      received = true;
    });

    client1.send(JSON.stringify({ type: "game_start", settings: {} }));
    await new Promise((r) => setTimeout(r, 100));

    expect(received).toBe(false);

    client1.close();
    client2.close();
    await Promise.all([waitForClose(client1), waitForClose(client2)]);
  });

  it("should close connection if message exceeds 64 KB", async () => {
    const client = await createClient();

    // Suppress the expected client-side error from ws library
    client.on("error", () => {});

    client.send(JSON.stringify({ type: "join_room", roomCode: "ROOM6", playerId: "p1" }));
    await new Promise((r) => setTimeout(r, 50));

    const closePromise = waitForClose(client);

    // Send a message larger than 64 KB
    const largePayload = "x".repeat(65 * 1024);
    client.send(largePayload);

    await closePromise;
    expect(client.readyState).toBe(WebSocket.CLOSED);
  });
});
