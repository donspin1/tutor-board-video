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

const rooms = new Map(); // roomId -> { participants: Map, objects, locked, width, height }

io.on('connection', (socket) => {
    console.log('🔌 Подключен:', socket.id);

    // ---------- ДОСКА ----------
    socket.on('join-room', (roomId, role) => {
        console.log(`📥 ${role} вход в ${roomId}`);
        
        if (!rooms.has(roomId)) {
            rooms.set(roomId, {
                participants: new Map(),
                objects: [],
                locked: false,
                width: null,
                height: null
            });
            console.log(`🆕 Комната ${roomId} создана`);
        }
        
        const room = rooms.get(roomId);
        
        // Добавляем участника с ролью
        room.participants.set(socket.id, { role, joinedAt: Date.now() });
        socket.join(roomId);
        
        // 1. Отправляем новому участнику список ВСЕХ текущих участников
        const participants = Array.from(room.participants.entries())
            .filter(([id]) => id !== socket.id)
            .map(([id, data]) => ({ peerId: id, role: data.role }));
        
        socket.emit('room-participants', participants);
        console.log(`📋 Отправлен список участников (${participants.length} чел.)`);
        
        // 2. Оповещаем остальных, что новый участник присоединился
        socket.to(roomId).emit('user-joined', { peerId: socket.id, role });
        
        // 3. Отправляем состояние доски
        socket.emit('init-canvas', {
            canvasJson: {
                objects: room.objects || [],
                width: room.width,
                height: room.height,
                background: 'white'
            },
            locked: room.locked
        });
    });

    // ---------- ДОСКА ----------
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

    // ---------- ВИДЕО (СИГНАЛИНГ) ----------
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
        
        // Удаляем участника из всех комнат
        rooms.forEach((room, roomId) => {
            if (room.participants.has(socket.id)) {
                const participant = room.participants.get(socket.id);
                const role = participant.role;
                
                // Если отключился репетитор — отправляем ученикам специальное событие
                if (role === 'tutor') {
                    console.log(`👨‍🏫 Репетитор ${socket.id} покинул комнату ${roomId}, ученики будут перенаправлены`);
                    io.to(roomId).emit('tutor-left');
                }
                
                room.participants.delete(socket.id);
                io.to(roomId).emit('user-left', socket.id);
                console.log(`👋 user-left: ${socket.id} из ${roomId}`);
            }
        });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`✅ Сервер запущен на порту ${PORT}`);
    console.log(`🌐 http://localhost:${PORT}`);
});