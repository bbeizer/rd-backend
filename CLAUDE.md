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

**Design philosophy — roadmap:**

Two orthogonal layers: **search** (alpha-beta vs MCTS) and **eval** (heuristic vs NN). Any search can call any eval — they're independent. The current engine is alpha-beta + heuristic (B-Rabbit) for `impossible`, and alpha-beta + NN for `impossible_nn`. Heuristic eval is **scaffolding**, not the destination: it exists to (a) ship a strong-enough opponent today, and (b) generate labeled training data for stronger learned systems.

- `evaluateImpossible(board, color, weights = DEFAULT_IMPOSSIBLE_WEIGHTS)` is **parametrically tunable** by design. Every coefficient lives in the `weights` config object — nothing is hardcoded in the function body. When editing the eval, **do not hardcode multipliers** — add new entries to `DEFAULT_IMPOSSIBLE_WEIGHTS` instead.
- **Phase A (done)**: Hand-designed eval features + hand-tuned weights. "B-Rabbit" is the current best config. Post-symmetrization (2026-06-02) — passes 6/6 sanity battery.
- **Phase B (optional, low priority)**: Self-play weight optimization on the heuristic feature set. Bounded ceiling — the heuristic feature set is the limit. Skip unless we want a small B-Rabbit bump for free.
- **Phase C (done, 2026-06-04)**: NN eval inside alpha-beta — the Stockfish/NNUE pattern. `utils/aiNNEval.js` — MLP **259→128→64→1** with us-to-move canonicalization (color-flip symmetry enforced architecturally). Trained on ~18,800 augmented plies across three selfplay corpora (50g hard-vs-hard + 100g NN-vs-NN + 100g hard-vs-NN, ~60/40 white/black) with **combo loss** (0.5 × MSE(searchScore) + 0.5 × MSE(z × 1000)). **Beat B-Rabbit 7-1 in an 8-game alternating-colors dojo** — first learned eval to surpass the heuristic teacher. Won 4/4 as the disadvantaged black side; round-3 "trailing-side comeback" corpus closed the position-coverage gap that hurt round-2 outcome-only training.
- **Phase D (next, high leverage)**: Continue scaling the NNUE-style path. (1) Round-4 selfplay with combo_big vs combo_big (strongest teacher yet) — fresher, higher-quality labels. (2) Even bigger architecture if data scales further (256→128 hidden? worth testing once corpus is 50K+ plies). (3) Speed/quantization — NN must be fast enough for deep alpha-beta search; current forward pass is reusable Float64Array, no allocs. This is incremental — same engine, better weights, dojo-gated each iteration. Stockfish reached world #1 on this exact path.
- **Phase E (alternative search paradigm, big lift)**: MCTS + NN policy/value heads (AlphaZero pattern). Only worth building if Phase D hits a ceiling, or if NN inference can't be made fast enough for alpha-beta's node count. Requires a policy head (visit-distribution targets), a PUCT MCTS engine in `utils/aiMCTS.js`, and a closed-loop selfplay training pipeline. Stockfish and Lc0 are now roughly tied — neither paradigm is strictly better, so this is a path choice, not an upgrade.
- **Phase ☠ (dead): Endgame tablebase.** Considered and rejected — Razzle Dazzle has no captures, so piece count never drops below 8 during a game. A partial (≤6-piece) tablebase would never be queried in real play, and the full 8-piece state space (~10^13 even after symmetry collapse) is petabyte-scale. Tablebase strategies that work for chess/checkers (where captures shrink the board) do not apply here.

**Search correctness gotcha:** the TT entries use `exact` / `lower` / `upper` bound flags. PVS's null-window scouts produce fail-high/fail-low bound scores, not exact values. Without flags these would be cached as exact and corrupt subsequent full-window searches. Regression test: `tests/aiLogic.test.js` → "PVS yields same minimax score as plain alpha-beta".

**Key files:**
- `utils/aiLogic.js` — minimax, difficulty configs, `makeAIMove` entry point; delegates tier evals to `aiEvalTiers.js` and impossible eval to `aiImpossibleEval.js`
- `utils/aiSparseBoard.js` — AI search sparse board: `cloneBoardFast`, `movePiece`/`passBall`, `expandBoard`, `hashBoard` (TT)
- `utils/aiEvalTiers.js` — `evaluateSimple` / `evaluateStandard` / `evaluateAdvanced` (easy / medium / hard)
- `utils/aiEvalCore.js` — shared static-eval helpers (`didWin`, passing-chain metrics, delivery squares / threat) used by easy–impossible evals
- `utils/aiImpossibleEval.js` — `DEFAULT_IMPOSSIBLE_WEIGHTS` (B-Rabbit), Tortuga/Legacy, `evaluateImpossible`, `computeImpossibleFeatureContributions` (per-key gating for cost), Phase C-lite `atomic*` keys (default 0)
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
