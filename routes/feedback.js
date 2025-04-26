require('dotenv').config();
const express = require('express');
const { Resend } = require('resend');

const router = express.Router();

const resend = new Resend(process.env.RESEND_API_KEY);

router.post('/', async (req, res) => {
  const { name, message } = req.body;

  try {
    await resend.emails.send({
      from: 'onboarding@resend.dev',
      to: 'bhb987@gmail.com',
      subject: 'New Razzle Dazzle Feedback!',
      html: `
        <p><strong>Name:</strong> ${name || 'Anonymous'}</p>
        <p><strong>Message:</strong> ${message}</p>
      `,
    });

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Feedback email failed:', error);
    res.status(500).json({ success: false });
  }
});

module.exports = router;
