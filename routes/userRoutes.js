const express = require('express');
const { body, validationResult } = require('express-validator');
const userController = require('../controllers/userController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Validation middleware helper
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

// Registration validation
const registerValidation = [
  body('email').isEmail().withMessage('Please enter a valid email address'),
  body('username')
    .isLength({ min: 3, max: 20 })
    .withMessage('Username must be between 3 and 20 characters'),
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters'),
];

// Login validation
const loginValidation = [
  body('email').isEmail().withMessage('Please enter a valid email address'),
  body('password').notEmpty().withMessage('Password is required'),
];

// Update profile validation
const updateValidation = [
  body('email').optional().isEmail().withMessage('Please enter a valid email address'),
  body('username')
    .optional()
    .isLength({ min: 3, max: 20 })
    .withMessage('Username must be between 3 and 20 characters'),
];

// Public routes
router.post('/register', registerValidation, validate, userController.register);
router.post('/login', loginValidation, validate, userController.login);
router.get('/:id/games', userController.getUserGames);

// Protected routes
router.get('/me', requireAuth, userController.getProfile);
router.patch('/me', requireAuth, updateValidation, validate, userController.updateProfile);
router.delete('/me', requireAuth, userController.deleteAccount);

module.exports = router;
