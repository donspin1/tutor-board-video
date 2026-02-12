// webrtc.js — ФИНАЛЬНАЯ СБОРКА (БЕЗ ДУБЛЕЙ И ЗАВИСАНИЙ)
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

    console.log(`📹 WebRTC старт: ${role}`);

    try {
        // Шаг 1: Запрашиваем только аудио при входе
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        
        const panel = document.getElementById('video-panel');
        if (panel) panel.style.display = 'flex';
        
        // Отрисовываем себя (ID 'local' гарантирует отсутствие дублей себя)
        addVideoElement('local', localStream, true);
        updateMicUI(true); 
    } catch (err) {
        console.error('Ошибка доступа к микрофону:', err);
    }

    // Шаг 2: Сигнализируем серверу о готовности
    socket.emit('join-video-room', { roomId, peerId: socket.id, role });

    // Обработка событий сети
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

// ---------- 2. УПРАВЛЕНИЕ СОЕДИНЕНИЕМ ----------
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
        console.log("🎯 Получен поток от партнера");
        addVideoElement(peerId, e.streams[0], false);
    };

    pc.onicecandidate = (e) => {
        if (e.candidate) {
            window.socket.emit('send-ice-candidate', { toPeerId: peerId, candidate: e.candidate });
        }
    };

    pc.onnegotiationneeded = async () => {
        try {
            if (pc.signalingState !== 'stable') return;
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            window.socket.emit('send-offer', { toPeerId: peerId, offer });
        } catch (err) { console.error(err); }
    };

    return pc;
}

// ---------- 3. КАМЕРА И МИКРОФОН (ИСПРАВЛЕНИЕ ЗАВИСАНИЯ) ----------
async function toggleCamera() {
    try {
        if (!isCameraActive) {
            // ВКЛЮЧЕНИЕ
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            const videoTrack = stream.getVideoTracks()[0];
            
            if (localStream) {
                // Удаляем старые видео-треки если они были
                localStream.getVideoTracks().forEach(t => { t.stop(); localStream.removeTrack(t); });
                localStream.addTrack(videoTrack);
            }

            for (let pc of Object.values(peerConnections)) {
                const sender = pc.getSenders().find(s => s.track?.kind === 'video');
                if (sender) await sender.replaceTrack(videoTrack);
                else pc.addTrack(videoTrack, localStream);
            }
            isCameraActive = true;
            addVideoElement('local', localStream, true); // Обновляем превью
        } else {
            // ВЫКЛЮЧЕНИЕ
            localStream.getVideoTracks().forEach(t => { t.stop(); localStream.removeTrack(t); });
            
            for (let pc of Object.values(peerConnections)) {
                const sender = pc.getSenders().find(s => s.track?.kind === 'video');
                if (sender) await sender.replaceTrack(null);
            }
            isCameraActive = false;
            
            // Сбрасываем видео-плеер, чтобы не висел последний кадр
            const localVideo = document.querySelector(`#container-local video`);
            if (localVideo) localVideo.srcObject = null;
        }
        updateCamUI(isCameraActive);
    } catch (err) { 
        alert("Ошибка доступа к камере"); 
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

// ---------- 4. ОТРИСОВКА (ЛОГИКА БЕЗ ДУБЛЕЙ) ----------
function addVideoElement(peerId, stream, isLocal = false) {
    const grid = document.getElementById('video-grid');
    if (!grid) return;

    // Защита: не рисуем себя второй раз через socket.id
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
    // Если в потоке есть видео-треки — показываем, иначе — очищаем (фикс зависания у партнера)
    if (stream && stream.getVideoTracks().length > 0) {
        if (videoEl.srcObject !== stream) {
            videoEl.srcObject = stream;
        }
    } else {
        videoEl.srcObject = null;
    }
}

function removeVideoElement(peerId) {
    document.getElementById(`container-${peerId}`)?.remove();
}

// ---------- 5. КНОПКИ И UI ----------
function setupButtons() {
    const micBtn = document.getElementById('call-mic');
    if (micBtn) micBtn.onclick = toggleMic;

    const camBtn = document.getElementById('call-cam');
    if (camBtn) camBtn.onclick = toggleCamera;

    const endBtnTutor = document.getElementById('call-end');
    const endBtnStudent = document.getElementById('exit-btn');
    const leaveRoom = () => { window.location.href = '/'; };
    
    if (endBtnTutor) endBtnTutor.onclick = leaveRoom;
    if (endBtnStudent) endBtnStudent.onclick = leaveRoom;

    const screenBtn = document.getElementById('call-screen');
    if (screenBtn) {
        screenBtn.onclick = async () => {
            try {
                const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
                const screenTrack = screenStream.getVideoTracks()[0];
                for (let pc of Object.values(peerConnections)) {
                    const sender = pc.getSenders().find(s => s.track?.kind === 'video');
                    if (sender) await sender.replaceTrack(screenTrack);
                }
                addVideoElement('local', screenStream, true);
                screenTrack.onended = () => toggleCamera();
            } catch (e) { console.error(e); }
        };
    }
}

function updateMicUI(enabled) {
    const btn = document.getElementById('call-mic');
    if (!btn) return;
    btn.classList.toggle('active', enabled);
    btn.innerHTML = enabled ? '<i class="fas fa-microphone"></i>' : '<i class="fas fa-microphone-slash"></i>';
}

function updateCamUI(enabled) {
    const btn = document.getElementById('call-cam');
    if (!btn) return;
    btn.classList.toggle('active', enabled);
    btn.innerHTML = enabled ? '<i class="fas fa-video"></i>' : '<i class="fas fa-video-slash"></i>';
}