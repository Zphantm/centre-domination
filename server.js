const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, '.')));

const rooms = new Map();

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('joinRoom', (roomCode) => {
    let room = rooms.get(roomCode);
    
    if (!room) {
      room = { players: [socket.id], gameState: null };
      rooms.set(roomCode, room);
      socket.join(roomCode);
      socket.emit('playerRole', 'R'); // First player is Red
      socket.emit('roomCreated', { roomCode }); // Let the host in immediately
      console.log(`User ${socket.id} created and joined room: ${roomCode}`);
    } else if (room.players.length === 1) {
      room.players.push(socket.id);
      socket.join(roomCode);
      socket.emit('playerRole', 'G'); // Second player is Green
      io.to(roomCode).emit('gameStart', { roomCode });
      console.log(`User ${socket.id} joined room: ${roomCode}`);
    } else {
      socket.emit('error', 'Room is full');
      console.log(`User ${socket.id} tried to join full room: ${roomCode}`);
    }
  });

  socket.on('makeMove', ({ roomCode, from, to }) => {
    console.log(`Move in room ${roomCode}: ${from} -> ${to}`);
    socket.to(roomCode).emit('opponentMove', { from, to });
  });

  socket.on('resetGame', (roomCode) => {
    console.log(`Game reset in room ${roomCode}`);
    socket.to(roomCode).emit('gameReset');
  });

  socket.on('chatMessage', (data) => {
    const { roomCode, message } = data;
    console.log(`CHAT [Room ${roomCode}] from ${socket.id}: ${message}`);
    socket.to(roomCode).emit('chatMessage', { message });
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    // Optional: handle player leaving room
    rooms.forEach((room, roomCode) => {
      if (room.players.includes(socket.id)) {
        io.to(roomCode).emit('opponentDisconnected');
        rooms.delete(roomCode);
      }
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
