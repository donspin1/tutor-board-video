const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/index.html"));
});

app.get("/room/:roomId", (req, res) => {
  res.sendFile(path.join(__dirname, "public/room.html"));
});

io.on("connection", socket => {

  socket.on("join-room", roomId => {
    socket.join(roomId);

    const clients = [...io.sockets.adapter.rooms.get(roomId) || []];
    socket.emit("existing-users", clients.filter(id => id !== socket.id));

    socket.to(roomId).emit("user-joined", socket.id);

    socket.on("signal", data => {
      io.to(data.to).emit("signal", {
        from: socket.id,
        signal: data.signal
      });
    });

    socket.on("draw", data => {
      socket.to(roomId).emit("draw", data);
    });

    socket.on("clear-board", () => {
      socket.to(roomId).emit("clear-board");
    });

    socket.on("disconnect", () => {
      socket.to(roomId).emit("user-left", socket.id);
    });
  });

});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
