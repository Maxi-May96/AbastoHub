const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  roomId: {
    type: String,
    required: true,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  userName: {
    type: String,
    required: true
  },
  partnerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Partner',
    required: true
  },
  partnerName: {
    type: String,
    required: true
  },
  senderType: {
    type: String,
    enum: ['user', 'partner'],
    required: true
  },
  senderId: {
    type: String,
    required: true
  },
  text: {
    type: String,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 259200 // 72 hours (72 * 3600 seconds)
  }
});

module.exports = mongoose.model('Message', MessageSchema);
