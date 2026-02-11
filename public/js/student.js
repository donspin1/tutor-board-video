// student.js — АВТОМАТИЧЕСКИЙ ЗАПУСК ВИДЕО ПРИ ВХОДЕ

const socket = io();
const urlParams = new URLSearchParams(window.location.search);
const roomId = urlParams.get('room');
const userName = decodeURIComponent(urlParams.get('name') || 'Ученик');

if (!roomId) {
    alert('Нет ID комнаты');
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
let hasAccess = true;

// ---- UI ----
const roomIdEl = document.getElementById('room-id');
if (roomIdEl) roomIdEl.innerText = `ID: ${roomId}`;

const usernameEl = document.getElementById('username-display');
if (usernameEl) usernameEl.innerHTML = `<i class="fas fa-user-graduate"></i> ${userName}`;

const accessIndicator = document.getElementById('access-indicator');

// ---- Инструменты ----
const pencilBtn = document.getElementById('tool-pencil');
const eraserBtn = document.getElementById('tool-eraser');
const exitBtn = document.getElementById('exit-btn');

if (pencilBtn) {
    pencilBtn.addEventListener('click', () => {
        document.querySelectorAll('.sidebar .tool-btn').forEach(b => b.classList.remove('active'));
        pencilBtn.classList.add('active');
        currentTool = 'pencil';
        canvas.isDrawingMode = hasAccess;
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
    exitBtn.addEventListener('click', () => window.location.href = '/');
}
pencilBtn?.classList.add('active');

// ---- Рисование ----
canvas.on('path:created', (e) => {
    if (!hasAccess) {
        canvas.remove(e.path);
        showNotification('Доступ закрыт', 2000);
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

// ---- БЛОКИРОВКА ДОСТУПА ----
socket.on('admin-lock-status', (locked) => {
    hasAccess = !locked;
    canvas.isDrawingMode = hasAccess && currentTool === 'pencil';

    document.querySelectorAll('.sidebar .tool-btn').forEach(btn => {
        if (!['exit-btn', 'tool-video'].includes(btn.id)) {
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

    showNotification(hasAccess ? 'Доступ открыт' : 'Доступ закрыт');
});

// ---- НЕСУЩЕСТВУЮЩАЯ КОМНАТА ----
socket.on('room-not-found', () => {
    alert('Комната не найдена. Уточните ID у репетитора.');
    window.location.href = '/';
});

// ---- СИНХРОНИЗАЦИЯ ДОСКИ ----
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

// ---- ВИДЕО: ИНИЦИАЛИЗАЦИЯ И АВТОСТАРТ ----
if (typeof initWebRTC === 'function') {
    initWebRTC(socket, roomId, 'student');
    
    // АВТОМАТИЧЕСКИ ЗАПУСКАЕМ ВИДЕО ДЛЯ УЧЕНИКА (с задержкой, чтобы страница загрузилась)
    setTimeout(() => {
        // Проверяем, не запущено ли уже видео
        if (typeof isVideoActive === 'undefined' || !isVideoActive) {
            console.log('🎥 Автостарт видео для ученика');
            // Используем глобальную функцию startVideoCall из webrtc.js
            if (typeof startVideoCall === 'function') {
                startVideoCall().catch(err => {
                    console.warn('Не удалось автостартовать видео:', err);
                });
            }
        }
    }, 1000);
} else {
    console.error('webrtc.js не загружен!');
}

// ---- УВЕДОМЛЕНИЯ ----
function showNotification(msg, duration = 3000) {
    const notif = document.getElementById('notification');
    if (notif) {
        document.getElementById('notification-text').innerText = msg;
        notif.classList.add('show');
        setTimeout(() => notif.classList.remove('show'), duration);
    }
}

setTimeout(() => showNotification(`Добро пожаловать, ${userName}!`, 3000), 500);