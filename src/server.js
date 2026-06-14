const http = require('http');
const { Server } = require('socket.io');
const app = require('./app');
const env = require('./config/env');
const Message = require('./models/Message');
const User = require('./models/User');
const Partner = require('./models/Partner');
const { verifyToken } = require('./services/auth.service');

// Start Server wrapped in native HTTP server for Socket.io
const PORT = env.port;
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Helper to parse cookies from headers
function parseCookies(cookieHeader) {
  if (!cookieHeader) return {};
  const list = {};
  cookieHeader.split(';').forEach(cookie => {
    let parts = cookie.split('=');
    list[parts.shift().trim()] = decodeURIComponent(parts.join('='));
  });
  return list;
}

// Bind io to Express app to make it accessible in controllers
app.set('io', io);

// Socket.io Real-time Chat & Notification Controller
io.on('connection', async (socket) => {
  try {
    const cookieHeader = socket.handshake.headers.cookie;
    const cookies = parseCookies(cookieHeader);
    
    let user = null;
    let partner = null;
    
    if (cookies.token) {
      user = verifyToken(cookies.token);
    }
    if (cookies.partnerToken) {
      partner = verifyToken(cookies.partnerToken);
    }

    if (!user && !partner) {
      socket.disconnect(true);
      return;
    }

    // Join automatic room for real-time notifications
    if (user) {
      socket.join(`user_${user.id}`);
      if (user.role === 'admin') {
        socket.join('admins');
      }
    }
    if (partner) {
      socket.join(`partner_${partner.id}`);
    }

    // Join room event
    socket.on('join_room', async ({ roomId }) => {
      try {
        if (!roomId || typeof roomId !== 'string' || !roomId.includes('_')) return;
        
        const parts = roomId.split('_');
        const rUserId = parts[0];
        const rPartnerId = parts[1];

        // Check if the current socket user/partner is authorized to join this room
        if ((user && user.id === rUserId) || (partner && partner.id === rPartnerId)) {
          socket.join(roomId);
          
          // Send message history (limited to last 72 hours via MongoDB TTL automatically)
          const history = await Message.find({ roomId }).sort({ createdAt: 1 });
          socket.emit('message_history', history);
        }
      } catch (err) {
        console.error('Error on join_room:', err.message);
      }
    });

    // Send message event
    socket.on('send_message', async ({ roomId, text }) => {
      try {
        if (!roomId || !text || text.trim() === '') return;

        const parts = roomId.split('_');
        const rUserId = parts[0];
        const rPartnerId = parts[1];

        let senderType = null;
        let senderId = null;
        let senderName = null;
        let uId = rUserId;
        let uName = 'Cliente';
        let pId = rPartnerId;
        let pName = 'Productor';

        if (user && user.id === rUserId) {
          senderType = 'user';
          senderId = user.id;
          senderName = user.name || 'Cliente';
          uName = user.name || 'Cliente';
          
          const partnerDoc = await Partner.findById(rPartnerId);
          pName = partnerDoc ? partnerDoc.name : 'Productor';
        } else if (partner && partner.id === rPartnerId) {
          senderType = 'partner';
          senderId = partner.id;
          senderName = partner.name || 'Productor';
          pName = partner.name || 'Productor';

          const userDoc = await User.findById(rUserId);
          uName = userDoc ? userDoc.name : 'Cliente';
        } else {
          // Unauthorized
          return;
        }

        const msg = new Message({
          roomId,
          userId: uId,
          userName: uName,
          partnerId: pId,
          partnerName: pName,
          senderType,
          senderId,
          text: text.trim()
        });

        await msg.save();

        // Broadcast message to everyone in the room
        io.to(roomId).emit('new_message', msg);
      } catch (err) {
        console.error('Error on send_message:', err.message);
      }
    });

  } catch (error) {
    console.error('Socket.io connection error:', error.message);
  }
});

// Start listening
server.listen(PORT, () => {
  console.log(`🚀 AbastoHub Server with Socket.io is running in [${env.nodeEnv}] mode on http://localhost:${PORT}`);
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('👋 SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    console.log('💥 Process terminated.');
  });
});
