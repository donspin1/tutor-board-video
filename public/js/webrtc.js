let localStream = null;
let peerConnections = {};
let isCameraActive = false;
let webrtcInitialized = false;

// ---------- 1. ИНИЦИАЛИЗАЦИЯ ----------
async function initWebRTC(socket, roomId, role) {
    if (webrtcInitialized) return;
    webrtcInitialized = true;
    window.socket = socket; 
    window.role = role;

    try {
        // Запрашиваем всё сразу, но видео-трек сразу выключаем
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        
        // Сразу выключаем камеру программно (чтобы горел индикатор, но видео не шло)
        localStream.getVideoTracks().forEach(track => track.enabled = false);
        isCameraActive = false;

        document.getElementById('video-panel').style.display = 'flex';
        
        // Себя рисуем один раз под ID local
        addVideoElement('local', localStream, true);
        
        updateMicUI(true); 
        updateCamUI(false);
    } catch (err) {
        console.error('Ошибка медиа:', err);
        // Если камеры нет совсем, пробуем только микрофон
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(e => null);
    }

    socket.emit('join-video-room', { roomId, peerId: socket.id, role });

    socket.on('user-joined', ({ peerId }) => {
        if (peerId === socket.id) return;
        createPeerConnection(peerId);
    });

    socket.on('receive-offer', async ({ from, offer }) => {
        const pc = createPeerConnection(from);
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('send-answer', { toPeerId: from, answer });
    });

    socket.on('receive-answer', async ({ from, answer }) => {
        const pc = peerConnections[from];
        if (pc) await pc.setRemoteDescription(new RTCSessionDescription(answer));
    });

    socket.on('receive-ice-candidate', ({ from, candidate }) => {
        const pc = peerConnections[from];
        if (pc) pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
    });

    socket.on('user-left', (peerId) => {
        removeVideoElement(peerId);
        if (peerConnections[peerId]) {
            peerConnections[peerId].close();
            delete peerConnections[peerId];
        }
    });

    setupButtons(); 
}

// ---------- 2. СОЕДИНЕНИЕ ----------
function createPeerConnection(peerId) {
    if (peerConnections[peerId]) return peerConnections[peerId];

    const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    peerConnections[peerId] = pc;

    if (localStream) {
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }

    pc.ontrack = (e) => {
        addVideoElement(peerId, e.streams[0], false);
    };

    pc.onicecandidate = (e) => {
        if (e.candidate) {
            window.socket.emit('send-ice-candidate', { toPeerId: peerId, candidate: e.candidate });
        }
    };

    return pc;
}

// ---------- 3. УПРАВЛЕНИЕ (БЕЗ ПЕРЕЗАГРУЗКИ ТРЕКОВ) ----------
function toggleCamera() {
    if (!localStream) return;
    const videoTrack = localStream.getVideoTracks()[0];
    
    if (videoTrack) {
        isCameraActive = !isCameraActive;
        videoTrack.enabled = isCameraActive; // Просто включаем/выключаем передачу данных
        
        const localVideo = document.querySelector(`#container-local video`);
        if (localVideo) {
            // Если выключили — убираем картинку, если включили — возвращаем поток
            localVideo.srcObject = isCameraActive ? localStream : null;
        }
        
        updateCamUI(isCameraActive);
    } else {
        alert("Камера не найдена");
    }
}

function toggleMic() {
    if (!localStream) return;
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        updateMicUI(audioTrack.enabled);
    }
}

// ---------- 4. ОТРИСОВКА ----------
function addVideoElement(peerId, stream, isLocal = false) {
    const grid = document.getElementById('video-grid');
    if (!grid) return;
    if (!isLocal && peerId === window.socket.id) return;

    let container = document.getElementById(`container-${peerId}`);
    if (!container) {
        container = document.createElement('div');
        container.className = 'video-container';
        container.id = `container-${peerId}`;

        const video = document.createElement('video');
        video.autoplay = true;
        video.playsInline = true;
        if (isLocal) video.muted = true;

        const label = document.createElement('span');
        label.className = 'video-label';
        label.textContent = isLocal ? 'Вы' : (window.role === 'tutor' ? 'Ученик' : 'Репетитор');

        container.appendChild(video);
        container.appendChild(label);
        grid.appendChild(container);
    }

    const videoEl = container.querySelector('video');
    if (videoEl.srcObject !== stream) {
        videoEl.srcObject = stream;
    }
}

function removeVideoElement(peerId) {
    document.getElementById(`container-${peerId}`)?.remove();
}

// ---------- 5. КНОПКИ ----------
function setupButtons() {
    document.getElementById('call-mic').onclick = toggleMic;
    document.getElementById('call-cam').onclick = toggleCamera;
    
    const leave = () => { window.location.href = '/'; };
    if (document.getElementById('call-end')) document.getElementById('call-end').onclick = leave;
    if (document.getElementById('exit-btn')) document.getElementById('exit-btn').onclick = leave;

    const screenBtn = document.getElementById('call-screen');
    if (screenBtn) {
        screenBtn.onclick = async () => {
            try {
                const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
                const screenTrack = screenStream.getVideoTracks()[0];
                for (let pc of Object.values(peerConnections)) {
                    const sender = pc.getSenders().find(s => s.track?.kind === 'video');
                    if (sender) sender.replaceTrack(screenTrack);
                }
                screenTrack.onended = () => {
                    // Возвращаем камеру (даже если она выключена, вернется "черный" трек)
                    const videoTrack = localStream.getVideoTracks()[0];
                    for (let pc of Object.values(peerConnections)) {
                        const sender = pc.getSenders().find(s => s.track?.kind === 'video');
                        if (sender) sender.replaceTrack(videoTrack);
                    }
                };
            } catch (e) { console.error(e); }
        };
    }
}

function updateMicUI(enabled) {
    const btn = document.getElementById('call-mic');
    if (btn) btn.innerHTML = enabled ? '<i class="fas fa-microphone"></i>' : '<i class="fas fa-microphone-slash"></i>';
}

function updateCamUI(enabled) {
    const btn = document.getElementById('call-cam');
    if (btn) btn.innerHTML = enabled ? '<i class="fas fa-video"></i>' : '<i class="fas fa-video-slash"></i>';
}