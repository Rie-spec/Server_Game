# 🚂 Railway.app Deployment Guide

## Project Structure
```
game-server/
├── server.js          ← Main server (Express + Socket.IO)
├── db.js              ← PostgreSQL connection
├── anticheat.js       ← Anti-cheat validation
├── package.json       ← Dependencies
├── .env.example       ← Environment variables template
└── android/
    ├── GameSocketManager.kt   ← Socket.IO client
    ├── ApiService.kt          ← Retrofit REST client
    ├── LeaderboardActivity.kt ← Leaderboard screen
    ├── GameActivity.kt        ← Main game screen
    └── build.gradle           ← Android dependencies
```

---

## 🚀 Deploy to Railway (Step by Step)

### Step 1 — Create Railway account
1. Go to https://railway.app
2. Sign up with GitHub

### Step 2 — Create a new project
1. Click **"New Project"**
2. Select **"Deploy from GitHub repo"**
3. Select your repository (push the `game-server` folder to GitHub first)

### Step 3 — Add PostgreSQL database
1. Inside your Railway project, click **"New"**
2. Select **"Database"** → **"Add PostgreSQL"**
3. Railway will automatically set `DATABASE_URL` as an environment variable ✅

### Step 4 — Set environment variables
Railway auto-sets these for you:
- `DATABASE_URL` — PostgreSQL connection string (auto-set)
- `PORT` — server port (auto-set)

No manual configuration needed!

### Step 5 — Deploy
Railway auto-deploys on every push to your GitHub repo.
Your server URL will be: `https://your-app-name.railway.app`

---

## 🔁 Update Android Code

After deploying, replace the placeholder URL in both Kotlin files:

**GameSocketManager.kt** (line 28):
```kotlin
private const val SERVER_URL = "https://your-app-name.railway.app"
```

**ApiService.kt** (line 61):
```kotlin
private const val BASE_URL = "https://your-app-name.railway.app/"
```

---

## 🧪 Test Your Server

After deployment, open in browser:
```
https://your-app-name.railway.app/
```
Should return:
```json
{ "status": "Game server is running 🎮", "uptime": 12.5 }
```

Test leaderboard API:
```
https://your-app-name.railway.app/leaderboard?mode=classic&limit=10
```

---

## 💰 Railway Pricing
- **Free tier**: $5 free credits/month (enough for testing)
- **Hobby plan**: $5/month (for small games)
- **Pro plan**: $20/month (for production)

---

## 🔒 Security Checklist
- [x] Server validates all player moves (anti-cheat)
- [x] Server validates all score submissions
- [x] Server caps damage values
- [x] Chat messages sanitized and length-limited
- [x] Players with 5+ violations are kicked
- [x] SSL enabled by default on Railway
- [ ] Add rate limiting (express-rate-limit) for production
- [ ] Add JWT authentication for production
