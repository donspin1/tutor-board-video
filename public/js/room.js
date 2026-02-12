const socket = io();
const roomId = window.location.pathname.split("/room/")[1];
document.getElementById("roomName").innerText = "Room: " + roomId;

socket.emit("join-room", roomId);

/* ===========================
   BOARD
=========================== */

const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");

function resize(){
  canvas.width = canvas.offsetWidth;
  canvas.height = canvas.offsetHeight;
}
resize();
window.addEventListener("resize", resize);

let drawing = false;
let lastX=0, lastY=0;

function drawLine(x1,y1,x2,y2,emit=true){
  ctx.beginPath();
  ctx.moveTo(x1,y1);
  ctx.lineTo(x2,y2);
  ctx.stroke();

  if(!emit) return;
  socket.emit("draw",{x1,y1,x2,y2});
}

canvas.addEventListener("mousedown",e=>{
  drawing=true;
  lastX=e.offsetX;
  lastY=e.offsetY;
});

canvas.addEventListener("mousemove",e=>{
  if(!drawing) return;
  drawLine(lastX,lastY,e.offsetX,e.offsetY,true);
  lastX=e.offsetX;
  lastY=e.offsetY;
});

canvas.addEventListener("mouseup",()=>drawing=false);
canvas.addEventListener("mouseleave",()=>drawing=false);

/* TOUCH */
canvas.addEventListener("touchstart",e=>{
  e.preventDefault();
  drawing=true;
  const rect=canvas.getBoundingClientRect();
  lastX=e.touches[0].clientX-rect.left;
  lastY=e.touches[0].clientY-rect.top;
});

canvas.addEventListener("touchmove",e=>{
  e.preventDefault();
  if(!drawing) return;
  const rect=canvas.getBoundingClientRect();
  const x=e.touches[0].clientX-rect.left;
  const y=e.touches[0].clientY-rect.top;
  drawLine(lastX,lastY,x,y,true);
  lastX=x;
  lastY=y;
});

canvas.addEventListener("touchend",()=>drawing=false);

socket.on("draw",data=>{
  drawLine(data.x1,data.y1,data.x2,data.y2,false);
});

document.getElementById("clearBtn").onclick=()=>{
  ctx.clearRect(0,0,canvas.width,canvas.height);
  socket.emit("clear-board");
};

socket.on("clear-board",()=>{
  ctx.clearRect(0,0,canvas.width,canvas.height);
});

/* ===========================
   WEBRTC
=========================== */

const localVideo = document.getElementById("localVideo");
const videos = document.getElementById("videos");
const peers = {};
let localStream;

navigator.mediaDevices.getUserMedia({video:true,audio:true})
.then(stream=>{
  localStream=stream;
  localVideo.srcObject=stream;
});

socket.on("existing-users",users=>{
  users.forEach(id=>createPeer(id,true));
});

socket.on("user-joined",id=>{
  createPeer(id,false);
});

socket.on("signal",async data=>{
  const peer=peers[data.from];
  if(data.signal.type==="offer"){
    await peer.setRemoteDescription(new RTCSessionDescription(data.signal));
    const answer=await peer.createAnswer();
    await peer.setLocalDescription(answer);
    socket.emit("signal",{to:data.from,signal:peer.localDescription});
  }else{
    await peer.setRemoteDescription(new RTCSessionDescription(data.signal));
  }
});

socket.on("user-left",id=>{
  if(peers[id]){
    peers[id].close();
    delete peers[id];
  }
});

function createPeer(id,initiator){
  const peer=new RTCPeerConnection({
    iceServers:[{urls:"stun:stun.l.google.com:19302"}]
  });

  localStream.getTracks().forEach(track=>{
    peer.addTrack(track,localStream);
  });

  peer.ontrack=e=>{
    let video=document.getElementById(id);
    if(!video){
      video=document.createElement("video");
      video.id=id;
      video.autoplay=true;
      video.playsInline=true;
      videos.appendChild(video);
    }
    video.srcObject=e.streams[0];
  };

  peer.onicecandidate=e=>{
    if(e.candidate){
      socket.emit("signal",{to:id,signal:e.candidate});
    }
  };

  peers[id]=peer;

  if(initiator){
    peer.createOffer().then(offer=>{
      peer.setLocalDescription(offer);
      socket.emit("signal",{to:id,signal:offer});
    });
  }

  return peer;
}
