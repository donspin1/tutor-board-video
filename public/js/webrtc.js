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
        // Шаг 1: Получаем ТОЛЬКО микрофон (это сработает почти всегда)
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        console.log("🎤 Микрофон получен");

        const panel = document.getElementById('video-panel');
        if (panel) panel.style.display = 'flex';
        
        // Отрисовываем себя
        addVideoElement('local', localStream, true);
        updateMicUI(true); 
    } catch (err) {
        console.error('Ошибка доступа к микрофону:', err);
    }

    // Входим в комнату
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

// ---------- 2. СОЗДАНИЕ PEER CONNECTION ----------
function createPeerConnection(peerId) {
    if (peerConnections[peerId]) return peerConnections[peerId];

    const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    peerConnections[peerId] = pc;

    // Добавляем все имеющиеся треки (сейчас это только аудио)
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

    // Важно для корректного добавления видео позже
    pc.onnegotiationneeded = async () => {
        try {
            if (pc.signalingState !== 'stable') return;
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            window.socket.emit('send-offer', { toPeerId: peerId, offer });
        } catch (err) { console.error("Ошибка переговоров:", err); }
    };

    return pc;
}

// ---------- 3. УПРАВЛЕНИЕ КАМЕРОЙ ----------
async function toggleCamera() {
    try {
        if (!isCameraActive) {
            // ВКЛЮЧАЕМ: Запрашиваем видео отдельно
            const tempStream = await navigator.mediaDevices.getUserMedia({ video: true });
            const videoTrack = tempStream.getVideoTracks()[0];

            // Добавляем трек в наш основной localStream
            localStream.addTrack(videoTrack);

            // Обновляем трек у всех подключенных пиров
            for (let pc of Object.values(peerConnections)) {
                const senders = pc.getSenders();
                const videoSender = senders.find(s => s.track && s.track.kind === 'video');
                
                if (videoSender) {
                    await videoSender.replaceTrack(videoTrack);
                } else {
                    pc.addTrack(videoTrack, localStream);
                }
            }
            isCameraActive = true;
        } else {
            // ВЫКЛЮЧАЕМ
            const videoTrack = localStream.getVideoTracks()[0];
            if (videoTrack) {
                videoTrack.stop(); // Останавливаем камеру (индикатор погаснет)
                localStream.removeTrack(videoTrack);
                
                // Уведомляем партнеров (заменяем трек на null)
                for (let pc of Object.values(peerConnections)) {
                    const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
                    if (sender) await sender.replaceTrack(null);
                }
            }
            isCameraActive = false;
        }

        // Обновляем интерфейс
        addVideoElement('local', localStream, true);
        updateCamUI(isCameraActive);

    } catch (err) {
        console.error("Ошибка камеры:", err);
        alert("Не удалось запустить камеру. Проверьте разрешения.");
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

// ---------- 4. ОТРИСОВКА (ФИКС ЗАВИСАНИЯ) ----------
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
    
    // Если есть видео-треки и они не остановлены
    const hasVideo = stream && stream.getVideoTracks().some(t => t.readyState === 'live');

    if (hasVideo) {
        if (videoEl.srcObject !== stream) {
            videoEl.srcObject = stream;
        }
    } else {
        videoEl.srcObject = null; // Черный экран (благодаря CSS)
    }
}

function removeVideoElement(peerId) {
    document.getElementById(`container-${peerId}`)?.remove();
}

// ---------- 5. КНОПКИ ----------
function setupButtons() {
    const micBtn = document.getElementById('call-mic');
    if (micBtn) micBtn.onclick = toggleMic;

    const camBtn = document.getElementById('call-cam');
    if (camBtn) camBtn.onclick = toggleCamera;

    const leave = () => { window.location.href = '/'; };
    if (document.getElementById('call-end')) document.getElementById('call-end').onclick = leave;
    if (document.getElementById('exit-btn')) document.getElementById('exit-btn').onclick = leave;
}

function updateMicUI(enabled) {
    const btn = document.getElementById('call-mic');
    if (btn) btn.innerHTML = enabled ? '<i class="fas fa-microphone"></i>' : '<i class="fas fa-microphone-slash"></i>';
}

function updateCamUI(enabled) {
    const btn = document.getElementById('call-cam');
    if (btn) btn.innerHTML = enabled ? '<i class="fas fa-video"></i>' : '<i class="fas fa-video-slash"></i>';
}