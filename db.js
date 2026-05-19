// db.js - PostgreSQL connection (Railway provides DATABASE_URL automatically)
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Required for Railway PostgreSQL
});

// Create tables on startup
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS leaderboard (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) NOT NULL,
        score INTEGER NOT NULL,
        game_mode VARCHAR(30) DEFAULT 'classic',
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS players (
        id SERIAL PRIMARY KEY,
        socket_id VARCHAR(100),
        username VARCHAR(50) NOT NULL,
        room_id VARCHAR(50),
        position_x FLOAT DEFAULT 0,
        position_y FLOAT DEFAULT 0,
        health INTEGER DEFAULT 100,
        score INTEGER DEFAULT 0,
        last_action TIMESTAMP DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id SERIAL PRIMARY KEY,
        room_id VARCHAR(50) NOT NULL,
        username VARCHAR(50) NOT NULL,
        message TEXT NOT NULL,
        sent_at TIMESTAMP DEFAULT NOW()
      );
    `);

    console.log("✅ Database tables initialized");
  } catch (err) {
    console.error("❌ DB Init Error:", err.message);
  }
}

module.exports = { pool, initDB };