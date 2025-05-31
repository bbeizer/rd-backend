require('dotenv').config();
console.log('📦 process.env.PORT:', process.env.PORT);
const express = require('express');
const mongoose = require('mongoose');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const app = express();

// Middlewares
const corsOptions = {
  origin: 'https://www.razzlndazzle.com',
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(helmet());
app.use(morgan('dev'));
app.use(express.json());

// MongoDB connection
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('❌ MONGO_URI is not defined in environment variables.');
  process.exit(1); // kill app if no DB URI
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
  console.warn('⚠️ Skipping game routes due to error:', err.message);
}

try {
  const feedbackRoutes = require('./routes/feedback.js');
  app.use('/api/feedback', feedbackRoutes);
} catch (err) {
  console.warn('⚠️ Skipping feedback routes due to error:', err.message);
}
// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server started on port ${PORT}`);
});
