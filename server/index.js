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
app.use(express.static(path.join(__dirname, '../public')));

// Хранилище комнат
const rooms = new Map();

io.on('connection', (socket) => {
    console.log('🔌 Подключен:', socket.id);

    // ---------- РАБОТА С ДОСКОЙ ----------
    // Добавляем параметр role: 'tutor' или 'student'
    socket.on('join-room', (roomId, role) => {
        console.log(`📥 ${role} пытается войти в комнату ${roomId}`);

        if (role === 'tutor') {
            // Репетитор: создаём комнату, если её нет
            if (!rooms.has(roomId)) {
                rooms.set(roomId, { objects: [], locked: false, background: null });
                console.log(`🆕 Комната ${roomId} создана репетитором`);
            }
            socket.join(roomId);
            const room = rooms.get(roomId);
            socket.emit('init-canvas', { 
                objects: room.objects, 
                locked: room.locked, 
                background: room.background 
            });
        } else if (role === 'student') {
            // Ученик: проверяем, существует ли комната
            if (!rooms.has(roomId)) {
                console.log(`❌ Комната ${roomId} не найдена`);
                socket.emit('room-not-found', roomId);
                return;
            }
            socket.join(roomId);
            const room = rooms.get(roomId);
            socket.emit('init-canvas', { 
                objects: room.objects, 
                locked: room.locked, 
                background: room.background 
            });
        }
    });

    // Остальные обработчики (drawing-data, remove-object, clear-room, set-lock, set-background, видео)
    // без изменений — они уже есть в предыдущей версии
    // ... (сохраняем их полностью)
    // Копируем из предыдущего рабочего сервера
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
            room.background = null;
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

    socket.on('set-background', ({ roomId, background }) => {
        const room = rooms.get(roomId);
        if (room) {
            room.background = background;
            socket.to(roomId).emit('update-background', background);
        }
    });

    // ---------- ВИДЕОЗВОНКИ ----------
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

    socket.on('video-toggle', ({ roomId, userId, kind, enabled }) => {
        socket.to(`video-${roomId}`).emit('peer-video-toggle', { userId, kind, enabled });
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