// models/Message.js
const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  room: { type: String, required: true },      // e.g., "20123456-20123457"
  sender: { type: String, required: true },      // Sender's registration number or ID
  text: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  readBy: [{ type: String }]                     // Array of user IDs (reg. no.) who have read this message
});

module.exports = mongoose.model('Message', messageSchema);
