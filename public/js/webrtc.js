let localStream = null;
let peerConnections = {};
let isVideoActive = false;
let permissionsGranted = false;

// Запрос разрешений при загрузке
async function requestMediaPermissions() {
    try {
        const tempStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        tempStream.getTracks().forEach(track => track.stop());
        permissionsGranted = true;
        console.log('✅ Разрешения на камеру/микрофон получены');
    } catch (err) {
        console.warn('❌ Не удалось получить разрешения:', err);
        permissionsGranted = false;
    }
}
requestMediaPermissions();

function initWebRTC(socket, roomId, role) {
    // Сохраняем в глобальные переменные, чтобы они были доступны во всех функциях
    window.socket = socket;
    window.roomId = roomId;
    window.role = role;

    const videoBtn = document.getElementById('tool-video');
    if (videoBtn) {
        videoBtn.addEventListener('click', toggleVideoCall);
    }

    const toggleMic = document.getElementById('toggle-mic');
    if (toggleMic) {
        toggleMic.addEventListener('click', toggleMicrophone);
        toggleMic.classList.add('active');
    }
    
    const toggleCam = document.getElementById('toggle-cam');
    if (toggleCam) {
        toggleCam.addEventListener('click', toggleCamera);
        toggleCam.classList.add('active');
    }
    
    const endCallBtn = document.getElementById('end-call');
    if (endCallBtn) endCallBtn.addEventListener('click', stopVideoCall);
    
    const toggleScreen = document.getElementById('toggle-screen');
    if (toggleScreen && role === 'tutor') {
        toggleScreen.addEventListener('click', startScreenShare);
    }

    setupSocketListeners(socket);
}

async function toggleVideoCall() {
    if (!isVideoActive) {
        await startVideoCall();
    } else {
        stopVideoCall();
    }
}

async function startVideoCall() {
    try {
        if (!localStream) {
            localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        }
        isVideoActive = true;
        const panel = document.getElementById('video-panel');
        if (panel) panel.style.display = 'flex';
        
        addVideoElement(window.socket.id, localStream, true);
        
        window.socket.emit('join-video-room', { 
            roomId: window.roomId, 
            peerId: window.socket.id, 
            role: window.role 
        });
    } catch (err) {
        alert('Не удалось получить доступ к камере/микрофону');
        console.error(err);
    }
}

function stopVideoCall() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    Object.values(peerConnections).forEach(pc => pc.close());
    peerConnections = {};
    const grid = document.getElementById('video-grid');
    if (grid) grid.innerHTML = '';
    const panel = document.getElementById('video-panel');
    if (panel) panel.style.display = 'none';
    isVideoActive = false;
    window.socket.emit('leave-video-room', { 
        roomId: window.roomId, 
        peerId: window.socket.id 
    });
    
    const micBtn = document.getElementById('toggle-mic');
    const camBtn = document.getElementById('toggle-cam');
    if (micBtn) micBtn.classList.add('active');
    if (camBtn) camBtn.classList.add('active');
}

function addVideoElement(peerId, stream, isLocal = false) {
    const grid = document.getElementById('video-grid');
    if (!grid) return;
    
    const existing = document.getElementById(`video-${peerId}`);
    if (existing) existing.remove();
    
    const container = document.createElement('div');
    container.className = 'video-container';
    container.id = `video-${peerId}`;
    
    const video = document.createElement('video');
    video.srcObject = stream;
    video.autoplay = true;
    video.playsInline = true;
    if (isLocal) video.muted = true;
    
    const label = document.createElement('span');
    label.className = 'video-label';
    label.textContent = isLocal 
        ? `Вы (${window.role})` 
        : (window.role === 'tutor' ? 'Ученик' : 'Репетитор');
    
    container.appendChild(video);
    container.appendChild(label);
    grid.appendChild(container);
}

function removeVideoElement(peerId) {
    const el = document.getElementById(`video-${peerId}`);
    if (el) el.remove();
}

function toggleMicrophone() {
    if (!localStream) {
        startVideoCall().then(() => {
            setTimeout(() => {
                const audioTrack = localStream?.getAudioTracks()[0];
                if (audioTrack) {
                    audioTrack.enabled = !audioTrack.enabled;
                    updateMicButton(audioTrack.enabled);
                    window.socket.emit('video-toggle', { 
                        roomId: window.roomId, 
                        userId: window.socket.id, 
                        kind: 'audio', 
                        enabled: audioTrack.enabled 
                    });
                }
            }, 500);
        });
        return;
    }
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        updateMicButton(audioTrack.enabled);
        window.socket.emit('video-toggle', { 
            roomId: window.roomId, 
            userId: window.socket.id, 
            kind: 'audio', 
            enabled: audioTrack.enabled 
        });
    }
}

function updateMicButton(enabled) {
    const btn = document.getElementById('toggle-mic');
    if (btn) {
        btn.innerHTML = enabled ? '<i class="fas fa-microphone"></i>' : '<i class="fas fa-microphone-slash"></i>';
        if (enabled) btn.classList.add('active');
        else btn.classList.remove('active');
    }
}

function toggleCamera() {
    if (!localStream) {
        startVideoCall().then(() => {
            setTimeout(() => {
                const videoTrack = localStream?.getVideoTracks()[0];
                if (videoTrack) {
                    videoTrack.enabled = !videoTrack.enabled;
                    updateCamButton(videoTrack.enabled);
                    window.socket.emit('video-toggle', { 
                        roomId: window.roomId, 
                        userId: window.socket.id, 
                        kind: 'video', 
                        enabled: videoTrack.enabled 
                    });
                }
            }, 500);
        });
        return;
    }
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        updateCamButton(videoTrack.enabled);
        window.socket.emit('video-toggle', { 
            roomId: window.roomId, 
            userId: window.socket.id, 
            kind: 'video', 
            enabled: videoTrack.enabled 
        });
    }
}

function updateCamButton(enabled) {
    const btn = document.getElementById('toggle-cam');
    if (btn) {
        btn.innerHTML = enabled ? '<i class="fas fa-video"></i>' : '<i class="fas fa-video-slash"></i>';
        if (enabled) btn.classList.add('active');
        else btn.classList.remove('active');
    }
}

async function startScreenShare() {
    try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const videoTrack = screenStream.getVideoTracks()[0];
        videoTrack.onended = () => {
            navigator.mediaDevices.getUserMedia({ video: true }).then(stream => {
                const newTrack = stream.getVideoTracks()[0];
                replaceVideoTrack(newTrack);
                updateCamButton(true);
            });
        };
        replaceVideoTrack(videoTrack);
        updateCamButton(true);
    } catch (err) {
        console.error('Ошибка демонстрации экрана:', err);
    }
}

function replaceVideoTrack(newTrack) {
    Object.values(peerConnections).forEach(pc => {
        const sender = pc.getSenders().find(s => s.track?.kind === 'video');
        if (sender) sender.replaceTrack(newTrack);
    });
    if (localStream) {
        const oldTrack = localStream.getVideoTracks()[0];
        if (oldTrack) {
            localStream.removeTrack(oldTrack);
            oldTrack.stop();
        }
        localStream.addTrack(newTrack);
        const localVideo = document.querySelector(`#video-${window.socket.id} video`);
        if (localVideo) localVideo.srcObject = localStream;
    }
}

function setupSocketListeners(socket) {
    socket.on('user-joined', async ({ peerId, role }) => {
        console.log('user joined', peerId, role);
        const pc = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });
        peerConnections[peerId] = pc;
        
        if (localStream) {
            localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
        }
        
        pc.onicecandidate = (e) => {
            if (e.candidate) {
                socket.emit('send-ice-candidate', { toPeerId: peerId, candidate: e.candidate });
            }
        };
        
        pc.ontrack = (e) => {
            if (!document.getElementById(`video-${peerId}`)) {
                addVideoElement(peerId, e.streams[0], false);
            }
        };
        
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('send-offer', { toPeerId: peerId, offer });
    });

    socket.on('receive-offer', async ({ from, offer }) => {
        const pc = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });
        peerConnections[from] = pc;
        
        if (localStream) {
            localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
        }
        
        pc.onicecandidate = (e) => {
            if (e.candidate) {
                socket.emit('send-ice-candidate', { toPeerId: from, candidate: e.candidate });
            }
        };
        
        pc.ontrack = (e) => {
            if (!document.getElementById(`video-${from}`)) {
                addVideoElement(from, e.streams[0], false);
            }
        };
        
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('send-answer', { toPeerId: from, answer });
    });

    socket.on('receive-answer', ({ from, answer }) => {
        if (peerConnections[from]) {
            peerConnections[from].setRemoteDescription(new RTCSessionDescription(answer));
        }
    });

    socket.on('receive-ice-candidate', ({ from, candidate }) => {
        if (peerConnections[from]) {
            peerConnections[from].addIceCandidate(new RTCIceCandidate(candidate));
        }
    });

    socket.on('user-left', (peerId) => {
        if (peerConnections[peerId]) {
            peerConnections[peerId].close();
            delete peerConnections[peerId];
        }
        removeVideoElement(peerId);
    });

    socket.on('peer-video-toggle', ({ userId, kind, enabled }) => {
        console.log(`Peer ${userId} ${kind} enabled: ${enabled}`);
    });
}