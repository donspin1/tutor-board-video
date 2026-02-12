// tutor.js — ТОЛЬКО ДОСКА И ИНТЕРФЕЙС

document.addEventListener('DOMContentLoaded', () => {
    const socket = io();
    
    const urlParams = new URLSearchParams(window.location.search);
    const roomId = urlParams.get('room');
    if (!roomId) {
        window.location.href = '/tutor-login.html';
        return;
    }
    const userName = decodeURIComponent(urlParams.get('name') || 'Репетитор');

    const canvas = new fabric.Canvas('canvas', { backgroundColor: 'white' });

    function resizeCanvas() {
        const container = document.querySelector('.canvas-container');
        if (!container) return;
        canvas.setWidth(container.clientWidth);
        canvas.setHeight(container.clientHeight);
        canvas.renderAll();
    }
    window.addEventListener('resize', resizeCanvas);
    setTimeout(resizeCanvas, 100);
    setTimeout(resizeCanvas, 300);

    canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
    canvas.freeDrawingBrush.width = 5;
    canvas.freeDrawingBrush.color = '#000000';
    canvas.isDrawingMode = true;

    let currentTool = 'pencil';
    let currentColor = '#000000';
    let brushSize = 5;
    let isDrawingShape = false;
    let startX, startY, shape;

    function sendCanvasState() {
        const json = canvas.toJSON(['id']);
        json.width = canvas.getWidth();
        json.height = canvas.getHeight();
        socket.emit('canvas-state', { roomId, canvasJson: json });
    }

    // UI
    const roomIdEl = document.getElementById('room-id');
    if (roomIdEl) roomIdEl.innerText = `ID: ${roomId}`;
    const usernameEl = document.getElementById('username-display');
    if (usernameEl) usernameEl.innerHTML = `<i class="fas fa-user"></i> ${userName}`;

    // Цветовая палитра
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

    // Размер кисти
    const brushSlider = document.getElementById('brush-slider');
    if (brushSlider) {
        brushSlider.addEventListener('input', (e) => {
            brushSize = parseInt(e.target.value);
            document.getElementById('brush-size').innerText = brushSize;
            canvas.freeDrawingBrush.width = brushSize;
        });
    }

    // Инструменты
    document.querySelectorAll('.sidebar .tool-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.id === 'tool-video' || btn.id === 'tool-exit') return;
            document.querySelectorAll('.sidebar .tool-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const tool = btn.id.replace('tool-', '');
            currentTool = tool;
            canvas.isDrawingMode = (tool === 'pencil');
            if (['pencil', 'line', 'rect', 'circle', 'text', 'eraser'].includes(tool)) {
                document.getElementById('properties-panel')?.classList.add('active');
            } else {
                document.getElementById('properties-panel')?.classList.remove('active');
            }
        });
    });
    document.getElementById('tool-pencil')?.classList.add('active');

    // Рисование фигур
    canvas.on('mouse:down', (opt) => { /* ... */ });
    canvas.on('mouse:move', (opt) => { /* ... */ });
    canvas.on('mouse:up', () => { /* ... */ });
    canvas.on('path:created', (e) => { /* ... */ });
    canvas.on('object:modified', () => sendCanvasState());
    canvas.on('object:removed', () => sendCanvasState());

    // Загрузка
    document.getElementById('tool-upload')?.addEventListener('click', () => { /* ... */ });
    document.getElementById('tool-clear')?.addEventListener('click', () => { /* ... */ });
    document.getElementById('clear-btn')?.addEventListener('click', () => { /* ... */ });
    document.getElementById('tool-save')?.addEventListener('click', () => { /* ... */ });

    // Копирование
    function copyToClipboard(text, msg) {
        if (navigator.clipboard) {
            navigator.clipboard.writeText(text).then(() => showNotification(msg));
        } else {
            prompt('Скопируйте вручную:', text);
        }
    }
    document.getElementById('copy-room-id')?.addEventListener('click', () => copyToClipboard(roomId, 'ID скопирован'));
    document.getElementById('copy-student-link')?.addEventListener('click', () => {
        const url = `${window.location.origin}/student.html?room=${encodeURIComponent(roomId)}&name=Ученик`;
        copyToClipboard(url, 'Ссылка для ученика скопирована');
    });

    // Блокировка
    let isLocked = false;
    const lockBtn = document.getElementById('lock-btn');
    if (lockBtn) {
        lockBtn.addEventListener('click', () => {
            isLocked = !isLocked;
            lockBtn.classList.toggle('locked', isLocked);
            lockBtn.innerHTML = isLocked ? '<i class="fas fa-lock"></i>' : '<i class="fas fa-unlock-alt"></i>';
            socket.emit('set-lock', { roomId, locked: isLocked });
            showNotification(isLocked ? 'Доступ закрыт' : 'Доступ открыт');
        });
    }

    // Выход
    document.getElementById('tool-exit')?.addEventListener('click', () => {
        if (typeof stopVideoCall === 'function' && window.isVideoActive) stopVideoCall();
        window.location.href = '/tutor-login.html';
    });

    // Socket
    socket.emit('join-room', roomId, 'tutor');

    socket.on('init-canvas', (data) => {
        if (data.canvasJson) {
            canvas.loadFromJSON(data.canvasJson, () => {
                canvas.renderAll();
                resizeCanvas();
            });
        }
        if (data.locked !== undefined) {
            isLocked = data.locked;
            if (lockBtn) {
                lockBtn.classList.toggle('locked', isLocked);
                lockBtn.innerHTML = isLocked ? '<i class="fas fa-lock"></i>' : '<i class="fas fa-unlock-alt"></i>';
            }
        }
    });

    // Приём рисунков от ученика
    socket.on('draw-to-client', (obj) => {
        fabric.util.enlivenObjects([obj], (objects) => {
            const objToAdd = objects[0];
            const existing = canvas.getObjects().find(o => o.id === obj.id);
            if (existing) canvas.remove(existing);
            canvas.add(objToAdd);
            canvas.renderAll();
            sendCanvasState();
        });
    });

    socket.on('remove-object', (id) => {
        const obj = canvas.getObjects().find(o => o.id === id);
        if (obj) {
            canvas.remove(obj);
            sendCanvasState();
        }
    });

    socket.on('clear-canvas', () => {
        canvas.clear();
        canvas.backgroundColor = 'white';
        sendCanvasState();
    });

    // WebRTC
    if (typeof initWebRTC === 'function') {
        initWebRTC(socket, roomId, 'tutor');
    }

    // Перетаскивание панели свойств
    const propsPanel = document.getElementById('properties-panel');
    if (propsPanel && typeof makeDraggable === 'function') {
        const handle = propsPanel.querySelector('.panel-header');
        if (handle && !propsPanel.dataset.draggable) {
            makeDraggable(propsPanel, handle);
            propsPanel.dataset.draggable = 'true';
        }
    }

    document.getElementById('close-properties')?.addEventListener('click', () => {
        document.getElementById('properties-panel')?.classList.remove('active');
    });

    function showNotification(msg, duration = 3000) {
        const notif = document.getElementById('notification');
        if (notif) {
            document.getElementById('notification-text').innerText = msg;
            notif.classList.add('show');
            setTimeout(() => notif.classList.remove('show'), duration);
        }
    }

    setTimeout(() => showNotification(`Добро пожаловать, ${userName}!`, 3000), 500);
});