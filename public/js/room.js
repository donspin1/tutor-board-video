const socket = io();

const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");

const colorPicker = document.getElementById("colorPicker");
const brushSizeInput = document.getElementById("brushSize");
const eraserBtn = document.getElementById("eraserBtn");
const clearBtn = document.getElementById("clearBtn");

let currentColor = "#000000";
let brushSize = 3;
let isDrawing = false;
let isEraser = false;

const roomId = window.location.pathname.split("/")[2];
socket.emit("join-room", roomId);

function resizeCanvas() {
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
}
resizeCanvas();
window.addEventListener("resize", resizeCanvas);

colorPicker.addEventListener("input", (e) => {
  currentColor = e.target.value;
  isEraser = false;
});

brushSizeInput.addEventListener("input", (e) => {
  brushSize = e.target.value;
});

eraserBtn.addEventListener("click", () => {
  isEraser = true;
});

clearBtn.addEventListener("click", () => {
  socket.emit("clear");
});

canvas.addEventListener("mousedown", () => isDrawing = true);
canvas.addEventListener("mouseup", () => {
  isDrawing = false;
  ctx.beginPath();
});
canvas.addEventListener("mouseout", () => {
  isDrawing = false;
  ctx.beginPath();
});

canvas.addEventListener("mousemove", draw);

function draw(e) {
  if (!isDrawing) return;

  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  const data = {
    x,
    y,
    color: isEraser ? "#FFFFFF" : currentColor,
    size: brushSize
  };

  drawOnCanvas(data);
  socket.emit("draw", data);
}

function drawOnCanvas(data) {
  ctx.lineWidth = data.size;
  ctx.lineCap = "round";
  ctx.strokeStyle = data.color;

  ctx.lineTo(data.x, data.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(data.x, data.y);
}

socket.on("draw", (data) => {
  drawOnCanvas(data);
});

socket.on("clear", () => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
});

/* 🎥 Camera */
const video = document.getElementById("localVideo");

navigator.mediaDevices.getUserMedia({ video: true, audio: false })
  .then(stream => {
    video.srcObject = stream;
  })
  .catch(err => {
    console.log("Camera error:", err);
  });
