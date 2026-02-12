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
    socket.videoRooms = [];

    // ---------- ДОСКА ----------
    socket.on('join-room', (roomId, role) => {
        console.log(`📥 ${role} вход в ${roomId}`);
        if (role === 'tutor') {
            if (!rooms.has(roomId)) {
                rooms.set(roomId, { 
                    objects: [], 
                    locked: false, 
                    width: null,
                    height: null 
                });
                console.log(`🆕 Комната ${roomId} создана`);
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
        if (room && object) {
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

    // ---------- ВИДЕО ----------
    socket.on('join-video-room', ({ roomId, peerId, role }) => {
        if (!roomId || !peerId || !role) return;
        const videoRoom = `video-${roomId}`;
        socket.join(videoRoom);
        if (!socket.videoRooms.includes(videoRoom)) {
            socket.videoRooms.push(videoRoom);
        }

        // 🔥 НОВОЕ: отправляем новому участнику список уже присутствующих пиров
        const roomSockets = io.sockets.adapter.rooms.get(videoRoom);
        if (roomSockets) {
            const participants = Array.from(roomSockets)
                .filter(id => id !== socket.id) // исключаем себя
                .map(id => ({ peerId: id, role: getRoleBySocketId(id) })); // нужно как-то получить роль; упростим: будем передавать только peerId, а роль узнаем позже?
            // Проще передать только peerId, а роль определим по тому, что репетитор — единственный, кто не ученик? Нет, могут быть несколько учеников.
            // Решение: будем передавать peerId и role, которые были переданы при join-video-room.
            // Для этого нужно хранить роли сокетов. Временно передадим только peerId, а клиент при создании PC будет считать, что это репетитор (если он ученик) или ученик (если он репетитор) — но это ненадёжно.
            // Лучше хранить роли в памяти сервера.
            if (!global.socketRoles) global.socketRoles = new Map();
            global.socketRoles.set(socket.id, role);
            const participantList = Array.from(roomSockets)
                .filter(id => id !== socket.id)
                .map(id => ({ peerId: id, role: global.socketRoles.get(id) }));
            socket.emit('room-participants', participantList);
        }

        socket.to(videoRoom).emit('user-joined', { peerId, role });
        console.log(`🎥 ${role} (${peerId}) присоединился к ${videoRoom}`);
    });

    socket.on('leave-video-room', ({ roomId, peerId }) => {
        if (!roomId || !peerId) return;
        const videoRoom = `video-${roomId}`;
        socket.leave(videoRoom);
        socket.videoRooms = socket.videoRooms.filter(vr => vr !== videoRoom);
        socket.to(videoRoom).emit('user-left', peerId);
        console.log(`🚪 ${peerId} покинул ${videoRoom}`);
    });

    socket.on('send-offer', ({ toPeerId, offer }) => {
        if (!toPeerId || !offer) return;
        io.to(toPeerId).emit('receive-offer', { from: socket.id, offer });
    });

    socket.on('send-answer', ({ toPeerId, answer }) => {
        if (!toPeerId || !answer) return;
        io.to(toPeerId).emit('receive-answer', { from: socket.id, answer });
    });

    socket.on('send-ice-candidate', ({ toPeerId, candidate }) => {
        if (!toPeerId || !candidate) return;
        io.to(toPeerId).emit('receive-ice-candidate', { from: socket.id, candidate });
    });

    // ---------- ОТКЛЮЧЕНИЕ ----------
    socket.on('disconnect', () => {
        console.log('❌ Отключен:', socket.id);
        socket.videoRooms.forEach(videoRoom => {
            socket.to(videoRoom).emit('user-left', socket.id);
            console.log(`📢 user-left для ${socket.id} в ${videoRoom}`);
        });
        socket.videoRooms = [];
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`✅ Сервер запущен на порту ${PORT}`);
    console.log(`🌐 http://localhost:${PORT}`);
});