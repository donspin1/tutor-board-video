document.addEventListener('DOMContentLoaded', () => {
    const socket = io();
    const urlParams = new URLSearchParams(window.location.search);
    const roomId = urlParams.get('room');
    const VIRTUAL_WIDTH = 1600;
    const VIRTUAL_HEIGHT = 900;

    if (!roomId) return;

    const canvas = new fabric.Canvas('canvas', {
        backgroundColor: 'white',
        selection: false,
        width: VIRTUAL_WIDTH,
        height: VIRTUAL_HEIGHT
    });

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

    // Принимаем состояние от репетитора
    socket.on('canvas-state', (data) => {
        if (data.canvasJson) {
            // Загружаем JSON "как есть" в виртуальном размере
            canvas.loadFromJSON(data.canvasJson, () => {
                resizeCanvas(); // Применяем текущий зум под экран ученика
                canvas.renderAll();
            });
        }
    });

    socket.on('init-canvas', (data) => {
        if (data.canvasJson) {
            canvas.loadFromJSON(data.canvasJson, () => {
                resizeCanvas();
                canvas.renderAll();
            });
        }
    });

    socket.emit('join-room', roomId, 'student');
});