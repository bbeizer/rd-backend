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

## Environment Variables

Required in `.env`:
- `MONGO_URI` - MongoDB connection string
- `PORT` - Server port (default 5000)
- `JWT_SECRET` - Secret key for JWT token signing
- `RESEND_API_KEY` - For feedback emails
- `CORS_ORIGIN` - Additional allowed CORS origin (e.g., Vercel preview URL)
