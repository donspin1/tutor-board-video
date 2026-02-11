// tutor.js — исправленная и дополненная версия

const socket = io();
const urlParams = new URLSearchParams(window.location.search);
const roomId = urlParams.get('room') || 'room-' + Math.random().toString(36).substring(2, 8);
const userName = decodeURIComponent(urlParams.get('name') || 'Репетитор');

// ---- Canvas ----
const canvas = new fabric.Canvas('canvas', { backgroundColor: 'white' });

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
canvas.isDrawingMode = true;

let currentTool = 'pencil';
let currentColor = '#000000';
let brushSize = 5;
let isDrawingShape = false;
let startX, startY, shape;

// ---- UI ----
document.getElementById('room-id').innerText = `ID: ${roomId}`;
document.getElementById('username-display').innerHTML = `<i class="fas fa-user"></i> ${userName}`;

// ---- Цветовая палитра ----
const colors = ['#000000', '#ffffff', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#6366f1', '#8b5cf6', '#ec4899', '#64748b'];
const palette = document.getElementById('color-palette');
if (palette) {
    colors.forEach(c => {
        const btn = document.createElement('div');
        btn.className = 'color-btn' + (c === '#000000' ? ' active' : '');
        btn.style.backgroundColor = c;
        btn.addEventListener('click', () => {
            document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentColor = c;
            canvas.freeDrawingBrush.color = c;
        });
        palette.appendChild(btn);
    });
}

// ---- Размер кисти ----
const brushSlider = document.getElementById('brush-slider');
if (brushSlider) {
    brushSlider.addEventListener('input', (e) => {
        brushSize = parseInt(e.target.value);
        document.getElementById('brush-size').innerText = brushSize;
        canvas.freeDrawingBrush.width = brushSize;
    });
}

// ---- Инструменты ----
document.querySelectorAll('.sidebar .tool-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        if (btn.id === 'tool-video') return; // видео обрабатывается отдельно
        document.querySelectorAll('.sidebar .tool-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tool = btn.id.replace('tool-', '');
        currentTool = tool;
        canvas.isDrawingMode = (tool === 'pencil');
        
        // Показываем панель свойств для инструментов рисования
        if (['pencil', 'line', 'rect', 'circle', 'text', 'eraser'].includes(tool)) {
            document.getElementById('properties-panel')?.classList.add('active');
        } else {
            document.getElementById('properties-panel')?.classList.remove('active');
        }
    });
});
document.getElementById('tool-pencil')?.classList.add('active');

// ---- Рисование фигур ----
canvas.on('mouse:down', (opt) => {
    if (currentTool === 'line' || currentTool === 'rect' || currentTool === 'circle') {
        isDrawingShape = true;
        const pointer = canvas.getPointer(opt.e);
        startX = pointer.x;
        startY = pointer.y;
        
        if (currentTool === 'line') {
            shape = new fabric.Line([startX, startY, startX, startY], {
                stroke: currentColor,
                strokeWidth: brushSize,
                selectable: false
            });
        } else if (currentTool === 'rect') {
            shape = new fabric.Rect({
                left: startX,
                top: startY,
                width: 0,
                height: 0,
                stroke: currentColor,
                strokeWidth: brushSize,
                fill: 'transparent',
                selectable: false
            });
        } else if (currentTool === 'circle') {
            shape = new fabric.Circle({
                left: startX,
                top: startY,
                radius: 0,
                stroke: currentColor,
                strokeWidth: brushSize,
                fill: 'transparent',
                selectable: false
            });
        }
        canvas.add(shape);
    } else if (currentTool === 'text') {
        const pointer = canvas.getPointer(opt.e);
        const text = new fabric.IText('Текст', {
            left: pointer.x,
            top: pointer.y,
            fontSize: 20,
            fill: currentColor
        });
        canvas.add(text);
        text.enterEditing();
    } else if (currentTool === 'eraser') {
        const target = canvas.findTarget(opt.e);
        if (target) {
            canvas.remove(target);
            socket.emit('remove-object', { roomId, id: target.id });
        }
    }
});

canvas.on('mouse:move', (opt) => {
    if (!isDrawingShape || !shape) return;
    const pointer = canvas.getPointer(opt.e);
    if (currentTool === 'line') {
        shape.set({ x2: pointer.x, y2: pointer.y });
    } else if (currentTool === 'rect') {
        let w = pointer.x - startX;
        let h = pointer.y - startY;
        if (w < 0) { shape.set({ left: pointer.x }); w = -w; }
        if (h < 0) { shape.set({ top: pointer.y }); h = -h; }
        shape.set({ width: w, height: h });
    } else if (currentTool === 'circle') {
        const dx = pointer.x - startX;
        const dy = pointer.y - startY;
        const radius = Math.sqrt(dx*dx + dy*dy) / 2;
        shape.set({ radius });
    }
    canvas.renderAll();
});

canvas.on('mouse:up', () => {
    if (shape) {
        shape.set({ selectable: true, evented: true, id: 'obj-' + Date.now() });
        socket.emit('drawing-data', { roomId, object: shape.toObject(['id']) });
        shape = null;
    }
    isDrawingShape = false;
});

canvas.on('path:created', (e) => {
    e.path.set({ id: 'obj-' + Date.now() });
    socket.emit('drawing-data', { roomId, object: e.path.toObject(['id']) });
});

// ---- Загрузка изображений ----
document.getElementById('tool-upload')?.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                fabric.Image.fromURL(e.target.result, (img) => {
                    img.scaleToWidth(canvas.width * 0.5);
                    img.set({ id: 'img-' + Date.now() });
                    canvas.add(img);
                    socket.emit('drawing-data', { roomId, object: img.toObject(['id']) });
                });
            };
            reader.readAsDataURL(file);
        }
    };
    input.click();
});

// ---- Очистка ----
document.getElementById('tool-clear')?.addEventListener('click', () => {
    if (confirm('Очистить всю доску?')) {
        canvas.clear();
        canvas.backgroundColor = 'white';
        socket.emit('clear-room', roomId);
    }
});
document.getElementById('clear-btn')?.addEventListener('click', () => {
    canvas.clear();
    canvas.backgroundColor = 'white';
    socket.emit('clear-room', roomId);
    document.getElementById('properties-panel')?.classList.remove('active');
});

// ---- Сохранение ----
document.getElementById('tool-save')?.addEventListener('click', () => {
    const link = document.createElement('a');
    link.download = `board-${roomId}.png`;
    link.href = canvas.toDataURL();
    link.click();
});

// ---- Копирование ID комнаты ----
document.getElementById('copy-room-id')?.addEventListener('click', () => {
    navigator.clipboard.writeText(roomId);
    showNotification('ID комнаты скопирован');
});

// ---- Генерация ссылки для ученика ----
document.getElementById('copy-student-link')?.addEventListener('click', () => {
    const baseUrl = window.location.origin;
    const studentUrl = `${baseUrl}/student.html?room=${encodeURIComponent(roomId)}&name=Ученик`;
    navigator.clipboard.writeText(studentUrl).then(() => {
        showNotification('✅ Ссылка для ученика скопирована');
    }).catch(() => {
        prompt('Скопируйте ссылку вручную:', studentUrl);
    });
});

// ---- Управление доступом (блокировка) ----
let isLocked = false;
const lockBtn = document.getElementById('lock-btn');

function updateLockButton(locked) {
    if (locked) {
        lockBtn.style.background = 'var(--danger)';
        lockBtn.innerHTML = '<i class="fas fa-lock"></i> Доступ закрыт';
    } else {
        lockBtn.style.background = 'var(--success)';
        lockBtn.innerHTML = '<i class="fas fa-unlock"></i> Доступ открыт';
    }
}

if (lockBtn) {
    lockBtn.addEventListener('click', () => {
        isLocked = !isLocked;
        updateLockButton(isLocked);
        socket.emit('set-lock', { roomId, locked: isLocked });
        showNotification(isLocked ? 'Доступ для учеников закрыт' : 'Доступ для учеников открыт');
    });
}

// ---- Socket.IO доска ----
socket.emit('join-room', roomId);

socket.on('init-canvas', (data) => {
    canvas.loadFromJSON(data, () => {
        canvas.renderAll();
        resizeCanvas();
    });
    if (data.locked !== undefined) {
        isLocked = data.locked;
        if (lockBtn) updateLockButton(isLocked);
    }
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

// ---- WebRTC ----
if (typeof initWebRTC === 'function') {
    initWebRTC(socket, roomId, 'tutor');
}

// ---- Панель свойств ----
document.getElementById('close-properties')?.addEventListener('click', () => {
    document.getElementById('properties-panel')?.classList.remove('active');
});

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

// Приветствие
setTimeout(() => showNotification(`Добро пожаловать, ${userName}!`, 3000), 500);