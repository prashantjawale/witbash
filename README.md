<p align="center">
  <h1 align="center">🎉 WitBash</h1>
  <p align="center"><strong>The open-source Quiplash clone you can self-host in 30 seconds</strong></p>
  <p align="center">A multiplayer party game for 3–10 players on the same WiFi. No accounts. No internet. No app installs. Just laughs.</p>
</p>

<p align="center">
  <a href="#-quick-start"><img src="https://img.shields.io/badge/setup-30%20seconds-brightgreen?style=for-the-badge" alt="Setup time"></a>
  <a href="#-how-to-play"><img src="https://img.shields.io/badge/players-3%20to%2010-blue?style=for-the-badge" alt="Players"></a>
  <a href="#-features"><img src="https://img.shields.io/badge/questions-300+-orange?style=for-the-badge" alt="Questions"></a>
  <img src="https://img.shields.io/badge/internet-not%20required-red?style=for-the-badge" alt="No internet">
</p>

<p align="center">
  <img src="https://img.shields.io/github/license/prashantjawale/witbash?style=flat-square" alt="License">
  <img src="https://img.shields.io/github/stars/prashantjawale/witbash?style=flat-square" alt="Stars">
  <img src="https://img.shields.io/github/forks/prashantjawale/witbash?style=flat-square" alt="Forks">
</p>

---

## 💡 What is this?

**WitBash** is a free, self-hosted party game where players answer hilarious questions about each other, then vote on the funniest response. Think Jackbox/Quiplash — but you own it, it's free, and it works offline on any WiFi network.

One person runs the server. Everyone else opens a URL on their phone/laptop. That's it.

**Perfect for:**

- 🏠 House parties
- 🏢 Office team building
- 🎓 College dorm nights
- 🏕️ Trips with no internet
- 🍻 Pre-game warmups

---

## ✨ Features

| Feature                       | Description                                                            |
| ----------------------------- | ---------------------------------------------------------------------- |
| 🌐 **LAN-only**               | Runs on your local network — no cloud, no accounts, no data collection |
| 📱 **Any device**             | Works on any browser — phones, tablets, laptops, smart fridges         |
| ⚡ **Instant setup**          | Clone → install → run. Under 30 seconds                                |
| 🎯 **100 questions**          | Spicy, funny, and personalized with player names                       |
| 👥 **Dual-player questions**  | Some questions pit two players against each other                      |
| 🔄 **Infinite replayability** | Random question selection, different every game                        |
| 🎨 **Dark game UI**           | Looks great on any screen, mobile-first design                         |
| 🛡️ **Host-authoritative**     | No cheating — the host controls all game state                         |
| 🧪 **Well-tested**            | 440+ tests including property-based testing                            |

---

## 🚀 Quick Start

```bash
# Clone it
git clone https://github.com/prashantjawale/witbash.git
cd witbash

# Install & build (one-time)
cd server && npm install && cd ..
cd client && npm install && npx vite build && cd ..

# Run it
node server/server.js
```

Open the URL shown in terminal on all devices. Done.

---

## 🎮 How to Play

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   CREATE    │────▶│    ANSWER   │────▶│    VOTE     │────▶│   RESULTS   │
│    ROOM     │     │  QUESTIONS  │     │ ANONYMOUSLY │     │  & SCORES   │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
```

### Host

1. Open the game URL → Enter name → **Create Room**
2. Share the 4-letter code with friends
3. Click **Start Game** when everyone's in (min 3 players)

### Players

1. Open the game URL → Enter name + room code → **Join Room**
2. Answer the question before time runs out
3. Vote for your favorite answer (can't vote for your own)
4. Laugh at the results. Repeat.

### The Twist

- Questions use **real player names** — "What would _Sarah_ bring to a deserted island?"
- Some questions feature **two players** — "What would _Mike_ and _Sarah_'s band name be?"
- You never know who wrote what until the reveal

---

## 🛠️ Configuration

### Custom Port

```bash
node server/server.js --port 8080
```

### Game Settings (in-game)

The host can configure before starting:

- **Min/Max players** (3–10)
- **Answer timer** (10–300 seconds)
- **Voting timer** (10–300 seconds)

### Custom Questions

Edit `server/data/questions.json`:

```json
[
  "What would XYZ bring to a deserted island?",
  "What would XYZ and XYZ's band name be?"
]
```

**Rules:**

- Must contain at least one `XYZ` (replaced with a player's name)
- Two `XYZ` = two different players featured
- Add as many as you want — the game picks randomly each round

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────┐
│                  Host Machine                      │
│                                                    │
│  ┌─────────────────┐    ┌──────────────────────┐ │
│  │  Express Server  │    │   Built React App    │ │
│  │  (WebSocket Relay)│    │   (dist/ folder)     │ │
│  └────────┬─────────┘    └──────────────────────┘ │
│           │                                        │
└───────────┼────────────────────────────────────────┘
            │ WebSocket
    ┌───────┼───────┐
    │       │       │
┌───▼──┐ ┌─▼────┐ ┌▼─────┐
│Phone │ │Laptop│ │Tablet│  ← All game logic runs here
└──────┘ └──────┘ └──────┘
```

- **Server** = dumb relay. Forwards messages between clients. Zero game logic.
- **Client** = React SPA with all game state management. Host client is authoritative.
- **Protocol** = JSON over WebSocket. Self-documenting, easy to extend.

---

## 🧑‍💻 Development

```bash
# Terminal 1: Backend
node server/server.js

# Terminal 2: Frontend with hot-reload
cd client && npx vite
```

Dev server at `http://localhost:5173` with proxy to backend.

### Tests

```bash
# Everything (440+ tests)
npm test

# Just server
cd server && npx vitest --run

# Just client
cd client && npx vitest --run
```

### Tech Stack

| Layer   | Tech                                      |
| ------- | ----------------------------------------- |
| Server  | Node.js, Express, ws                      |
| Client  | React 18, TypeScript, Vite                |
| State   | React Context + useReducer                |
| Testing | Vitest, fast-check (PBT), Testing Library |
| Styling | Pure CSS (no dependencies)                |

---

## 📁 Project Structure

```
witbash/
├── server/
│   ├── server.js              # Express + WebSocket relay
│   ├── data/questions.json    # 300 question templates
│   └── package.json
├── client/
│   ├── src/
│   │   ├── App.tsx            # Main app with phase routing
│   │   ├── components/        # All game screens
│   │   ├── context/           # Game state (reducer)
│   │   ├── hooks/             # WebSocket, timer, consensus
│   │   ├── utils/             # Validation, message handling
│   │   └── types/             # TypeScript interfaces
│   ├── vite.config.ts
│   └── package.json
├── dist/                      # Built client (auto-generated)
└── README.md
```

---

## 🤝 Contributing

Contributions welcome! Some ideas:

- 🌍 **Translations** — i18n support for questions
- 🎵 **Sound effects** — buzzer, applause, timer tick
- 🏆 **Persistent stats** — track wins across sessions
- 🎨 **Themes** — let players pick color schemes
- 📸 **Screenshot/share** — export final leaderboard as image
- 🤖 **AI players** — fill empty slots with bot answers

### How to contribute

1. Fork the repo
2. Create a branch (`git checkout -b feature/awesome-thing`)
3. Make your changes
4. Run tests (`npm test`)
5. Open a PR

---

## 📄 License

MIT — do whatever you want with it.

---

<p align="center">
  <strong>If you had fun, drop a ⭐ on the repo!</strong>
</p>
