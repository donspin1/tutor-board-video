export function initBoard(socket, roomId, isTutor){

    const VIRTUAL_WIDTH = 1400;
    const VIRTUAL_HEIGHT = 900;

    const canvas = new fabric.Canvas("canvas", {
        selection: isTutor
    });

    canvas.setWidth(VIRTUAL_WIDTH);
    canvas.setHeight(VIRTUAL_HEIGHT);

    function resize(){
        const container = document.querySelector(".board-section");
        const scale = Math.min(
            container.clientWidth / VIRTUAL_WIDTH,
            container.clientHeight / VIRTUAL_HEIGHT
        );
        canvas.setZoom(scale);
        canvas.setWidth(VIRTUAL_WIDTH * scale);
        canvas.setHeight(VIRTUAL_HEIGHT * scale);
    }

    window.addEventListener("resize", resize);
    setTimeout(resize,100);

    if(isTutor){

        function sync(){
            socket.emit("canvas-update", {
                roomId,
                canvas: canvas.toJSON()
            });
        }

        canvas.on("object:added", sync);
        canvas.on("object:modified", sync);
        canvas.on("object:removed", sync);
        canvas.isDrawingMode = true;
    }

    socket.on("canvas-update", (data)=>{
        canvas.loadFromJSON(data, ()=>{
            canvas.renderAll();
        });
    });

    socket.on("init-canvas", (data)=>{
        if(data){
            canvas.loadFromJSON(data, ()=>{
                canvas.renderAll();
            });
        }
    });

}
