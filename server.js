const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const publicPath = path.join(__dirname, "../public");

app.use(express.static(publicPath));

/* ✅ Главная страница */
app.get("/", (req, res) => {
  res.sendFile(path.join(publicPath, "index.html"));
});

/* ✅ Комнаты */
app.get("/room/:id", (req, res) => {
  res.sendFile(path.join(publicPath, "room.html"));
});

/* ✅ Socket */
io.on("connection", (socket) => {
  socket.on("join-room", (roomId) => {
    socket.join(roomId);

    socket.on("draw", (data) => {
      socket.to(roomId).emit("draw", data);
    });

    socket.on("clear", () => {
      io.to(roomId).emit("clear");
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
