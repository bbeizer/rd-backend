const User = require('../models/User');
const Game = require('../models/Game');
const bcrypt = require('bcryptjs');
const { generateToken } = require('../middleware/auth');

/**
 * Register a new user
 * POST /api/users/register
 */
exports.register = async (req, res) => {
  try {
    const { email, username, password } = req.body;

    // Check for existing user with same email
    const existingEmail = await User.findOne({ email });
    if (existingEmail) {
      return res.status(400).json({ message: 'Email already in use' });
    }

    // Check for existing user with same username
    const existingUsername = await User.findOne({ username });
    if (existingUsername) {
      return res.status(400).json({ message: 'Username already taken' });
    }

    const user = new User({
      email,
      username,
      password,
      isGuest: false,
    });

    await user.save();

    const token = generateToken(user._id);

    res.status(201).json({
      user: {
        _id: user._id,
        email: user.email,
        username: user.username,
        createdAt: user.createdAt,
      },
      token,
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Error creating user', error: error.message });
  }
};

/**
 * Login user
 * POST /api/users/login
 */
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    if (!user.password) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const token = generateToken(user._id);

    res.json({
      user: {
        _id: user._id,
        email: user.email,
        username: user.username,
        createdAt: user.createdAt,
      },
      token,
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Error logging in', error: error.message });
  }
};

/**
 * Get current user profile
 * GET /api/users/me
 */
exports.getProfile = async (req, res) => {
  res.json({
    user: {
      _id: req.user._id,
      email: req.user.email,
      username: req.user.username,
      createdAt: req.user.createdAt,
    },
  });
};

/**
 * Update current user profile
 * PATCH /api/users/me
 */
exports.updateProfile = async (req, res) => {
  try {
    const { username, email } = req.body;
    const userId = req.user._id;

    // Check for conflicts with other users
    if (email && email !== req.user.email) {
      const existingEmail = await User.findOne({ email, _id: { $ne: userId } });
      if (existingEmail) {
        return res.status(400).json({ message: 'Email already in use' });
      }
    }

    if (username && username !== req.user.username) {
      const existingUsername = await User.findOne({ username, _id: { $ne: userId } });
      if (existingUsername) {
        return res.status(400).json({ message: 'Username already taken' });
      }
    }

    const updates = {};
    if (username) updates.username = username;
    if (email) updates.email = email;

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      updates,
      { new: true, runValidators: true }
    ).select('-password');

    res.json({
      user: {
        _id: updatedUser._id,
        email: updatedUser.email,
        username: updatedUser.username,
        createdAt: updatedUser.createdAt,
      },
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ message: 'Error updating profile', error: error.message });
  }
};

/**
 * Delete current user account
 * DELETE /api/users/me
 */
exports.deleteAccount = async (req, res) => {
  try {
    await User.findByIdAndDelete(req.user._id);
    res.json({ message: 'Account deleted successfully' });
  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({ message: 'Error deleting account', error: error.message });
  }
};

/**
 * Get user's game history
 * GET /api/users/:id/games
 */
exports.getUserGames = async (req, res) => {
  try {
    const { id } = req.params;

    // Find all games where this user participated
    const games = await Game.find({
      $or: [{ whitePlayerId: id }, { blackPlayerId: id }],
      status: 'completed',
    })
      .select('whitePlayerId blackPlayerId whitePlayerName blackPlayerName winner status createdAt updatedAt')
      .sort({ updatedAt: -1 })
      .limit(50);

    res.json({ games });
  } catch (error) {
    console.error('Get user games error:', error);
    res.status(500).json({ message: 'Error fetching games', error: error.message });
  }
};
