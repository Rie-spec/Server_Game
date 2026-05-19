// server.js - Main Game Server (Railway.app)
require("dotenv").config();

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");
const { pool, initDB } = require("./db");
const anticheat = require("./anticheat");

const app = express();
const server = http.createServer(app);

// ─── Socket.IO Setup ────────────────────────────────────────────────────────
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingInterval: 10000,
  pingTimeout: 5000,
});

app.use(cors());
app.use(express.json());

// ─── Init DB ────────────────────────────────────────────────────────────────
initDB();

// ─── Health Check ────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({ status: "Game server is running 🎮", uptime: process.uptime() });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  LEADERBOARD REST API
// ═══════════════════════════════════════════════════════════════════════════════

// GET /leaderboard?mode=classic&limit=10
app.get("/leaderboard", async (req, res) => {
  const { mode = "classic", limit = 10 } = req.query;
  try {
    const result = await pool.query(
      `SELECT username, score, game_mode, created_at
       FROM leaderboard
       WHERE game_mode = $1
       ORDER BY score DESC
       LIMIT $2`,
      [mode, parseInt(limit)]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /leaderboard - Submit a score
app.post("/leaderboard", async (req, res) => {
  const { username, score, game_mode = "classic", socketId } = req.body;

  if (!username || score === undefined) {
    return res.status(400).json({ success: false, error: "username and score required" });
  }

  // Anti-cheat: validate score server-side
  if (socketId) {
    const check = anticheat.validateScore(socketId, score);
    if (!check.valid) {
      return res.status(403).json({ success: false, error: check.reason });
    }
  }

  // Server-side sanity check
  if (score < 0 || score > 9999999) {
    return res.status(400).json({ success: false, error: "Invalid score range" });
  }

  try {
    await pool.query(
      `INSERT INTO leaderboard (username, score, game_mode) VALUES ($1, $2, $3)`,
      [username.substring(0, 50), score, game_mode]
    );
    res.json({ success: true, message: "Score submitted!" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /leaderboard/rank?username=PlayerOne
app.get("/leaderboard/rank", async (req, res) => {
  const { username, mode = "classic" } = req.query;
  try {
    const result = await pool.query(
      `SELECT COUNT(*) + 1 AS rank FROM leaderboard
       WHERE score > (SELECT MAX(score) FROM leaderboard WHERE username = $1 AND game_mode = $2)
       AND game_mode = $2`,
      [username, mode]
    );
    res.json({ success: true, rank: parseInt(result.rows[0].rank) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /chat/history?roomId=room123&limit=50
app.get("/chat/history", async (req, res) => {
  const { roomId, limit = 50 } = req.query;
  try {
    const result = await pool.query(
      `SELECT username, message, sent_at FROM chat_messages
       WHERE room_id = $1 ORDER BY sent_at DESC LIMIT $2`,
      [roomId, parseInt(limit)]
    );
    res.json({ success: true, data: result.rows.reverse() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  SOCKET.IO — REAL-TIME MULTIPLAYER + CHAT
// ═══════════════════════════════════════════════════════════════════════════════

// Track active rooms
const rooms = new Map(); // roomId -> { players: Map<socketId, playerData> }

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, { players: new Map(), gameState: "waiting" });
  }
  return rooms.get(roomId);
}

io.on("connection", (socket) => {
  console.log(`🔌 Player connected: ${socket.id}`);

  // ── JOIN ROOM ───────────────────────────────────────────────────────────────
  socket.on("joinRoom", ({ roomId, username }) => {
    if (!roomId || !username) return;

    const room = getOrCreateRoom(roomId);
    const playerData = {
      socketId: socket.id,
      username: username.substring(0, 30),
      roomId,
      position: { x: 0, y: 0 },
      health: 100,
      score: 0,
      joinedAt: Date.now(),
    };

    room.players.set(socket.id, playerData);
    socket.join(roomId);
    socket.roomId = roomId;
    socket.username = username;

    // Tell this player about everyone already in room
    const otherPlayers = [...room.players.values()].filter(
      (p) => p.socketId !== socket.id
    );
    socket.emit("roomJoined", {
      roomId,
      playerId: socket.id,
      players: otherPlayers,
      playerCount: room.players.size,
    });

    // Tell others a new player joined
    socket.to(roomId).emit("playerJoined", playerData);

    console.log(`👤 ${username} joined room: ${roomId} (${room.players.size} players)`);

    // Auto-start game when 2+ players join
    if (room.players.size >= 2 && room.gameState === "waiting") {
      room.gameState = "playing";
      io.to(roomId).emit("gameStarted", { roomId, playerCount: room.players.size });
      console.log(`🎮 Game started in room: ${roomId}`);
    }
  });

  // ── PLAYER MOVE ─────────────────────────────────────────────────────────────
  socket.on("playerMove", ({ position, roomId }) => {
    // Anti-cheat: validate movement
    const check = anticheat.validateMove(socket.id, position);
    if (!check.valid) {
      socket.emit("cheatDetected", { reason: check.reason });

      // Kick after 5 violations
      if (anticheat.getViolations(socket.id) >= 5) {
        socket.emit("kicked", { reason: "Too many violations" });
        socket.disconnect(true);
      }
      return;
    }

    const room = rooms.get(roomId);
    if (!room) return;

    const player = room.players.get(socket.id);
    if (player) {
      player.position = position;
      room.players.set(socket.id, player);
    }

    // Broadcast position to everyone else in the room
    socket.to(roomId).emit("playerMoved", {
      socketId: socket.id,
      position,
      username: socket.username,
    });
  });

  // ── GAME ACTION (attack, collect item, etc.) ────────────────────────────────
  socket.on("gameAction", ({ type, data, roomId }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    const player = room.players.get(socket.id);
    if (!player) return;

    // Process different action types
    switch (type) {
      case "attack":
        // Validate attack and broadcast hit to target
        const targetId = data.targetId;
        const target = room.players.get(targetId);
        if (target) {
          const damage = Math.min(data.damage || 10, 50); // cap damage server-side
          target.health = Math.max(0, target.health - damage);
          room.players.set(targetId, target);

          io.to(roomId).emit("playerHit", {
            attackerId: socket.id,
            targetId,
            damage,
            targetHealth: target.health,
          });

          // Update attacker score
          player.score += 10;
          room.players.set(socket.id, player);
          socket.emit("scoreUpdated", { score: player.score });

          if (target.health <= 0) {
            io.to(roomId).emit("playerEliminated", {
              eliminatedId: targetId,
              byId: socket.id,
              byUsername: player.username,
            });
          }
        }
        break;

      case "collectItem":
        const itemScore = Math.min(data.itemValue || 5, 50); // cap item value
        player.score += itemScore;
        room.players.set(socket.id, player);
        socket.emit("scoreUpdated", { score: player.score });
        socket.to(roomId).emit("itemCollected", { playerId: socket.id, itemId: data.itemId });
        break;
    }
  });

  // ── CHAT MESSAGE ────────────────────────────────────────────────────────────
  socket.on("sendMessage", async ({ roomId, message }) => {
    const check = anticheat.validateChatMessage(message);
    if (!check.valid) {
      socket.emit("messageRejected", { reason: check.reason });
      return;
    }

    const chatData = {
      id: uuidv4(),
      socketId: socket.id,
      username: socket.username || "Unknown",
      message: check.cleaned,
      timestamp: Date.now(),
    };

    // Broadcast to room
    io.to(roomId).emit("newMessage", chatData);

    // Save to DB
    try {
      await pool.query(
        `INSERT INTO chat_messages (room_id, username, message) VALUES ($1, $2, $3)`,
        [roomId, chatData.username, chatData.message]
      );
    } catch (err) {
      console.error("Chat save error:", err.message);
    }
  });

  // ── DISCONNECT ──────────────────────────────────────────────────────────────
  socket.on("disconnect", () => {
    const roomId = socket.roomId;
    if (roomId) {
      const room = rooms.get(roomId);
      if (room) {
        room.players.delete(socket.id);
        socket.to(roomId).emit("playerLeft", {
          socketId: socket.id,
          username: socket.username,
          playerCount: room.players.size,
        });

        // Clean up empty rooms
        if (room.players.size === 0) {
          rooms.delete(roomId);
          console.log(`🗑️  Room ${roomId} removed (empty)`);
        }
      }
    }

    anticheat.removePlayer(socket.id);
    console.log(`🔌 Player disconnected: ${socket.id}`);
  });
});

// ─── Start Server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Game server running on port ${PORT}`);
});