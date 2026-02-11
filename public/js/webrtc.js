// webrtc.js — ИСПРАВЛЕННАЯ ПРОФЕССИОНАЛЬНАЯ ВЕРСИЯ (видео и аудио работают)

let localStream = null;
let peerConnections = {};
let isVideoActive = false;

// ---------- 1. ЗАПРАШИВАЕМ РАЗРЕШЕНИЯ И СОХРАНЯЕМ ПОТОК ----------
async function initLocalStream() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        console.log('✅ Поток получен и сохранён');
        return localStream;
    } catch (err) {
        console.error('❌ Не удалось получить доступ к камере/микрофону:', err);
        alert('Не удалось включить камеру/микрофон. Проверьте разрешения.');
        return null;
    }
}

// ---------- 2. ИНИЦИАЛИЗАЦИЯ (ВЫЗЫВАЕТСЯ ИЗ tutor.js / student.js) ----------
function initWebRTC(socket, roomId, role) {
    window.socket = socket;
    window.roomId = roomId;
    window.role = role;

    // Кнопка включения видеозвонка
    const videoBtn = document.getElementById('tool-video');
    if (videoBtn) videoBtn.addEventListener('click', toggleVideoCall);

    // Кнопки управления микрофоном/камерой
    const toggleMic = document.getElementById('toggle-mic');
    if (toggleMic) toggleMic.addEventListener('click', toggleMicrophone);

    const toggleCam = document.getElementById('toggle-cam');
    if (toggleCam) toggleCam.addEventListener('click', toggleCamera);

    const endCallBtn = document.getElementById('end-call');
    if (endCallBtn) endCallBtn.addEventListener('click', stopVideoCall);

    const toggleScreen = document.getElementById('toggle-screen');
    if (toggleScreen && role === 'tutor') {
        toggleScreen.addEventListener('click', startScreenShare);
    }

    setupSocketListeners(socket);
}

// ---------- 3. ВКЛ / ВЫКЛ ВИДЕОЗВОНКА ----------
async function toggleVideoCall() {
    if (!isVideoActive) {
        await startVideoCall();
    } else {
        stopVideoCall();
    }
}

async function startVideoCall() {
    // Если поток ещё не создан — создаём
    if (!localStream) {
        localStream = await initLocalStream();
        if (!localStream) return;
    }

    isVideoActive = true;

    // Показываем панель видео
    const panel = document.getElementById('video-panel');
    if (panel) panel.style.display = 'flex';

    // Показываем своё видео
    addVideoElement(window.socket.id, localStream, true);

    // Присоединяемся к видеокомнате
    window.socket.emit('join-video-room', {
        roomId: window.roomId,
        peerId: window.socket.id,
        role: window.role
    });

    // Активируем иконки микрофона и камеры (по умолчанию включены)
    updateMicButton(true);
    updateCamButton(true);
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
}

// ---------- 4. ОТОБРАЖЕНИЕ ВИДЕО ----------
function addVideoElement(peerId, stream, isLocal = false) {
    const grid = document.getElementById('video-grid');
    if (!grid) return;

    // Удаляем старый элемент, если такой уже есть
    const existing = document.getElementById(`video-${peerId}`);
    if (existing) existing.remove();

    const container = document.createElement('div');
    container.className = 'video-container';
    container.id = `video-${peerId}`;

    const video = document.createElement('video');
    video.srcObject = stream;
    video.autoplay = true;
    video.playsInline = true;
    if (isLocal) video.muted = true; // Себя не слышим

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

// ---------- 5. УПРАВЛЕНИЕ МИКРОФОНОМ И КАМЕРОЙ ----------
function toggleMicrophone() {
    if (!localStream) {
        startVideoCall().then(() => {
            setTimeout(() => {
                const track = localStream?.getAudioTracks()[0];
                if (track) {
                    track.enabled = !track.enabled;
                    updateMicButton(track.enabled);
                }
            }, 500);
        });
        return;
    }
    const track = localStream.getAudioTracks()[0];
    if (track) {
        track.enabled = !track.enabled;
        updateMicButton(track.enabled);
    }
}

function updateMicButton(enabled) {
    const btn = document.getElementById('toggle-mic');
    if (btn) {
        btn.innerHTML = enabled ? '<i class="fas fa-microphone"></i>' : '<i class="fas fa-microphone-slash"></i>';
        btn.classList.toggle('active', enabled);
    }
}

function toggleCamera() {
    if (!localStream) {
        startVideoCall().then(() => {
            setTimeout(() => {
                const track = localStream?.getVideoTracks()[0];
                if (track) {
                    track.enabled = !track.enabled;
                    updateCamButton(track.enabled);
                }
            }, 500);
        });
        return;
    }
    const track = localStream.getVideoTracks()[0];
    if (track) {
        track.enabled = !track.enabled;
        updateCamButton(track.enabled);
    }
}

function updateCamButton(enabled) {
    const btn = document.getElementById('toggle-cam');
    if (btn) {
        btn.innerHTML = enabled ? '<i class="fas fa-video"></i>' : '<i class="fas fa-video-slash"></i>';
        btn.classList.toggle('active', enabled);
    }
}

// ---------- 6. ДЕМОНСТРАЦИЯ ЭКРАНА (ТОЛЬКО ДЛЯ РЕПЕТИТОРА) ----------
async function startScreenShare() {
    try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const videoTrack = screenStream.getVideoTracks()[0];
        videoTrack.onended = () => {
            // Возвращаем камеру после завершения демонстрации
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

// ---------- 7. ОБРАБОТКА СИГНАЛОВ WEBRTC ----------
function setupSocketListeners(socket) {
    socket.on('user-joined', async ({ peerId, role }) => {
        console.log('👤 user joined', peerId, role);

        // Если у нас нет потока — сначала запрашиваем разрешения и создаём поток
        if (!localStream) {
            localStream = await initLocalStream();
            if (!localStream) return;
            // Автоматически показываем видео (как при startVideoCall)
            isVideoActive = true;
            const panel = document.getElementById('video-panel');
            if (panel) panel.style.display = 'flex';
            addVideoElement(socket.id, localStream, true);
            socket.emit('join-video-room', {
                roomId: window.roomId,
                peerId: socket.id,
                role: window.role
            });
        }

        const pc = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        });
        peerConnections[peerId] = pc;

        // Добавляем все треки локального потока
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

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
        console.log('📩 receive offer from', from);

        // Если у нас нет потока — создаём
        if (!localStream) {
            localStream = await initLocalStream();
            if (!localStream) return;
            isVideoActive = true;
            const panel = document.getElementById('video-panel');
            if (panel) panel.style.display = 'flex';
            addVideoElement(socket.id, localStream, true);
            socket.emit('join-video-room', {
                roomId: window.roomId,
                peerId: socket.id,
                role: window.role
            });
        }

        const pc = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        });
        peerConnections[from] = pc;

        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

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
}