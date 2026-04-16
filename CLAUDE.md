# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the backend for "Razzle Dazzle" - a chess variant game where pieces pass a ball. Built with Express.js, MongoDB/Mongoose, and Socket.IO for real-time multiplayer.

## Commands

```bash
npm run dev     # Start development server with nodemon (port 5000)
npm start       # Start production server
```

## Architecture

### Entry Point
- `server.js` - Express app setup, MongoDB connection, Socket.IO initialization, route mounting

### API Routes
- `/api/games` - Game CRUD and matchmaking (gameRoutes.js -> gameController.js)
- `/api/users` - User auth and profile management (userRoutes.js -> userController.js)
- `/api/feedback` - Email feedback via Resend (feedback.js)

### Models
- **Game** - Board state, players, turn tracking, move history, in-game chat
- **User** - Basic auth schema (guest users supported)
- **Message** - Embedded schema for game conversation

### Real-time Communication
Socket.IO events for game rooms:
- `joinGame` / `leaveGame` - Room management
- `gameUpdated` - Board state changes
- `gameStarted` / `gameEnded` - Game lifecycle
- `turnChanged` - Turn notifications

The `io` instance is attached to `app` via `app.set('io', io)` and accessed in controllers via `req.app.get('io')`.

### Game Logic
- `utils/gameInitialization.js` - Creates initial 8x8 board with 4 pieces per side (columns c-f on rows 1 and 8)
- `utils/queueManager.js` - In-memory matchmaking queue for multiplayer
- `utils/socketManager.js` - WebSocket event emission helpers

### Game State
Board uses algebraic notation (a1-h8). Each cell is either `null` or:
```js
{ color: "white"|"black", hasBall: boolean, position: "e1", id: uuid }
```

### AI Engine
The AI lives in `utils/aiLogic.js` — minimax with alpha-beta pruning, iterative deepening, transposition tables, and (for `impossible` mode) PVS + LMR + quiescence extension + time-budgeted search. The game has **no capturing**: chains break via lane-blocking, not piece removal.

**Difficulty tiers** (`DIFFICULTY_CONFIGS`):
| Level | Depth | Eval | `topN` | Notes |
|-------|-------|------|--------|-------|
| easy | 1 | simple | 3 | Random pick among top 3 — beginner-friendly variance |
| medium | 3 | standard | 2 | Random pick among top 2 |
| hard | 4 | advanced | 1 | Always plays best — strong but fast |
| impossible | 8 | impossible | 1 | 4s time budget, PVS + LMR + quiescence — deterministic, beats hard 4-0 |

**Design philosophy — Phase A vs Phase B:**
- `evaluateImpossible(board, color, weights = DEFAULT_IMPOSSIBLE_WEIGHTS)` is **parametrically tunable** by design. Every coefficient lives in the `weights` config object — nothing is hardcoded in the function body.
- **Phase A (done)**: Hand-designed eval features + hand-tuned weights. That's what shipped in `ai/impossible-mode`.
- **Phase B (future)**: Replace hand-tuned weights with empirically-derived weights via self-play + Texel tuning (logistic regression on `(position, eval) → outcome`). This is the pre-NNUE Stockfish approach. When editing the eval, **do not hardcode multipliers** — add new entries to `DEFAULT_IMPOSSIBLE_WEIGHTS` instead. Plan doc: `/Users/Ben/.claude/plans/bright-wobbling-whisper.md`.

**Search correctness gotcha:** the TT entries use `exact` / `lower` / `upper` bound flags. PVS's null-window scouts produce fail-high/fail-low bound scores, not exact values. Without flags these would be cached as exact and corrupt subsequent full-window searches. Regression test: `tests/aiLogic.test.js` → "PVS yields same minimax score as plain alpha-beta".

**Key files:**
- `utils/aiLogic.js` — eval functions, minimax, difficulty configs, `makeAIMove` entry point
- `utils/aiDojo.js` — bot-vs-bot matchup runner for validating difficulty tuning
- `utils/aiBenchmark.js` — per-difficulty move-time benchmarks
- `tests/aiLogic.test.js` — unit tests (run via `npm test`, uses `node:test`, **not** Jest)

## Environment Variables

Required in `.env`:
- `MONGO_URI` - MongoDB connection string
- `PORT` - Server port (default 5000)
- `JWT_SECRET` - Secret key for JWT token signing
- `RESEND_API_KEY` - For feedback emails
- `CORS_ORIGIN` - Additional allowed CORS origin (e.g., Vercel preview URL)
