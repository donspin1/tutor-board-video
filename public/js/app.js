import { initBoard } from "./board.js";
import { initWebRTC } from "./webrtc.js";

const socket = io();
const url = new URLSearchParams(window.location.search);
const roomId = url.get("room");
const role = window.location.pathname.includes("tutor");

socket.emit("join-room", {
    roomId,
    role: role ? "tutor" : "student"
});

initBoard(socket, roomId, role);
initWebRTC(socket);
