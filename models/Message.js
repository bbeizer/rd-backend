const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    author: String,
    text: String,
    timestamp: {
        type: Date,
        default: Date.now
    }
});

module.exports = messageSchema;
