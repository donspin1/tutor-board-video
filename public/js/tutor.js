// tutor.js — ПОЛНАЯ ВЕРСИЯ с отправкой размеров и объектов

document.addEventListener('DOMContentLoaded', () => {
    const socket = io();
    
    const urlParams = new URLSearchParams(window.location.search);
    const roomId = urlParams.get('room');
    if (!roomId) {
        window.location.href = '/tutor-login.html';
        return;
    }
    const userName = decodeURIComponent(urlParams.get('name') || 'Репетитор');

    // ---------- CANVAS ----------
    const canvas = new fabric.Canvas('canvas', { backgroundColor: 'white' });

    // Функция для отправки размеров холста
    function sendCanvasSize() {
        const width = canvas.getWidth();
        const height = canvas.getHeight();
        socket.emit('canvas-size', { roomId, width, height });
    }

    // Функция изменения размера холста
    function resizeCanvas() {
        const container = document.querySelector('.canvas-container');
        if (!container) return;
        canvas.setWidth(container.clientWidth);
        canvas.setHeight(container.clientHeight);
        canvas.renderAll();
        sendCanvasSize(); // отправляем новые размеры после изменения
    }

    window.addEventListener('resize', resizeCanvas);
    setTimeout(resizeCanvas, 100);
    setTimeout(resizeCanvas, 300);

    // Настройки кисти
    canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
    canvas.freeDrawingBrush.width = 5;
    canvas.freeDrawingBrush.color = '#000000';
    canvas.isDrawingMode = true;

    let currentTool = 'pencil';
    let currentColor = '#000000';
    let brushSize = 5;
    let isDrawingShape = false;
    let startX, startY, shape;

    // ---------- UI ----------
    const roomIdEl = document.getElementById('room-id');
    if (roomIdEl) roomIdEl.innerText = `ID: ${roomId}`;
    
    const usernameEl = document.getElementById('username-display');
    if (usernameEl) usernameEl.innerHTML = `<i class="fas fa-user"></i> ${userName}`;

    // ---------- ЦВЕТОВАЯ ПАЛИТРА ----------
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

    // ---------- РАЗМЕР КИСТИ ----------
    const brushSlider = document.getElementById('brush-slider');
    if (brushSlider) {
        brushSlider.addEventListener('input', (e) => {
            brushSize = parseInt(e.target.value);
            document.getElementById('brush-size').innerText = brushSize;
            canvas.freeDrawingBrush.width = brushSize;
        });
    }

    // ---------- ИНСТРУМЕНТЫ ----------
    document.querySelectorAll('.sidebar .tool-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.id === 'tool-exit') return;
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

    // ---------- РИСОВАНИЕ ФИГУР ----------
    canvas.on('mouse:down', (opt) => {
        if (!['line', 'rect', 'circle', 'text'].includes(currentTool)) return;
        if (currentTool === 'text') {
            const text = prompt('Введите текст:');
            if (!text) return;
            const pointer = canvas.getPointer(opt.e);
            const textObj = new fabric.Text(text, {
                left: pointer.x,
                top: pointer.y,
                fontSize: 20,
                fill: currentColor,
                id: 'tutor-' + Date.now() + '-' + Math.random()
            });
            canvas.add(textObj);
            canvas.renderAll();
            socket.emit('drawing-data', { roomId, object: textObj.toObject(['id']) });
            return;
        }

        isDrawingShape = true;
        const pointer = canvas.getPointer(opt.e);
        startX = pointer.x;
        startY = pointer.y;

        switch (currentTool) {
            case 'line':
                shape = new fabric.Line([startX, startY, startX, startY], {
                    stroke: currentColor,
                    strokeWidth: brushSize,
                    id: 'tutor-' + Date.now() + '-' + Math.random()
                });
                break;
            case 'rect':
                shape = new fabric.Rect({
                    left: startX,
                    top: startY,
                    width: 0,
                    height: 0,
                    stroke: currentColor,
                    strokeWidth: brushSize,
                    fill: 'transparent',
                    id: 'tutor-' + Date.now() + '-' + Math.random()
                });
                break;
            case 'circle':
                shape = new fabric.Circle({
                    left: startX,
                    top: startY,
                    radius: 0,
                    stroke: currentColor,
                    strokeWidth: brushSize,
                    fill: 'transparent',
                    id: 'tutor-' + Date.now() + '-' + Math.random()
                });
                break;
        }
        canvas.add(shape);
    });

    canvas.on('mouse:move', (opt) => {
        if (!isDrawingShape || !shape) return;
        const pointer = canvas.getPointer(opt.e);
        switch (currentTool) {
            case 'line':
                shape.set({ x2: pointer.x, y2: pointer.y });
                break;
            case 'rect':
                shape.set({
                    width: Math.abs(pointer.x - startX),
                    height: Math.abs(pointer.y - startY),
                    left: Math.min(pointer.x, startX),
                    top: Math.min(pointer.y, startY)
                });
                break;
            case 'circle':
                const radius = Math.sqrt(Math.pow(pointer.x - startX, 2) + Math.pow(pointer.y - startY, 2)) / 2;
                shape.set({
                    radius: radius,
                    left: (startX + pointer.x) / 2 - radius,
                    top: (startY + pointer.y) / 2 - radius
                });
                break;
        }
        canvas.renderAll();
    });

    canvas.on('mouse:up', () => {
        if (isDrawingShape && shape) {
            socket.emit('drawing-data', { roomId, object: shape.toObject(['id']) });
        }
        isDrawingShape = false;
        shape = null;
    });

    // Карандаш
    canvas.on('path:created', (e) => {
        e.path.set({ id: 'tutor-' + Date.now() + '-' + Math.random() });
        const pathData = e.path.toObject(['id']);
        socket.emit('drawing-data', { roomId, object: pathData });
    });

    // Ластик (удаление по клику)
    canvas.on('mouse:down', (opt) => {
        if (currentTool === 'eraser') {
            const target = canvas.findTarget(opt.e);
            if (target) {
                canvas.remove(target);
                socket.emit('remove-object', { roomId, id: target.id });
            }
        }
    });

    // Отправка полного состояния при изменении (для синхронизации)
    canvas.on('object:modified', () => sendCanvasState());
    canvas.on('object:removed', () => sendCanvasState());

    function sendCanvasState() {
        const json = canvas.toJSON(['id']);
        json.width = canvas.getWidth();
        json.height = canvas.getHeight();
        socket.emit('canvas-state', { roomId, canvasJson: json });
    }

    // ---------- ЗАГРУЗКА ----------
    document.getElementById('tool-upload')?.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = (e) => {
            const file = e.target.files[0];
            const reader = new FileReader();
            reader.onload = (event) => {
                fabric.Image.fromURL(event.target.result, (img) => {
                    img.set({
                        id: 'tutor-' + Date.now() + '-' + Math.random(),
                        left: 50,
                        top: 50
                    });
                    canvas.add(img);
                    canvas.renderAll();
                    socket.emit('drawing-data', { roomId, object: img.toObject(['id']) });
                });
            };
            reader.readAsDataURL(file);
        };
        input.click();
    });

    document.getElementById('tool-clear')?.addEventListener('click', () => {
        if (confirm('Очистить доску?')) {
            canvas.clear();
            canvas.backgroundColor = 'white';
            sendCanvasState();
            socket.emit('clear-room', roomId);
        }
    });

    document.getElementById('clear-btn')?.addEventListener('click', () => {
        document.getElementById('tool-clear')?.click();
    });

    document.getElementById('tool-save')?.addEventListener('click', () => {
        const dataURL = canvas.toDataURL({ format: 'png', quality: 1 });
        const link = document.createElement('a');
        link.download = `board-${roomId}.png`;
        link.href = dataURL;
        link.click();
    });

    // ---------- КОПИРОВАНИЕ ----------
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

    // ---------- БЛОКИРОВКА ----------
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

    // ---------- SOCKET ----------
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

    socket.on('draw-to-client', (obj) => {
        if (!obj) return;
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

    // ---------- WEBRTC ----------
    if (typeof initWebRTC === 'function') {
        initWebRTC(socket, roomId, 'tutor');
    }

    // ---------- УВЕДОМЛЕНИЯ ----------
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