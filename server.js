require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const { createServer } = require('http');
const { Server } = require('socket.io');

const app = express();
const httpServer = createServer(app);

const isProd = process.env.NODE_ENV === 'production';
console.log(`🌍 Environment: ${isProd ? 'Production' : 'Development'}`);
console.log('📦 process.env.PORT:', process.env.PORT);

// Dynamic CORS
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:8080',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
  'http://127.0.0.1:8080',
  'https://www.razzlndazzle.com',
];

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) {
      return callback(null, true);
    }

    // Allow all localhost origins in development
    if (process.env.NODE_ENV !== 'production' &&
      (origin.includes('localhost') || origin.includes('127.0.0.1'))) {
      return callback(null, true);
    }

    // Check against allowed origins
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    console.warn(`⚠️ CORS blocked origin: ${origin}`);
    callback(new Error(`❌ CORS not allowed for origin: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
};

// Middleware
app.use(cors(corsOptions));
app.use(helmet());
app.use(morgan('dev'));
app.use(express.json());

// Socket.IO setup
const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log(`🔌 User connected: ${socket.id}`);

  // Join a game room
  socket.on('joinGame', (gameId) => {
    socket.join(gameId);
    console.log(`🎮 User ${socket.id} joined game: ${gameId}`);
  });

  // Leave a game room
  socket.on('leaveGame', (gameId) => {
    socket.leave(gameId);
    console.log(`🚪 User ${socket.id} left game: ${gameId}`);
  });

  // Handle game updates
  socket.on('gameUpdate', (data) => {
    const { gameId, gameData } = data;
    // Broadcast to all clients in the game room except sender
    socket.to(gameId).emit('gameUpdated', gameData);
    console.log(`📡 Game update broadcasted for game: ${gameId}`);
  });

  socket.on('disconnect', () => {
    console.log(`🔌 User disconnected: ${socket.id}`);
  });
});

// Make io available to routes
app.set('io', io);

// MongoDB Connection
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error('❌ MONGO_URI not defined. Check .env.');
  process.exit(1);
}

mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch((err) => {
    console.error('❌ MongoDB connection failed:', err);
    process.exit(1);
  });

// Routes
try {
  const gameRoutes = require('./routes/gameRoutes');
  app.use('/api/games', gameRoutes);
} catch (err) {
  console.warn('⚠️ Failed to load game routes:', err.message);
}

try {
  const feedbackRoutes = require('./routes/feedback');
  app.use('/api/feedback', feedbackRoutes);
} catch (err) {
  console.warn('⚠️ Failed to load feedback routes:', err.message);
}

// Centralized error handler (should be last)
app.use(require('./middleware/errorHandler'));

// Start server
const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => {
  console.log(`🚀 Server started on port ${PORT}`);
  console.log(`🔌 WebSocket server ready on port ${PORT}`);
});
