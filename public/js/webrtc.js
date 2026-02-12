export function initWebRTC(socket){

    const peers = {};
    const localVideo = document.getElementById("localVideo");
    const videoSection = document.getElementById("videos");

    navigator.mediaDevices.getUserMedia({video:true,audio:true})
        .then(stream=>{
            localVideo.srcObject = stream;

            socket.on("user-joined", id=>{
                createPeer(id, stream, true);
            });

            socket.on("signal", async ({from,data})=>{
                if(!peers[from]){
                    createPeer(from, stream, false);
                }
                await peers[from].signal(data);
            });

        });

    function createPeer(id, stream, initiator){

        const peer = new SimplePeer({
            initiator,
            trickle:false,
            stream
        });

        peer.on("signal", data=>{
            socket.emit("signal", {to:id,data});
        });

        peer.on("stream", remoteStream=>{
            const video = document.createElement("video");
            video.srcObject = remoteStream;
            video.autoplay = true;
            videoSection.appendChild(video);
        });

        peers[id] = peer;
    }

}
