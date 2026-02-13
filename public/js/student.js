// student.js — ТОЛЬКО ДОСКА (видео полностью в webrtc.js)

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

    let originalWidth = null;
    let originalHeight = null;
    let currentScale = 1;
    let currentOffsetX = 0;
    let currentOffsetY = 0;

    // ---------- МАСШТАБИРОВАНИЕ ----------
    function applyCanvasState(stateJson) {
        originalWidth = stateJson.width;
        originalHeight = stateJson.height;
        if (!originalWidth || !originalHeight) return;

        canvas.loadFromJSON(stateJson, () => {
            const container = document.querySelector('.canvas-container');
            if (container) {
                canvas.setWidth(container.clientWidth);
                canvas.setHeight(container.clientHeight);
            }

            const canvasWidth = canvas.getWidth();
            const canvasHeight = canvas.getHeight();
            const scaleX = canvasWidth / originalWidth;
            const scaleY = canvasHeight / originalHeight;
            currentScale = Math.min(scaleX, scaleY);
            currentOffsetX = (canvasWidth - originalWidth * currentScale) / 2;
            currentOffsetY = (canvasHeight - originalHeight * currentScale) / 2;
            canvas.viewportTransform = [currentScale, 0, 0, currentScale, currentOffsetX, currentOffsetY];
            canvas.renderAll();
        });
    }

    // ---------- ПРЕОБРАЗОВАНИЕ КООРДИНАТ ----------
    function studentToOriginalCoords(obj) {
        if (!obj) return obj;
        const newObj = JSON.parse(JSON.stringify(obj));

        const scale = currentScale;
        const offsetX = currentOffsetX;
        const offsetY = currentOffsetY;

        function transformX(x) { return (x - offsetX) / scale; }
        function transformY(y) { return (y - offsetY) / scale; }

        if (newObj.left !== undefined) newObj.left = transformX(newObj.left);
        if (newObj.top !== undefined) newObj.top = transformY(newObj.top);
        if (newObj.x1 !== undefined) newObj.x1 = transformX(newObj.x1);
        if (newObj.x2 !== undefined) newObj.x2 = transformX(newObj.x2);
        if (newObj.y1 !== undefined) newObj.y1 = transformY(newObj.y1);
        if (newObj.y2 !== undefined) newObj.y2 = transformY(newObj.y2);
        if (newObj.width !== undefined) newObj.width = newObj.width / scale;
        if (newObj.height !== undefined) newObj.height = newObj.height / scale;
        if (newObj.radius !== undefined) newObj.radius = newObj.radius / scale;
        
        if (newObj.path) {
            newObj.path.forEach(cmd => {
                for (let i = 1; i < cmd.length; i += 2) {
                    cmd[i] = transformX(cmd[i]);
                    if (i + 1 < cmd.length) {
                        cmd[i + 1] = transformY(cmd[i + 1]);
                    }
                }
            });
        }

        return newObj;
    }

    function resizeCanvas() {
        const container = document.querySelector('.canvas-container');
        if (!container) return;
        
        canvas.setWidth(container.clientWidth);
        canvas.setHeight(container.clientHeight);

        if (originalWidth && originalHeight) {
            const canvasWidth = canvas.getWidth();
            const canvasHeight = canvas.getHeight();

            const scaleX = canvasWidth / originalWidth;
            const scaleY = canvasHeight / originalHeight;
            currentScale = Math.min(scaleX, scaleY);

            currentOffsetX = (canvasWidth - originalWidth * currentScale) / 2;
            currentOffsetY = (canvasHeight - originalHeight * currentScale) / 2;

            canvas.viewportTransform = [currentScale, 0, 0, currentScale, currentOffsetX, currentOffsetY];
        }
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
        const originalCoordsData = studentToOriginalCoords(pathData);
        socket.emit('drawing-data', { roomId, object: originalCoordsData });
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
            if (btn.id !== 'tool-pencil' && btn.id !== 'tool-eraser') return;
            btn.style.opacity = hasAccess ? '1' : '0.5';
            btn.style.pointerEvents = hasAccess ? 'auto' : 'none';
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

    // ---------- КОМНАТА ----------
    socket.on('room-not-found', () => {
        alert('Комната с таким ID не существует.');
        window.location.href = '/';
    });

    // ⛔ НОВОЕ: нет репетитора в комнате
    socket.on('room-no-tutor', () => {
        alert('В комнате нет репетитора. Вход невозможен.');
        window.location.href = '/';
    });

    socket.emit('join-room', roomId, 'student');

    socket.on('init-canvas', (data) => {
        if (data.canvasJson) applyCanvasState(data.canvasJson);
    });

    socket.on('canvas-state', ({ canvasJson }) => {
        applyCanvasState(canvasJson);
    });

    socket.on('draw-to-client', (obj) => {
        if (!obj) return;
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
        originalWidth = null;
        originalHeight = null;
    });

    // ---------- ВИДЕО ----------
    if (typeof initWebRTC === 'function') {
        initWebRTC(socket, roomId, 'student');
    }

    // ---------- РЕПЕТИТОР ПОКИНУЛ КОМНАТУ → ВЫХОДИМ ----------
    socket.on('tutor-left', () => {
        console.log('👨‍🏫 Репетитор покинул комнату. Перенаправление...');
        alert('Репетитор завершил занятие. Вы будете перенаправлены на главную.');
        window.location.href = '/';
    });

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