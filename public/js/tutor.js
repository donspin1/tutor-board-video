// tutor.js — полностью исправленная версия с работающими кнопками

document.addEventListener('DOMContentLoaded', () => {
    const socket = io();
    
    const urlParams = new URLSearchParams(window.location.search);
    const roomId = urlParams.get('room');
    if (!roomId) {
        alert('Ошибка: не указан ID комнаты');
        window.location.href = '/tutor-login.html';
        return;
    }
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
    const roomIdEl = document.getElementById('room-id');
    if (roomIdEl) roomIdEl.innerText = `ID: ${roomId}`;
    
    const usernameEl = document.getElementById('username-display');
    if (usernameEl) usernameEl.innerHTML = `<i class="fas fa-user"></i> ${userName}`;

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
            if (btn.id === 'tool-video') return;
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

    // ---- Рисование фигур (без изменений, как в предыдущей версии) ----
    canvas.on('mouse:down', (opt) => { /* ... */ });
    canvas.on('mouse:move', (opt) => { /* ... */ });
    canvas.on('mouse:up', () => { /* ... */ });
    canvas.on('path:created', (e) => { /* ... */ });

    // ---- Загрузка, очистка, сохранение (без изменений) ----

    // ---------- ИСПРАВЛЕННЫЕ КНОПКИ КОПИРОВАНИЯ ----------
    function copyToClipboard(text, successMessage) {
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(text).then(() => {
                showNotification(successMessage);
            }).catch(() => fallbackCopy(text, successMessage));
        } else {
            fallbackCopy(text, successMessage);
        }
    }

    function fallbackCopy(text, successMessage) {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        try {
            document.execCommand('copy');
            showNotification(successMessage);
        } catch (err) {
            prompt('Не удалось скопировать. Скопируйте вручную:', text);
        }
        document.body.removeChild(textarea);
    }

    // Кнопка копирования ID
    const copyIdBtn = document.getElementById('copy-room-id');
    if (copyIdBtn) {
        copyIdBtn.addEventListener('click', () => {
            copyToClipboard(roomId, 'ID комнаты скопирован');
        });
    } else {
        console.warn('Кнопка #copy-room-id не найдена');
    }

    // Кнопка копирования ссылки для ученика
    const copyLinkBtn = document.getElementById('copy-student-link');
    if (copyLinkBtn) {
        copyLinkBtn.addEventListener('click', () => {
            const baseUrl = window.location.origin;
            const studentUrl = `${baseUrl}/student.html?room=${encodeURIComponent(roomId)}&name=Ученик`;
            copyToClipboard(studentUrl, '✅ Ссылка для ученика скопирована');
        });
    } else {
        console.warn('Кнопка #copy-student-link не найдена');
    }

    // ---- Управление доступом (блокировка) ----
    let isLocked = false;
    const lockBtn = document.getElementById('lock-btn');
    if (lockBtn) {
        lockBtn.addEventListener('click', () => {
            isLocked = !isLocked;
            updateLockButton(isLocked);
            socket.emit('set-lock', { roomId, locked: isLocked });
            showNotification(isLocked ? 'Доступ для учеников закрыт' : 'Доступ для учеников открыт');
        });
    } else {
        console.warn('Кнопка #lock-btn не найдена');
    }

    function updateLockButton(locked) {
        if (locked) {
            lockBtn.style.background = 'var(--danger)';
            lockBtn.innerHTML = '<i class="fas fa-lock"></i> Доступ закрыт';
        } else {
            lockBtn.style.background = 'var(--success)';
            lockBtn.innerHTML = '<i class="fas fa-unlock"></i> Доступ открыт';
        }
    }

    // ---- Socket.IO - передаём роль 'tutor' ----
    socket.emit('join-room', roomId, 'tutor');

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

    // Остальные socket-обработчики (draw-to-client, remove-object, clear-canvas) - без изменений
    // ...

    // ---- WebRTC ----
    if (typeof initWebRTC === 'function') {
        initWebRTC(socket, roomId, 'tutor');
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

    // ---- Закрытие панели свойств ----
    document.getElementById('close-properties')?.addEventListener('click', () => {
        document.getElementById('properties-panel')?.classList.remove('active');
    });

    // Приветствие
    setTimeout(() => showNotification(`Добро пожаловать, ${userName}!`, 3000), 500);
});