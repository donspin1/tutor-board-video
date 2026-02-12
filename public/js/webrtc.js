let localStream = null;
let peerConnections = {};
let isCameraActive = false;
let isMicActive = false;
let webrtcInitialized = false;

// ---------- 1. ПОЛУЧЕНИЕ МИКРОФОНА (ОБЯЗАТЕЛЬНО ПЕРЕД СТАРТОМ) ----------
async function startInitialMedia() {
    try {
        console.log('🎤 Запрос микрофона...');
        // Сразу берем аудио. Видео пока false, чтобы не пугать юзера
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        isMicActive = true;
        console.log('✅ Микрофон получен');

        // Отображаем локальную панель (пока с черным фоном или заглушкой)
        const panel = document.getElementById('video-panel');
        if (panel) panel.style.display = 'flex';
        
        addVideoElement(window.socket.id, localStream, true);
        updateMicButton(true);
    } catch (err) {
        console.error('❌ Ошибка доступа к медиа:', err);
        alert('Для работы нужен микрофон!');
    }
}

// ---------- 2. СОЗДАНИЕ PEER CONNECTION ----------
function createPeerConnection(peerId) {
    if (peerConnections[peerId]) return peerConnections[peerId];

    const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    peerConnections[peerId] = pc;

    // Добавляем существующие треки (аудио) сразу
    if (localStream) {
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }

    // Обработка входящего видео/аудио
    pc.ontrack = (e) => {
        console.log(`🎥 Получен поток от ${peerId}`);
        const panel = document.getElementById('video-panel');
        if (panel) panel.style.display = 'flex';
        addVideoElement(peerId, e.streams[0], false);
    };

    pc.onicecandidate = (e) => {
        if (e.candidate) {
            window.socket.emit('send-ice-candidate', { toPeerId: peerId, candidate: e.candidate });
        }
    };

    // Автоматические переговоры при добавлении видео
    pc.onnegotiationneeded = async () => {
        try {
            if (pc.signalingState !== 'stable') return;
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            window.socket.emit('send-offer', { toPeerId: peerId, offer });
        } catch (err) {
            console.error('Ошибка в onnegotiationneeded:', err);
        }
    };

    return pc;
}

// ---------- 3. ВКЛЮЧЕНИЕ / ВЫКЛЮЧЕНИЕ КАМЕРЫ ----------
async function toggleCamera() {
    try {
        if (!isCameraActive) {
            // Запрашиваем только видео
            const videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
            const videoTrack = videoStream.getVideoTracks()[0];

            // Добавляем трек в наш основной поток
            localStream.addTrack(videoTrack);
            isCameraActive = true;

            // Обновляем у всех пиров
            for (let pc of Object.values(peerConnections)) {
                // Если мы уже отправляли что-то, пробуем заменить
                const sender = pc.getSenders().find(s => s.track?.kind === 'video');
                if (sender) {
                    sender.replaceTrack(videoTrack);
                } else {
                    pc.addTrack(videoTrack, localStream);
                }
            }
            updateCamButton(true);
            addVideoElement(window.socket.id, localStream, true); // Обновить свое превью
        } else {
            // Выключаем камеру
            const videoTrack = localStream.getVideoTracks()[0];
            if (videoTrack) {
                videoTrack.stop();
                localStream.removeTrack(videoTrack);
            }
            isCameraActive = false;
            updateCamButton(false);
            // Уведомляем других, заменяя трек на null (черный экран у них)
            for (let pc of Object.values(peerConnections)) {
                const sender = pc.getSenders().find(s => s.track?.kind === 'video');
                if (sender) sender.replaceTrack(null);
            }
        }
    } catch (err) {
        console.error('Ошибка камеры:', err);
    }
}

// ---------- 4. ИНИЦИАЛИЗАЦИЯ (ТОТ САМЫЙ ПОРЯДОК) ----------
async function initWebRTC(socket, roomId, role) {
    if (webrtcInitialized) return;
    webrtcInitialized = true;
    window.socket = socket; window.role = role;

    // ШАГ 1: Получаем микрофон
    await startInitialMedia();

    // ШАГ 2: Сообщаем серверу, что мы готовы
    socket.emit('join-video-room', { roomId, peerId: socket.id, role });

    socket.on('user-joined', ({ peerId }) => {
        if (peerId === socket.id) return;
        createPeerConnection(peerId); 
        // Если мы репетитор, onnegotiationneeded создаст оффер сам
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
        if (pc) pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => {});
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

// Вспомогательные функции (кнопки, стили)
function updateMicButton(active) {
    const btn = document.getElementById('call-mic');
    if (btn) btn.classList.toggle('active', active);
}
function updateCamButton(active) {
    const btn = document.getElementById('call-cam');
    if (btn) btn.classList.toggle('active', active);
}

function setupButtons() {
    document.getElementById('call-cam')?.addEventListener('click', toggleCamera);
    document.getElementById('call-mic')?.addEventListener('click', () => {
        if (localStream) {
            const audioTrack = localStream.getAudioTracks()[0];
            audioTrack.enabled = !audioTrack.enabled;
            updateMicButton(audioTrack.enabled);
        }
    });
}

// Отрисовка видео (твоя функция, чуть почищенная)
function addVideoElement(peerId, stream, isLocal = false) {
    const grid = document.getElementById('video-grid');
    if (!grid) return;
    let container = document.getElementById(`container-${peerId}`);
    if (!container) {
        container = document.createElement('div');
        container.className = 'video-container';
        container.id = `container-${peerId}`;
        const video = document.createElement('video');
        video.id = `video-${peerId}`;
        video.autoplay = true;
        video.playsInline = true;
        if (isLocal) video.muted = true;
        container.appendChild(video);
        grid.appendChild(container);
    }
    const videoEl = container.querySelector('video');
    if (videoEl.srcObject !== stream) videoEl.srcObject = stream;
}

function removeVideoElement(peerId) {
    document.getElementById(`container-${peerId}`)?.remove();
}