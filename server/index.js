const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

const rooms = new Map();

io.on('connection', (socket) => {
    console.log('🔌 Подключен:', socket.id);

    // ---------- ДОСКА ----------
    socket.on('join-room', (roomId, role) => {
        console.log(`📥 ${role} вход в ${roomId}`);
        if (role === 'tutor') {
            if (!rooms.has(roomId)) {
                rooms.set(roomId, { objects: [], locked: false, width: null, height: null });
            }
            socket.join(roomId);
            const room = rooms.get(roomId);
            socket.emit('init-canvas', {
                canvasJson: {
                    objects: room.objects || [],
                    width: room.width,
                    height: room.height,
                    background: 'white'
                },
                locked: room.locked
            });
        } else if (role === 'student') {
            if (!rooms.has(roomId)) {
                socket.emit('room-not-found', roomId);
                return;
            }
            socket.join(roomId);
            const room = rooms.get(roomId);
            socket.emit('init-canvas', {
                canvasJson: {
                    objects: room.objects || [],
                    width: room.width,
                    height: room.height,
                    background: 'white'
                },
                locked: room.locked
            });
        }
    });

    socket.on('canvas-state', ({ roomId, canvasJson }) => {
        const room = rooms.get(roomId);
        if (room) {
            room.objects = canvasJson.objects || [];
            room.width = canvasJson.width;
            room.height = canvasJson.height;
            socket.to(roomId).emit('canvas-state', { canvasJson });
        }
    });

    socket.on('drawing-data', ({ roomId, object }) => {
        const room = rooms.get(roomId);
        if (room) {
            const index = room.objects.findIndex(o => o.id === object.id);
            if (index !== -1) room.objects[index] = object;
            else room.objects.push(object);
            socket.to(roomId).emit('draw-to-client', object);
        }
    });

    socket.on('remove-object', ({ roomId, id }) => {
        const room = rooms.get(roomId);
        if (room) {
            room.objects = room.objects.filter(o => o.id !== id);
            socket.to(roomId).emit('remove-object', id);
        }
    });

    socket.on('clear-room', (roomId) => {
        const room = rooms.get(roomId);
        if (room) {
            room.objects = [];
            room.width = null;
            room.height = null;
            io.to(roomId).emit('clear-canvas');
        }
    });

    socket.on('set-lock', ({ roomId, locked }) => {
        const room = rooms.get(roomId);
        if (room) {
            room.locked = locked;
            io.to(roomId).emit('admin-lock-status', locked);
        }
    });

    // ---------- ВИДЕО (WebRTC) ----------
    socket.on('join-video-room', ({ roomId, peerId, role }) => {
        socket.join(`video-${roomId}`);
        socket.to(`video-${roomId}`).emit('user-joined', { peerId, role });
    });

    socket.on('leave-video-room', ({ roomId, peerId }) => {
        socket.leave(`video-${roomId}`);
        socket.to(`video-${roomId}`).emit('user-left', peerId);
    });

    socket.on('send-offer', ({ toPeerId, offer }) => {
        io.to(toPeerId).emit('receive-offer', { from: socket.id, offer });
    });

    socket.on('send-answer', ({ toPeerId, answer }) => {
        io.to(toPeerId).emit('receive-answer', { from: socket.id, answer });
    });

    socket.on('send-ice-candidate', ({ toPeerId, candidate }) => {
        io.to(toPeerId).emit('receive-ice-candidate', { from: socket.id, candidate });
    });

    socket.on('disconnect', () => {
        console.log('❌ Отключен:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`✅ Сервер запущен на порту ${PORT}`);
    console.log(`🌐 http://localhost:${PORT}`);
});