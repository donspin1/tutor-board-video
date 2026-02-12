// webrtc.js — АДАПТИРОВАННАЯ ВЕРСИЯ
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

    // Шаг 1: Сначала получаем микрофон
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        
        // Показываем сетку и добавляем свое превью (оно будет черным, пока нет камеры)
        document.getElementById('video-panel').style.display = 'flex';
        addVideoElement(socket.id, localStream, true);
        
        updateMicUI(true); // Устанавливаем активный вид кнопке микрофона
    } catch (err) {
        console.error('Ошибка при получении микрофона:', err);
    }

    // Шаг 2: Входим в комнату после получения медиа
    socket.emit('join-video-room', { roomId, peerId: socket.id, role });

    // Слушаем события сокета
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

    setupButtons(); // Привязываем события к твоим кнопкам из HTML
}

// ---------- 2. СОЗДАНИЕ PEER CONNECTION ----------
function createPeerConnection(peerId) {
    if (peerConnections[peerId]) return peerConnections[peerId];

    const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    peerConnections[peerId] = pc;

    // Добавляем аудио-трек сразу
    if (localStream) {
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }

    // Получение видео от другого участника
    pc.ontrack = (e) => {
        addVideoElement(peerId, e.streams[0], false);
    };

    pc.onicecandidate = (e) => {
        if (e.candidate) {
            window.socket.emit('send-ice-candidate', { toPeerId: peerId, candidate: e.candidate });
        }
    };

    // Авто-переговоры при включении камеры
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
                // Чистим старые видеотреки если были
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
            // Выключаем
            localStream.getVideoTracks().forEach(t => { t.stop(); localStream.removeTrack(t); });
            for (let pc of Object.values(peerConnections)) {
                const sender = pc.getSenders().find(s => s.track?.kind === 'video');
                if (sender) sender.replaceTrack(null);
            }
            isCameraActive = false;
        }
        updateCamUI(isCameraActive);
        addVideoElement(window.socket.id, localStream, true);
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

// ---------- 4. ОТРИСОВКА ВИДЕО (БЕЗ ДУБЛЕЙ) ----------
function addVideoElement(peerId, stream, isLocal = false) {
    const grid = document.getElementById('video-grid');
    if (!grid) return;

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
    if (videoEl.srcObject !== stream) videoEl.srcObject = stream;
}

function removeVideoElement(peerId) {
    document.getElementById(`container-${peerId}`)?.remove();
}

// ---------- 5. ПРИВЯЗКА К ТВОИМ ID КНОПОК ----------
function setupButtons() {
    // Кнопка микрофона (общая для всех)
    const micBtn = document.getElementById('call-mic');
    if (micBtn) micBtn.onclick = toggleMic;

    // Кнопка камеры (общая для всех)
    const camBtn = document.getElementById('call-cam');
    if (camBtn) camBtn.onclick = toggleCamera;

    // Кнопка завершения (разные ID у ученика и репетитора)
    const endBtnTutor = document.getElementById('call-end');
    const endBtnStudent = document.getElementById('exit-btn');
    
    const leaveRoom = () => { window.location.href = '/'; };
    
    if (endBtnTutor) endBtnTutor.onclick = leaveRoom;
    if (endBtnStudent) endBtnStudent.onclick = leaveRoom;

    // Демонстрация экрана (только репетитор)
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
                screenTrack.onended = () => { toggleCamera(); }; // Возврат к камере
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