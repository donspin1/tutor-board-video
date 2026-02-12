// tutor.js — ФИНАЛЬНАЯ ВЕРСИЯ (синхронизация canvas-state и получение рисунков учеников)

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

    function sendCanvasState() {
        const json = canvas.toJSON(['id']);
        json.width = canvas.getWidth();
        json.height = canvas.getHeight();
        json.background = canvas.backgroundColor || 'white';
        socket.emit('canvas-state', { roomId, canvasJson: json });
    }

    const roomIdEl = document.getElementById('room-id');
    if (roomIdEl) roomIdEl.innerText = `ID: ${roomId}`;
    
    const usernameEl = document.getElementById('username-display');
    if (usernameEl) usernameEl.innerHTML = `<i class="fas fa-user"></i> ${userName}`;

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

    const brushSlider = document.getElementById('brush-slider');
    if (brushSlider) {
        brushSlider.addEventListener('input', (e) => {
            brushSize = parseInt(e.target.value);
            document.getElementById('brush-size').innerText = brushSize;
            canvas.freeDrawingBrush.width = brushSize;
        });
    }

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

    canvas.on('mouse:down', (opt) => {
        if (['line', 'rect', 'circle'].includes(currentTool)) {
            isDrawingShape = true;
            const pointer = canvas.getPointer(opt.e);
            startX = pointer.x;
            startY = pointer.y;
            
            if (currentTool === 'line') {
                shape = new fabric.Line([startX, startY, startX, startY], {
                    stroke: currentColor, strokeWidth: brushSize, selectable: false
                });
            } else if (currentTool === 'rect') {
                shape = new fabric.Rect({
                    left: startX, top: startY, width: 0, height: 0,
                    stroke: currentColor, strokeWidth: brushSize, fill: 'transparent', selectable: false
                });
            } else if (currentTool === 'circle') {
                shape = new fabric.Circle({
                    left: startX, top: startY, radius: 0,
                    stroke: currentColor, strokeWidth: brushSize, fill: 'transparent', selectable: false
                });
            }
            canvas.add(shape);
        } else if (currentTool === 'text') {
            const pointer = canvas.getPointer(opt.e);
            const text = new fabric.IText('Текст', {
                left: pointer.x, top: pointer.y, fontSize: 20, fill: currentColor
            });
            canvas.add(text);
            text.enterEditing();
        } else if (currentTool === 'eraser') {
            const target = canvas.findTarget(opt.e);
            if (target) {
                canvas.remove(target);
                sendCanvasState();
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
            sendCanvasState();
            shape = null;
        }
        isDrawingShape = false;
    });

    canvas.on('path:created', (e) => {
        e.path.set({ id: 'obj-' + Date.now() });
        sendCanvasState();
    });

    canvas.on('object:modified', () => sendCanvasState());
    canvas.on('object:removed', () => sendCanvasState());

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
                        const scale = (canvas.width * 0.5) / img.width;
                        img.scale(scale);
                        img.set({ 
                            id: 'img-' + Date.now(),
                            left: (canvas.width - img.width * scale) / 2,
                            top: (canvas.height - img.height * scale) / 2
                        });
                        canvas.add(img);
                        sendCanvasState();
                    });
                };
                reader.readAsDataURL(file);
            }
        };
        input.click();
    });

    document.getElementById('tool-clear')?.addEventListener('click', () => {
        if (confirm('Очистить всё?')) {
            canvas.clear();
            canvas.backgroundColor = 'white';
            socket.emit('clear-room', roomId);
            sendCanvasState();
        }
    });
    document.getElementById('clear-btn')?.addEventListener('click', () => {
        canvas.clear();
        canvas.backgroundColor = 'white';
        socket.emit('clear-room', roomId);
        document.getElementById('properties-panel')?.classList.remove('active');
        sendCanvasState();
    });

    document.getElementById('tool-save')?.addEventListener('click', () => {
        const link = document.createElement('a');
        link.download = `board-${roomId}.png`;
        link.href = canvas.toDataURL();
        link.click();
    });

    function copyToClipboard(text, msg) {
        if (navigator.clipboard) {
            navigator.clipboard.writeText(text).then(() => showNotification(msg));
        } else {
            prompt('Скопируйте вручную:', text);
        }
    }

    const copyIdBtn = document.getElementById('copy-room-id');
    if (copyIdBtn) {
        copyIdBtn.addEventListener('click', () => copyToClipboard(roomId, 'ID скопирован'));
    }

    const copyLinkBtn = document.getElementById('copy-student-link');
    if (copyLinkBtn) {
        copyLinkBtn.addEventListener('click', () => {
            const url = `${window.location.origin}/student.html?room=${encodeURIComponent(roomId)}&name=Ученик`;
            copyToClipboard(url, 'Ссылка для ученика скопирована');
        });
    }

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

    // 👇 ПОЛУЧАЕМ РИСУНКИ ОТ УЧЕНИКА И ОБНОВЛЯЕМ СВОЙ ХОЛСТ
    socket.on('draw-to-client', (obj) => {
        fabric.util.enlivenObjects([obj], (objects) => {
            const objToAdd = objects[0];
            const existing = canvas.getObjects().find(o => o.id === obj.id);
            if (existing) canvas.remove(existing);
            canvas.add(objToAdd);
            canvas.renderAll();
            // ОТПРАВЛЯЕМ ОБНОВЛЁННОЕ СОСТОЯНИЕ ВСЕМ (включая других учеников)
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

    if (typeof initWebRTC === 'function') {
        initWebRTC(socket, roomId, 'tutor');
    }

    const propsPanel = document.getElementById('properties-panel');
    if (propsPanel && typeof makeDraggable === 'function') {
        const handle = propsPanel.querySelector('.panel-header');
        if (handle && !propsPanel.dataset.draggable) {
            makeDraggable(propsPanel, handle);
            propsPanel.dataset.draggable = 'true';
        }
    }

    const exitBtn = document.getElementById('tool-exit');
    if (exitBtn) {
        exitBtn.addEventListener('click', () => {
            if (typeof stopVideoCall === 'function' && window.isVideoActive) {
                stopVideoCall();
            }
        });
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