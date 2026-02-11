// В обработчике 'connection'
socket.on('join-room', (roomId, role) => {
    console.log(`📥 ${role} пытается войти в комнату ${roomId}`);

    if (role === 'tutor') {
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