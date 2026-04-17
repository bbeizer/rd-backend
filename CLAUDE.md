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
| impossible | 8 | impossible | 1 | 6s time budget, PVS + LMR + quiescence — "B-Rabbit" lean eval |

**Search enhancements (impossible mode only) — plain English:**
- **PVS (Principal Variation Search)** — Assume the first move in the ordered list is best. Search it with the full window, then search all others with a cheap "null window" that only asks "is this better than the first?" Re-search at full window only if one of them surprises us. Faster than vanilla alpha-beta when move ordering is good.
- **LMR (Late Move Reductions)** — Moves ranked 4th+ are probably worse than the top few. Search them at reduced depth first; only do a full-depth re-search if the reduced result looks suspiciously good. Skips expensive work on probable-junk moves.
- **Quiescence extension** — At leaf nodes (depth 0), if the opponent has an immediate scoring threat, extend the search by 1 more ply instead of evaluating. Prevents the horizon effect where the eval calls a position "fine" right before the opponent wins on the next move. Single extension only — guarded by `noExtend` flag to prevent runaway recursion.

**Eval variants** (for A/B benchmarking in `aiDojo.js`):
- **B-Rabbit** (`impossible`) — lean eval: 6 low-value features zeroed for speed, concave piece advancement (peaks at penultimate rank), win-points + coordination + flexibility features. Ships in production.
- **Tortuga** (`impossible_tortuga`) — full-featured eval: all 22 features active. Benchmarking only.
- **Legacy** (`impossible_legacy`) — pre-win-points weights (ballAdvancement: 100, no new features). Benchmarking only.
- Dojo results: B-Rabbit 2-0 Tortuga, B-Rabbit 2-0 Legacy, Legacy 2-0 Hard, B-Rabbit 1-1 Hard (known cyclic intransitivity — Phase B target).

**Design philosophy — Phase A vs Phase B:**
- `evaluateImpossible(board, color, weights = DEFAULT_IMPOSSIBLE_WEIGHTS)` is **parametrically tunable** by design. Every coefficient lives in the `weights` config object — nothing is hardcoded in the function body.
- **Phase A (done)**: Hand-designed eval features + hand-tuned weights. "B-Rabbit" is the current best config.
- **Phase B (next)**: Self-play weight optimization — generate weight variants, play them against each other, keep winners. Replaces human guessing with empirical tuning. Infra: extend `aiDojo.js` with a tournament runner + weight perturbation. Target: fix the Hard matchup intransitivity without hand-tuning.
- **Phase C (future)**: Tabula rasa eval — replace hand-designed features with atomic board features (piece positions, distances, etc.) + learned weights via self-play. No human game theory. Strategy emerges from wins/losses. When editing the eval, **do not hardcode multipliers** — add new entries to `DEFAULT_IMPOSSIBLE_WEIGHTS` instead.

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
