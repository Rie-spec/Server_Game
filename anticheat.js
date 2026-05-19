// anticheat.js - Server-side validation (never trust the client!)

const MAX_SPEED = 8;           // max units a player can move per update
const MAX_SCORE_PER_HIT = 100; // max score a single hit can give
const MIN_ACTION_INTERVAL = 100; // ms between actions (prevents rapid-fire hacks)
const MAP_BOUNDS = { minX: 0, maxX: 1000, minY: 0, maxY: 1000 };

// Track each player's last known state
const playerStates = new Map();

function getDistance(pos1, pos2) {
  return Math.sqrt(
    Math.pow(pos2.x - pos1.x, 2) + Math.pow(pos2.y - pos1.y, 2)
  );
}

// Validate a player's move
function validateMove(socketId, newPosition) {
  const state = playerStates.get(socketId);

  // First move — set initial state
  if (!state) {
    playerStates.set(socketId, {
      position: newPosition,
      lastAction: Date.now(),
      score: 0,
      violations: 0,
    });
    return { valid: true };
  }

  const now = Date.now();
  const timeDiff = now - state.lastAction;

  // Check action rate (anti rapid-action hack)
  if (timeDiff < MIN_ACTION_INTERVAL) {
    state.violations++;
    console.warn(`⚠️  Speed action hack detected: ${socketId}`);
    return { valid: false, reason: "Too many actions" };
  }

  // Check movement speed (anti speed hack)
  const distance = getDistance(state.position, newPosition);
  if (distance > MAX_SPEED) {
    state.violations++;
    console.warn(`⚠️  Speed hack detected: ${socketId} moved ${distance.toFixed(2)} units`);
    return { valid: false, reason: "Movement too fast" };
  }

  // Check map bounds (anti teleport/out-of-bounds hack)
  if (
    newPosition.x < MAP_BOUNDS.minX || newPosition.x > MAP_BOUNDS.maxX ||
    newPosition.y < MAP_BOUNDS.minY || newPosition.y > MAP_BOUNDS.maxY
  ) {
    state.violations++;
    console.warn(`⚠️  Out of bounds detected: ${socketId}`);
    return { valid: false, reason: "Out of bounds" };
  }

  // Update state
  state.position = newPosition;
  state.lastAction = now;
  playerStates.set(socketId, state);

  return { valid: true };
}

// Validate a score submission
function validateScore(socketId, claimedScore) {
  const state = playerStates.get(socketId);
  if (!state) return { valid: false, reason: "Unknown player" };

  // Score shouldn't jump by an unreasonable amount
  const scoreDiff = claimedScore - state.score;
  if (scoreDiff > MAX_SCORE_PER_HIT) {
    state.violations++;
    console.warn(`⚠️  Score hack detected: ${socketId} claimed +${scoreDiff}`);
    return { valid: false, reason: "Score jump too large" };
  }

  if (claimedScore < state.score) {
    return { valid: false, reason: "Score cannot decrease" };
  }

  state.score = claimedScore;
  playerStates.set(socketId, state);
  return { valid: true };
}

// Validate chat message (basic spam/abuse filter)
function validateChatMessage(message) {
  if (!message || typeof message !== "string") return { valid: false, reason: "Invalid message" };
  if (message.trim().length === 0) return { valid: false, reason: "Empty message" };
  if (message.length > 200) return { valid: false, reason: "Message too long" };
  return { valid: true, cleaned: message.trim().substring(0, 200) };
}

// Get violation count (kick players with too many violations)
function getViolations(socketId) {
  return playerStates.get(socketId)?.violations || 0;
}

// Remove player state on disconnect
function removePlayer(socketId) {
  playerStates.delete(socketId);
}

module.exports = {
  validateMove,
  validateScore,
  validateChatMessage,
  getViolations,
  removePlayer,
};