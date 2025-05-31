require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const gameRoutes = require('./routes/gameRoutes');
const feedbackRoutes = require('./routes/feedback.js');

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

const MONGO_URI = process.env.MONGO_URI

// Connect to MongoDB
mongoose.connect(MONGO_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch((err) => console.error(err));

// Routes
app.use('/api/games', gameRoutes);
app.use('/api/feedback', feedbackRoutes);
app.get('/healthCheck', (req, res) => {
  res.send('✅ Server is live');
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server started on port ${PORT}`));
