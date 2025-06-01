require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');

const app = express();

const isProd = process.env.NODE_ENV === 'production';
console.log(`🌍 Environment: ${isProd ? 'Production' : 'Development'}`);
console.log('📦 process.env.PORT:', process.env.PORT);

// Dynamic CORS
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'https://www.razzlndazzle.com',
];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`❌ CORS not allowed for origin: ${origin}`));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

// Middleware
app.use(cors(corsOptions));
app.use(helmet());
app.use(morgan('dev'));
app.use(express.json());

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

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server started on port ${PORT}`);
});
