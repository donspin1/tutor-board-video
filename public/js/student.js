// student.js — ИСПРАВЛЕННАЯ ВЕРСИЯ (работает синхронизация и блокировка)

const socket = io();
const urlParams = new URLSearchParams(window.location.search);
const roomId = urlParams.get('room');
const userName = decodeURIComponent(urlParams.get('name') || 'Ученик');

if (!roomId) {
    alert('Не указан ID комнаты!');
    window.location.href = '/';
}

// ---- Canvas ----
const canvas = new fabric.Canvas('canvas', { backgroundColor: 'white', selection: false });

function resizeCanvas() {
    const container = document.querySelector('.canvas-area');
    if (!container) return;
    canvas.setWidth(container.clientWidth);
    canvas.setHeight(container.clientHeight);
    canvas.renderAll();
}
window.addEventListener('resize', resizeCanvas);
setTimeout(resizeCanvas, 100);

canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
canvas.freeDrawingBrush.width = 5;
canvas.freeDrawingBrush.color = '#000000';
canvas.isDrawingMode = false;

let currentTool = 'pencil';

// ---- UI ----
const roomIdEl = document.getElementById('room-id');
if (roomIdEl) roomIdEl.innerText = `ID: ${roomId}`;

const usernameEl = document.getElementById('username-display');
if (usernameEl) usernameEl.innerHTML = `<i class="fas fa-user-graduate"></i> ${userName}`;

// ---- Блокировка доступа (ОБЪЯВЛЯЕМ РАНЬШЕ) ----
let hasAccess = true;
const accessIndicator = document.getElementById('access-indicator');

// ---- Инструменты (карандаш, ластик, выход) ----
const pencilBtn = document.getElementById('tool-pencil');
const eraserBtn = document.getElementById('tool-eraser');
const exitBtn = document.getElementById('exit-btn');

if (pencilBtn) {
    pencilBtn.addEventListener('click', () => {
        document.querySelectorAll('.sidebar .tool-btn').forEach(b => b.classList.remove('active'));
        pencilBtn.classList.add('active');
        currentTool = 'pencil';
        canvas.isDrawingMode = hasAccess; // только если доступ открыт
    });
}

if (eraserBtn) {
    eraserBtn.addEventListener('click', () => {
        document.querySelectorAll('.sidebar .tool-btn').forEach(b => b.classList.remove('active'));
        eraserBtn.classList.add('active');
        currentTool = 'eraser';
        canvas.isDrawingMode = false;
    });
}

if (exitBtn) {
    exitBtn.addEventListener('click', () => {
        window.location.href = '/';
    });
}
pencilBtn?.classList.add('active');

// ---- Рисование (с проверкой доступа) ----
canvas.on('path:created', (e) => {
    if (!hasAccess) {
        canvas.remove(e.path);
        showNotification('Доступ к рисованию закрыт', 2000);
        return;
    }
    e.path.set({ id: 'student-' + Date.now() });
    socket.emit('drawing-data', { roomId, object: e.path.toObject(['id']) });
});

canvas.on('mouse:down', (opt) => {
    if (currentTool === 'eraser' && hasAccess) {
        const target = canvas.findTarget(opt.e);
        if (target) {
            canvas.remove(target);
            socket.emit('remove-object', { roomId, id: target.id });
        }
    }
});

// ---- Блокировка доступа (управление репетитором) ----
socket.on('admin-lock-status', (locked) => {
    hasAccess = !locked;
    canvas.isDrawingMode = hasAccess && currentTool === 'pencil';
    
    document.querySelectorAll('.sidebar .tool-btn').forEach(btn => {
        if (btn.id !== 'exit-btn' && btn.id !== 'tool-video') {
            btn.style.opacity = hasAccess ? '1' : '0.5';
            btn.style.pointerEvents = hasAccess ? 'auto' : 'none';
        }
    });
    
    if (accessIndicator) {
        if (hasAccess) {
            accessIndicator.style.background = 'var(--success)';
            accessIndicator.innerHTML = '<i class="fas fa-check-circle"></i> Доступ разрешён';
        } else {
            accessIndicator.style.background = 'var(--danger)';
            accessIndicator.innerHTML = '<i class="fas fa-lock"></i> Доступ ограничен';
        }
    }
    
    showNotification(hasAccess ? 'Репетитор разрешил рисовать' : 'Репетитор ограничил доступ');
});

// ---- Обработка несуществующей комнаты ----
socket.on('room-not-found', (missingRoomId) => {
    alert(`Комната с ID "${missingRoomId}" не найдена. Уточните ID у репетитора.`);
    window.location.href = '/';
});

// ---- Синхронизация доски ----
socket.emit('join-room', roomId, 'student');

socket.on('init-canvas', (data) => {
    canvas.loadFromJSON(data, () => {
        canvas.renderAll();
        resizeCanvas();
    });
});

socket.on('draw-to-client', (obj) => {
    fabric.util.enlivenObjects([obj], (objects) => {
        const objToAdd = objects[0];
        const existing = canvas.getObjects().find(o => o.id === obj.id);
        if (existing) canvas.remove(existing);
        canvas.add(objToAdd);
        canvas.renderAll();
    });
});

socket.on('remove-object', (id) => {
    const obj = canvas.getObjects().find(o => o.id === id);
    if (obj) canvas.remove(obj);
});

socket.on('clear-canvas', () => {
    canvas.clear();
    canvas.backgroundColor = 'white';
});

// ---- Видеозвонок ----
if (typeof initWebRTC === 'function') {
    initWebRTC(socket, roomId, 'student');
} else {
    console.error('webrtc.js не загружен!');
}

// ---- Уведомления ----
function showNotification(msg, duration = 3000) {
    const notif = document.getElementById('notification');
    if (notif) {
        const textEl = document.getElementById('notification-text');
        if (textEl) textEl.innerText = msg;
        notif.classList.add('show');
        setTimeout(() => notif.classList.remove('show'), duration);
    }
}

setTimeout(() => showNotification(`Добро пожаловать, ${userName}!`, 3000), 500);