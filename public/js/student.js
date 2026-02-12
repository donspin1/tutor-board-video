// student.js — ПРИЁМ JSON И МАСШТАБИРОВАНИЕ (ПРАВИЛЬНО)

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

    // ---------- МАСШТАБИРОВАНИЕ КОНТЕНТА ПОД РАЗМЕР ХОЛСТА ----------
    function applyCanvasState(stateJson) {
        // Сохраняем текущие размеры
        const width = canvas.width;
        const height = canvas.height;
        
        // Загружаем состояние
        canvas.loadFromJSON(stateJson, () => {
            // Получаем оригинальные размеры холста из JSON
            const originalWidth = stateJson.width || 1400; // запасное значение
            const originalHeight = stateJson.height || 900;
            
            // Вычисляем коэффициенты масштабирования
            const scaleX = width / originalWidth;
            const scaleY = height / originalHeight;
            const scale = Math.min(scaleX, scaleY); // сохраняем пропорции
            
            // Применяем масштаб ко всем объектам
            canvas.getObjects().forEach(obj => {
                obj.scaleX = (obj.scaleX || 1) * scale;
                obj.scaleY = (obj.scaleY || 1) * scale;
                obj.left = (obj.left || 0) * scale;
                obj.top = (obj.top || 0) * scale;
                if (obj.width) obj.width = obj.width * scale;
                if (obj.height) obj.height = obj.height * scale;
                if (obj.radius) obj.radius = obj.radius * scale;
                if (obj.x1) obj.x1 = obj.x1 * scale;
                if (obj.x2) obj.x2 = obj.x2 * scale;
                if (obj.y1) obj.y1 = obj.y1 * scale;
                if (obj.y2) obj.y2 = obj.y2 * scale;
                obj.setCoords();
            });
            
            canvas.renderAll();
        });
    }

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

    // ---------- РИСОВАНИЕ (УЧЕНИК) ----------
    canvas.on('path:created', (e) => {
        if (!hasAccess) {
            canvas.remove(e.path);
            showNotification('Доступ закрыт', 2000);
            return;
        }
        e.path.set({ id: 'student-' + Date.now() });
        // Отправляем отдельный объект (как раньше)
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

    // ---------- БЛОКИРОВКА ДОСТУПА ----------
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

    // ---------- СИНХРОНИЗАЦИЯ ДОСКИ ----------
    socket.emit('join-room', roomId, 'student');

    socket.on('init-canvas', (data) => {
        if (data.objects) {
            applyCanvasState(data);
        }
        resizeCanvas();
    });

    // ---------- ПОЛУЧЕНИЕ ПОЛНОГО СОСТОЯНИЯ CANVAS ----------
    socket.on('canvas-state', ({ canvasJson }) => {
        applyCanvasState(canvasJson);
    });

    // ---------- ОТДЕЛЬНЫЕ ОБЪЕКТЫ (ОТ УЧЕНИКА) ----------
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

    // ---------- ВИДЕО ----------
    if (typeof initWebRTC === 'function') {
        initWebRTC(socket, roomId, 'student');
        setTimeout(() => {
            if (typeof window.isVideoActive !== 'undefined' && window.isVideoActive === true) {
                if (typeof stopVideoCall === 'function') stopVideoCall();
            }
            setTimeout(() => {
                if (typeof startVideoCall === 'function') {
                    startVideoCall().catch(err => console.warn('Не удалось автостартовать видео:', err));
                }
            }, 300);
        }, 1000);
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