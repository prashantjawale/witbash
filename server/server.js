const express = require("express");
const path = require("path");
const { createServer } = require("http");
const { WebSocketServer } = require("ws");
const os = require("os");

// --- CLI argument parsing ---
const args = process.argv.slice(2);
let port = 3000;

const portFlagIndex = args.indexOf("--port");
if (portFlagIndex !== -1) {
  const portValue = args[portFlagIndex + 1];

  // Missing value after --port flag
  if (portValue === undefined || portValue.startsWith("--")) {
    console.error(
      `Error: Missing value for --port flag. Port must be an integer between 1024 and 65535.`
    );
    process.exit(1);
  }

  const parsed = Number(portValue);

  if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65535) {
    console.error(
      `Error: Invalid port "${portValue}". Port must be an integer between 1024 and 65535.`
    );
    process.exit(1);
  }

  port = parsed;
}

// --- Express setup ---
const app = express();

// Serve built React app from dist/ (project root level, built by Vite from client/)
const staticDir = path.join(__dirname, "..", "dist");
app.use(express.static(staticDir));

// Serve questions.json
app.get("/questions.json", (req, res) => {
  res.sendFile(path.join(__dirname, "data", "questions.json"));
});

// SPA fallback — all unmatched routes serve index.html
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "dist", "index.html"));
});

// --- HTTP + WebSocket server ---
const httpServer = createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

// Handle HTTP upgrade to WebSocket
httpServer.on("upgrade", (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request);
  });
});

// Room mapping: roomCode → Set<WebSocket>
const rooms = new Map();

wss.on("connection", (ws) => {
  ws.roomCode = null;
  ws.playerId = null;

  ws.on("error", (err) => {
    // Handle errors (e.g., maxPayload exceeded) gracefully
    // The ws library will close the connection automatically
  });

  ws.on("message", (data) => {
    // Enforce 64 KB message size limit (ws handles this via maxPayload,
    // but we also guard here for safety)
    if (data.length > 64 * 1024) {
      ws.close();
      return;
    }

    // If not yet associated with a room, expect a join_room message
    if (!ws.roomCode) {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        // Invalid JSON before room association — discard
        return;
      }

      if (msg.type !== "join_room" || !msg.roomCode || !msg.playerId) {
        // Discard messages from clients not yet associated with a room
        console.log(`[WS] Discarding message from unassociated client: ${msg.type}`);
        return;
      }

      ws.roomCode = msg.roomCode;
      ws.playerId = msg.playerId;

      if (!rooms.has(msg.roomCode)) {
        rooms.set(msg.roomCode, new Set());
      }
      rooms.get(msg.roomCode).add(ws);
      console.log(`[WS] Client ${msg.playerId} joined room ${msg.roomCode} (${rooms.get(msg.roomCode).size} clients)`);
      return;
    }

    // Client is associated with a room — relay message unmodified to all others
    const room = rooms.get(ws.roomCode);
    if (!room) return;

    const msgStr = data.toString();
    let msgType = 'unknown';
    try { msgType = JSON.parse(msgStr).type; } catch {}
    console.log(`[WS] Relaying ${msgType} from ${ws.playerId} to ${room.size - 1} clients in room ${ws.roomCode}`);

    for (const client of room) {
      if (client !== ws && client.readyState === 1) {
        client.send(data.toString());
      }
    }
  });

  ws.on("close", () => {
    if (!ws.roomCode) return;

    const room = rooms.get(ws.roomCode);
    if (!room) return;

    room.delete(ws);

    // Broadcast player_disconnected notification to remaining clients
    if (ws.playerId) {
      const notification = JSON.stringify({
        type: "player_disconnected",
        playerId: ws.playerId,
      });

      for (const client of room) {
        if (client.readyState === 1) {
          client.send(notification);
        }
      }
    }

    // Clean up empty rooms
    if (room.size === 0) {
      rooms.delete(ws.roomCode);
    }
  });
});

// Register error handler before listen to catch EADDRINUSE
httpServer.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `Error: Port ${port} is already in use. Please choose a different port.`
    );
    process.exit(1);
  }
  console.error(`Error: ${err.message}`);
  process.exit(1);
});

// --- Start server (only when run directly) ---
if (require.main === module) {
  httpServer.listen(port, () => {
    // Print LAN IPv4 address
    const interfaces = os.networkInterfaces();
    let lanAddress = "localhost";

    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === "IPv4" && !iface.internal) {
          lanAddress = iface.address;
          break;
        }
      }
      if (lanAddress !== "localhost") break;
    }

    console.log(
      `WitBash server running at http://${lanAddress}:${port}`
    );
  });
}

module.exports = { httpServer, wss, rooms };
