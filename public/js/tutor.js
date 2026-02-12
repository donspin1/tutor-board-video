document.addEventListener('DOMContentLoaded', () => {
    const socket = io();
    const urlParams = new URLSearchParams(window.location.search);
    const roomId = urlParams.get('room');
    const VIRTUAL_WIDTH = 1600;
    const VIRTUAL_HEIGHT = 900;

    if (!roomId) {
        window.location.href = '/tutor-login.html';
        return;
    }

    const canvas = new fabric.Canvas('canvas', {
        backgroundColor: 'white',
        width: VIRTUAL_WIDTH,
        height: VIRTUAL_HEIGHT
    });

    // Исправленное масштабирование
    function resizeCanvas() {
        const container = document.querySelector('.canvas-area');
        if (!container) return;

        const scale = Math.min(
            container.clientWidth / VIRTUAL_WIDTH,
            container.clientHeight / VIRTUAL_HEIGHT
        );

        canvas.setZoom(scale);
        canvas.setWidth(VIRTUAL_WIDTH * scale);
        canvas.setHeight(VIRTUAL_HEIGHT * scale);
        canvas.renderAll();
    }

    window.addEventListener('resize', resizeCanvas);
    setTimeout(resizeCanvas, 100);

    // Настройки кисти
    canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
    canvas.freeDrawingBrush.width = 5;
    canvas.freeDrawingBrush.color = '#000000';
    canvas.isDrawingMode = true;

    // Синхронизация: отправляем JSON целиком для точности
    function sendCanvasState() {
        const json = canvas.toJSON(['id']);
        // Добавляем метаданные о размере
        json.vWidth = VIRTUAL_WIDTH;
        json.vHeight = VIRTUAL_HEIGHT;
        socket.emit('canvas-state', { roomId, canvasJson: json });
    }

    // События для отправки
    let sendTimeout;
    canvas.on('object:modified', () => {
        clearTimeout(sendTimeout);
        sendTimeout = setTimeout(sendCanvasState, 300);
    });
    
    canvas.on('path:created', sendCanvasState);
    canvas.on('object:added', (e) => {
        if (e.target.type !== 'path') sendCanvasState();
    });

    // Инициализация комнаты
    socket.emit('join-room', roomId, 'tutor');

    socket.on('init-canvas', (data) => {
        if (data.canvasJson && data.canvasJson.objects.length > 0) {
            canvas.loadFromJSON(data.canvasJson, () => {
                resizeCanvas();
                canvas.renderAll();
            });
        }
    });

    // Обработка инструментов (базовая логика)
    document.querySelectorAll('.tool-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelector('.tool-btn.active')?.classList.remove('active');
            btn.classList.add('active');
            const tool = btn.id.replace('tool-', '');
            
            canvas.isDrawingMode = (tool === 'pencil');
            if (tool === 'eraser') {
                canvas.isDrawingMode = false;
                // Простая реализация удаления кликом
                canvas.on('mouse:down', function(opt) {
                    if (opt.target) {
                        canvas.remove(opt.target);
                        sendCanvasState();
                    }
                });
            } else {
                canvas.off('mouse:down');
            }
        });
    });

    document.getElementById('clear-btn')?.addEventListener('click', () => {
        canvas.clear();
        canvas.backgroundColor = 'white';
        sendCanvasState();
    });
});