// student.js — ИСПРАВЛЕННОЕ МАСШТАБИРОВАНИЕ С ЦЕНТРИРОВАНИЕМ + УБРАН АВТОСТАРТ ВИДЕО

document.addEventListener('DOMContentLoaded', () => {
    const socket = io();
    const urlParams = new URLSearchParams(window.location.search);
    const roomId = urlParams.get('room');
    const userName = decodeURIComponent(urlParams.get('name') || 'Ученик');

    if (!roomId) {
        alert('Нет ID комнаты');
        window.location.href = '/';
        return;
    }

    // ---------- CANVAS ----------
    const canvas = new fabric.Canvas('canvas', { 
        backgroundColor: 'white', 
        selection: false 
    });

    // ---------- ПРАВИЛЬНОЕ МАСШТАБИРОВАНИЕ С ЦЕНТРИРОВАНИЕМ ----------
    function applyCanvasState(stateJson) {
        const width = canvas.getWidth();
        const height = canvas.getHeight();

        canvas.loadFromJSON(stateJson, () => {
            const originalWidth = stateJson.width;
            const originalHeight = stateJson.height;

            if (!originalWidth || !originalHeight) {
                console.warn('Нет оригинальных размеров');
                canvas.renderAll();
                return;
            }

            const scaleX = width / originalWidth;
            const scaleY = height / originalHeight;
            const scale = Math.min(scaleX, scaleY);

            const objects = canvas.getObjects();
            objects.forEach(obj => {
                obj.scaleX = (obj.scaleX || 1) * scale;
                obj.scaleY = (obj.scaleY || 1) * scale;
                obj.left = (obj.left || 0) * scale;
                obj.top = (obj.top || 0) * scale;
                if (obj.width) obj.width *= scale;
                if (obj.height) obj.height *= scale;
                if (obj.radius) obj.radius *= scale;
                if (obj.x1 !== undefined) { obj.x1 *= scale; obj.x2 *= scale; }
                if (obj.y1 !== undefined) { obj.y1 *= scale; obj.y2 *= scale; }

                // Масштабирование path (рисование карандашом)
                if (obj.type === 'path' && obj.path) {
                    obj.path.forEach(command => {
                        if (Array.isArray(command) && command.length >= 3) {
                            for (let i = 1; i < command.length; i += 2) {
                                command[i] *= scale;     // x
                                if (i + 1 < command.length) command[i + 1] *= scale; // y
                            }
                        }
                    });
                }
                obj.setCoords();
            });

            // Центрирование (letterbox)
            const scaledWidth = originalWidth * scale;
            const scaledHeight = originalHeight * scale;
            const offsetX = (width - scaledWidth) / 2;
            const offsetY = (height - scaledHeight) / 2;

            objects.forEach(obj => {
                if (obj.left !== undefined) obj.left += offsetX;
                if (obj.top !== undefined) obj.top += offsetY;
                if (obj.x1 !== undefined) { obj.x1 += offsetX; obj.x2 += offsetX; }
                if (obj.y1 !== undefined) { obj.y1 += offsetY; obj.y2 += offsetY; }
                if (obj.type === 'path' && obj.path) {
                    obj.path.forEach(command => {
                        if (Array.isArray(command) && command.length >= 3) {
                            for (let i = 1; i < command.length; i += 2) {
                                command[i] += offsetX;
                                if (i + 1 < command.length) command[i + 1] += offsetY;
                            }
                        }
                    });
                }
                obj.setCoords();
            });

            canvas.renderAll();
        });
    }

    function resizeCanvas() {
        const container = document.querySelector('.canvas-container') || document.querySelector('.canvas-area');
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
    canvas.isDrawingMode = false;

    let currentTool = 'pencil';
    let hasAccess = true;

    // ---------- UI ----------
    const roomIdEl = document.getElementById('room-id');
    if (roomIdEl) roomIdEl.innerText = `ID: ${roomId}`;

    const usernameEl = document.getElementById('username-display');
    if (usernameEl) usernameEl.innerHTML = `<i class="fas fa-user-graduate"></i> ${userName}`;

    const accessIndicator = document.getElementById('access-indicator');

    // ---------- ИНСТРУМЕНТЫ ----------
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

    // ---------- РИСОВАНИЕ ----------
    canvas.on('path:created', (e) => {
        if (!hasAccess) {
            canvas.remove(e.path);
            showNotification('Доступ закрыт', 2000);
            return;
        }
        e.path.set({ id: 'student-' + Date.now() });
        const pathData = e.path.toObject(['id']);
        socket.emit('drawing-data', { roomId, object: pathData });
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

    // ---------- БЛОКИРОВКА ----------
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

    // ---------- НЕСУЩЕСТВУЮЩАЯ КОМНАТА ----------
    socket.on('room-not-found', () => {
        alert('Комната не найдена. Уточните ID у репетитора.');
        window.location.href = '/';
    });

    // ---------- СИНХРОНИЗАЦИЯ ----------
    socket.emit('join-room', roomId, 'student');

    socket.on('init-canvas', ({ canvasJson }) => {
        if (canvasJson) applyCanvasState(canvasJson);
        resizeCanvas();
    });

    socket.on('canvas-state', ({ canvasJson }) => {
        applyCanvasState(canvasJson);
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
        canvas.renderAll();
    });

    socket.on('clear-canvas', () => {
        canvas.clear();
        canvas.backgroundColor = 'white';
        canvas.renderAll();
    });

    // ---------- ВИДЕО ----------
    if (typeof initWebRTC === 'function') {
        initWebRTC(socket, roomId, 'student');
    }

    // ---------- УВЕДОМЛЕНИЯ ----------
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
});