// webrtc.js — ПОЛНАЯ ВЕРСИЯ
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

    console.log(`📹 WebRTC запуск: ${role}`);

    try {
        // Шаг 1: Получаем микрофон
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        
        // Показываем сетку
        const panel = document.getElementById('video-panel');
        if (panel) panel.style.display = 'flex';
        
        // Отрисовываем себя под ID 'local'. Это исключает дубликаты "себя".
        addVideoElement('local', localStream, true);
        
        updateMicUI(true); 
    } catch (err) {
        console.error('Ошибка при получении микрофона:', err);
    }

    // Шаг 2: Входим в комнату
    socket.emit('join-video-room', { roomId, peerId: socket.id, role });

    // --- ОБРАБОТЧИКИ СОБЫТИЙ СОКЕТА ---
    socket.on('user-joined', ({ peerId }) => {
        if (peerId === socket.id) return;
        console.log("👤 Новый участник:", peerId);
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

// ---------- 2. СОЗДАНИЕ PEER CONNECTION ----------
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
        console.log("🎯 Получен поток от партнера:", peerId);
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

// ---------- 3. УПРАВЛЕНИЕ КАМЕРОЙ И МИКРОФОНОМ ----------
async function toggleCamera() {
    try {
        if (!isCameraActive) {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            const videoTrack = stream.getVideoTracks()[0];
            
            if (localStream) {
                localStream.getVideoTracks().forEach(t => { t.stop(); localStream.removeTrack(t); });
                localStream.addTrack(videoTrack);
            }

            for (let pc of Object.values(peerConnections)) {
                const sender = pc.getSenders().find(s => s.track?.kind === 'video');
                if (sender) sender.replaceTrack(videoTrack);
                else pc.addTrack(videoTrack, localStream);
            }
            isCameraActive = true;
        } else {
            localStream.getVideoTracks().forEach(t => { t.stop(); localStream.removeTrack(t); });
            for (let pc of Object.values(peerConnections)) {
                const sender = pc.getSenders().find(s => s.track?.kind === 'video');
                if (sender) sender.replaceTrack(null);
            }
            isCameraActive = false;
        }
        updateCamUI(isCameraActive);
        // Важно: обновляем именно 'local'
        addVideoElement('local', localStream, true);
    } catch (err) { alert("Не удалось запустить камеру"); }
}

function toggleMic() {
    if (!localStream) return;
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        updateMicUI(audioTrack.enabled);
    }
}

// ---------- 4. ОТРИСОВКА ВИДЕО (ЗАЩИТА ОТ ДУБЛЕЙ) ----------
function addVideoElement(peerId, stream, isLocal = false) {
    const grid = document.getElementById('video-grid');
    if (!grid) return;

    // Если это НЕ локальный вызов, но пришел ID нашего же сокета — игнорируем, 
    // так как мы уже отрисованы под ID 'local'
    if (!isLocal && peerId === window.socket.id) return;

    let container = document.getElementById(`container-${peerId}`);
    
    if (!container) {
        container = document.createElement('div');
        container.className = 'video-container';
        container.id = `container-${peerId}`;

        const video = document.createElement('video');
        video.autoplay = true;
        video.playsInline = true;
        if (isLocal) video.muted = true; // Себя не слушаем

        const label = document.createElement('span');
        label.className = 'video-label';
        label.textContent = isLocal ? 'Вы' : (window.role === 'tutor' ? 'Ученик' : 'Репетитор');

        container.appendChild(video);
        container.appendChild(label);
        grid.appendChild(container);
    }

    const videoEl = container.querySelector('video');
    if (videoEl && videoEl.srcObject !== stream) {
        videoEl.srcObject = stream;
    }
}

function removeVideoElement(peerId) {
    document.getElementById(`container-${peerId}`)?.remove();
}

// ---------- 5. КНОПКИ УПРАВЛЕНИЯ ----------
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

    // Демонстрация экрана (Screen Sharing)
    const screenBtn = document.getElementById('call-screen');
    if (screenBtn) {
        screenBtn.onclick = async () => {
            try {
                const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
                const screenTrack = screenStream.getVideoTracks()[0];
                
                for (let pc of Object.values(peerConnections)) {
                    const sender = pc.getSenders().find(s => s.track?.kind === 'video');
                    if (sender) sender.replaceTrack(screenTrack);
                    else pc.addTrack(screenTrack, localStream);
                }
                
                // Когда пользователь нажмет "Прекратить доступ" в браузере
                screenTrack.onended = () => {
                    isCameraActive = false;
                    toggleCamera(); // Возвращаемся к камере
                };
            } catch (e) { console.error("Ошибка шаринга экрана:", e); }
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