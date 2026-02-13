// student.js — с отключением интерактивности при блокировке + исправленная мобильная адаптация

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

    // ---------- CANVAS с отключённой интерактивностью по умолчанию ----------
    const canvas = new fabric.Canvas('canvas', { 
        backgroundColor: 'white', 
        selection: false,
        interactive: false // изначально недоступен для взаимодействия
    });

    let originalWidth = null;
    let originalHeight = null;
    let currentScale = 1;
    let currentOffsetX = 0;
    let currentOffsetY = 0;
    let hasAccess = false;
    let currentTool = 'pencil'; // добавлено: по умолчанию карандаш

    const accessIndicator = document.getElementById('access-indicator');

    // ---------- ПЕРЕКЛЮЧЕНИЕ ИНСТРУМЕНТОВ (pencil / eraser) ----------
    document.querySelectorAll('.sidebar .tool-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.sidebar .tool-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentTool = btn.id.replace('tool-', '');
            if (hasAccess) {
                canvas.isDrawingMode = (currentTool === 'pencil');
            }
        });
    });
    document.getElementById('tool-pencil')?.classList.add('active');

    // ---------- НОВАЯ ФУНКЦИЯ ДЛЯ АДАПТАЦИИ ----------
    function resizeCanvasForStudent() {
        const container = document.querySelector('.canvas-container');
        if (!container || !originalWidth || !originalHeight) return;

        canvas.setDimensions({
            width: container.clientWidth,
            height: container.clientHeight
        });

        const scaleX = container.clientWidth / originalWidth;
        const scaleY = container.clientHeight / originalHeight;
        currentScale = Math.min(scaleX, scaleY);

        currentOffsetX = (container.clientWidth - originalWidth * currentScale) / 2;
        currentOffsetY = (container.clientHeight - originalHeight * currentScale) / 2;

        canvas.viewportTransform = [
            currentScale, 0,
            0, currentScale,
            currentOffsetX, currentOffsetY
        ];

        canvas.renderAll();
        canvas.requestRenderAll();
    }

    // ---------- МАСШТАБИРОВАНИЕ ----------
    function applyCanvasState(stateJson) {
        originalWidth = stateJson.width;
        originalHeight = stateJson.height;
        if (!originalWidth || !originalHeight) return;

        canvas.loadFromJSON(stateJson, () => {
            resizeCanvasForStudent();
        });
    }

    socket.on('canvas-size', ({ width, height }) => {
        if (width && height) {
            originalWidth = width;
            originalHeight = height;
            resizeCanvasForStudent();
        }
    });

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

    // ---------- РИСОВАНИЕ ----------
    canvas.on('path:created', (opt) => {
        if (!hasAccess || currentTool !== 'pencil') return;
        const obj = opt.path;
        obj.id = Date.now() + Math.random();
        const transformed = studentToOriginalCoords(obj.toObject(['id']));
        socket.emit('drawing-data', { roomId, object: transformed });
    });

    canvas.on('mouse:down', (opt) => {
        if (!hasAccess || currentTool !== 'eraser') return;
        const target = canvas.findTarget(opt.e);
        if (target) {
            canvas.remove(target);
            socket.emit('remove-object', { roomId, id: target.id });
        }
    });

    // ---------- БЛОКИРОВКА ----------
    function updateCanvasInteractive() {
        canvas.interactive = hasAccess;
        if (!hasAccess) {
            canvas.isDrawingMode = false;
        } else {
            canvas.isDrawingMode = (currentTool === 'pencil');
        }
    }

    socket.on('admin-lock-status', (locked) => {
        hasAccess = !locked;
        updateCanvasInteractive();

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

    socket.on('room-no-tutor', () => {
        alert('В комнате нет репетитора. Вход невозможен.');
        window.location.href = '/';
    });

    socket.emit('join-room', roomId, 'student');

    socket.on('init-canvas', (data) => {
        if (data.canvasJson) {
            applyCanvasState(data.canvasJson);
            resizeCanvasForStudent();
        }
        if (data.locked !== undefined) {
            hasAccess = !data.locked;
            updateCanvasInteractive();
            if (accessIndicator) {
                if (hasAccess) {
                    accessIndicator.style.background = 'var(--success)';
                    accessIndicator.innerHTML = '<i class="fas fa-check-circle"></i> Доступ разрешён';
                } else {
                    accessIndicator.style.background = 'var(--danger)';
                    accessIndicator.innerHTML = '<i class="fas fa-lock"></i> Доступ ограничен';
                }
            }
        }
    });

    socket.on('canvas-state', ({ canvasJson }) => {
        applyCanvasState(canvasJson);
        resizeCanvasForStudent();
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

    // ---------- РЕПЕТИТОР ПОКИНУЛ КОМНАТУ ----------
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

    // ---------- РЕСАЙЗ И ОРИЕНТАЦИЯ ----------
    window.addEventListener('resize', resizeCanvasForStudent);
    window.addEventListener('orientationchange', () => {
        setTimeout(resizeCanvasForStudent, 100);
    });

    // Надёжная инициализация
    setTimeout(resizeCanvasForStudent, 100);
    setTimeout(resizeCanvasForStudent, 500);
    setTimeout(resizeCanvasForStudent, 1000);

    setTimeout(() => showNotification(`Добро пожаловать, ${userName}!`, 3000), 500);
});