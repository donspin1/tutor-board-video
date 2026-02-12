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

const rooms = new Map(); // roomId → { canvasJson, locked }

io.on('connection', (socket) => {
    console.log('🔌 Подключен:', socket.id);

    socket.on('join-room', (roomId, role) => {
        console.log(`📥 ${role} вход в ${roomId}`);

        if (role === 'tutor') {
            if (!rooms.has(roomId)) {
                rooms.set(roomId, { canvasJson: { objects: [], width: 1400, height: 900, background: 'white' }, locked: false });
                console.log(`🆕 Комната ${roomId} создана`);
            }
            socket.join(roomId);
            const room = rooms.get(roomId);
            socket.emit('init-canvas', { canvasJson: room.canvasJson, locked: room.locked });
        } else if (role === 'student') {
            if (!rooms.has(roomId)) {
                socket.emit('room-not-found', roomId);
                return;
            }
            socket.join(roomId);
            const room = rooms.get(roomId);
            socket.emit('init-canvas', { canvasJson: room.canvasJson, locked: room.locked });
        }
    });

    // Полное состояние от репетитора
    socket.on('canvas-state', ({ roomId, canvasJson }) => {
        const room = rooms.get(roomId);
        if (room) {
            room.canvasJson = canvasJson;
            socket.to(roomId).emit('canvas-state', { canvasJson });
        }
    });

    // Отдельные объекты от ученика
    socket.on('drawing-data', ({ roomId, object }) => {
        const room = rooms.get(roomId);
        if (room && room.canvasJson) {
            const index = room.canvasJson.objects.findIndex(o => o.id === object.id);
            if (index !== -1) room.canvasJson.objects[index] = object;
            else room.canvasJson.objects.push(object);
            socket.to(roomId).emit('draw-to-client', object);
        }
    });

    socket.on('remove-object', ({ roomId, id }) => {
        const room = rooms.get(roomId);
        if (room && room.canvasJson) {
            room.canvasJson.objects = room.canvasJson.objects.filter(o => o.id !== id);
            socket.to(roomId).emit('remove-object', id);
        }
    });

    socket.on('clear-room', (roomId) => {
        const room = rooms.get(roomId);
        if (room) {
            room.canvasJson = { objects: [], width: room.canvasJson.width || 1400, height: room.canvasJson.height || 900, background: 'white' };
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

    // ---------- ВИДЕО ----------
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