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

// Раздача статических файлов (HTML, CSS, JS)
app.use(cors());
app.use(express.json()); // для возможных POST-запросов (не обязательно, но пусть будет)
app.use(express.static(path.join(__dirname, '../public')));

// Хранилище комнат в памяти
const rooms = new Map();

// ---------- ВСЕ ОБРАБОТЧИКИ СОЕДИНЕНИЙ ----------
io.on('connection', (socket) => {
    console.log('🔌 Подключен:', socket.id);

    // -------------------------------------------------
    // 1. Работа с комнатами и доской
    // -------------------------------------------------
    socket.on('join-room', (roomId, role) => {
        console.log(`📥 ${role} пытается войти в комнату ${roomId}`);

        if (role === 'tutor') {
            // Репетитор: создаём комнату, если её нет
            if (!rooms.has(roomId)) {
                rooms.set(roomId, {
                    objects: [],
                    locked: false,
                    background: null
                });
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
            // Ученик: проверяем существование комнаты
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

    // Получение и рассылка объектов рисования
    socket.on('drawing-data', ({ roomId, object }) => {
        const room = rooms.get(roomId);
        if (room) {
            // Обновляем хранилище
            const index = room.objects.findIndex(o => o.id === object.id);
            if (index !== -1) {
                room.objects[index] = object;
            } else {
                room.objects.push(object);
            }
            // Отправляем всем КРОМЕ отправителя
            socket.to(roomId).emit('draw-to-client', object);
        }
    });

    // Удаление объекта
    socket.on('remove-object', ({ roomId, id }) => {
        const room = rooms.get(roomId);
        if (room) {
            room.objects = room.objects.filter(o => o.id !== id);
            socket.to(roomId).emit('remove-object', id);
        }
    });

    // Полная очистка комнаты
    socket.on('clear-room', (roomId) => {
        const room = rooms.get(roomId);
        if (room) {
            room.objects = [];
            room.background = null;
            io.to(roomId).emit('clear-canvas');
        }
    });

    // Блокировка/разблокировка доступа для учеников
    socket.on('set-lock', ({ roomId, locked }) => {
        const room = rooms.get(roomId);
        if (room) {
            room.locked = locked;
            io.to(roomId).emit('admin-lock-status', locked);
        }
    });

    // Установка фона (PDF/изображение)
    socket.on('set-background', ({ roomId, background }) => {
        const room = rooms.get(roomId);
        if (room) {
            room.background = background;
            socket.to(roomId).emit('update-background', background);
        }
    });

    // -------------------------------------------------
    // 2. Видеозвонки (WebRTC сигнализация)
    // -------------------------------------------------
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

    // -------------------------------------------------
    // 3. Отключение пользователя
    // -------------------------------------------------
    socket.on('disconnect', () => {
        console.log('❌ Отключен:', socket.id);
    });
});

// ---------- ЗАПУСК СЕРВЕРА ----------
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`✅ Сервер запущен на порту ${PORT}`);
    console.log(`🌐 http://localhost:${PORT}`);
});