// webrtc.js — ФИНАЛЬНАЯ ВЕРСИЯ (ученик видит репетитора и может включить камеру)

let localStream = null;
let peerConnections = {};
let isVideoActive = false;

// ---------- ИНИЦИАЛИЗАЦИЯ ----------
function initWebRTC(socket, roomId, role) {
    window.socket = socket;
    window.roomId = roomId;
    window.role = role;

    console.log(`📹 WebRTC инициализирован для ${role}`);

    const videoBtn = document.getElementById('tool-video');
    if (videoBtn) {
        videoBtn.addEventListener('click', toggleVideoCall);
        console.log('✅ Кнопка видео привязана');
    }

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

    setupSocketListeners();
}

// ---------- ВКЛ/ВЫКЛ ВИДЕОЗВОНКА ----------
async function toggleVideoCall() {
    if (!isVideoActive) {
        await startVideoCall();
    } else {
        stopVideoCall();
    }
}

async function startVideoCall() {
    try {
        // Если поток ещё не создан — создаём
        if (!localStream) {
            console.log('🎥 Запрашиваем камеру и микрофон...');
            localStream = await navigator.mediaDevices.getUserMedia({ 
                video: true, 
                audio: true 
            }).catch(err => {
                console.error('Ошибка getUserMedia:', err);
                // Пробуем только аудио, если видео недоступно
                return navigator.mediaDevices.getUserMedia({ video: false, audio: true });
            });
            
            if (!localStream) {
                throw new Error('Не удалось получить доступ к устройствам');
            }
            console.log('✅ Поток получен');
        }

        isVideoActive = true;

        // Показываем панель видео
        const panel = document.getElementById('video-panel');
        if (panel) panel.style.display = 'flex';

        // Показываем своё видео
        addLocalVideo();

        // Присоединяемся к видеокомнате
        window.socket.emit('join-video-room', {
            roomId: window.roomId,
            peerId: window.socket.id,
            role: window.role
        });
        console.log(`📡 Присоединились к видеокомнате ${window.roomId}`);

        // Активируем кнопки
        updateMicButton(true);
        updateCamButton(true);
    } catch (err) {
        console.error('❌ Ошибка запуска видео:', err);
        alert('Не удалось включить камеру/микрофон. Проверьте устройства и разрешения.');
    }
}

function stopVideoCall() {
    if (localStream) {
        localStream.getTracks().forEach(track => {
            track.stop();
            console.log(`🛑 Трек ${track.kind} остановлен`);
        });
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
    console.log('👋 Покинули видеокомнату');
}

// ---------- ОТОБРАЖЕНИЕ ВИДЕО ----------
function addLocalVideo() {
    if (!localStream) return;
    addVideoElement(window.socket.id, localStream, true);
}

function addVideoElement(peerId, stream, isLocal = false) {
    const grid = document.getElementById('video-grid');
    if (!grid) {
        console.warn('⚠️ video-grid не найден');
        return;
    }

    // Удаляем старый элемент, если есть
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
    console.log(`🖼️ Добавлено видео для ${peerId} (isLocal: ${isLocal})`);
}

function removeVideoElement(peerId) {
    const el = document.getElementById(`video-${peerId}`);
    if (el) {
        el.remove();
        console.log(`🗑️ Удалено видео для ${peerId}`);
    }
}

// ---------- УПРАВЛЕНИЕ МИКРОФОНОМ И КАМЕРОЙ ----------
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

// ---------- ДЕМОНСТРАЦИЯ ЭКРАНА (ТОЛЬКО РЕПЕТИТОР) ----------
async function startScreenShare() {
    try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const videoTrack = screenStream.getVideoTracks()[0];
        videoTrack.onended = () => {
            // Возвращаем камеру
            navigator.mediaDevices.getUserMedia({ video: true }).then(stream => {
                const newTrack = stream.getVideoTracks()[0];
                replaceVideoTrack(newTrack);
                updateCamButton(true);
            });
        };
        replaceVideoTrack(videoTrack);
        updateCamButton(true);
        console.log('🖥️ Демонстрация экрана запущена');
    } catch (err) {
        console.error('Ошибка демонстрации экрана:', err);
        alert('Не удалось начать демонстрацию экрана');
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

// ---------- ОБРАБОТКА СИГНАЛОВ WEBRTC ----------
function setupSocketListeners() {
    const socket = window.socket;

    // Кто-то присоединился к нашей видеокомнате
    socket.on('user-joined', async ({ peerId, role }) => {
        console.log(`👤 user joined: ${peerId} (${role})`);

        // Если у нас ещё нет потока — создаём его (авто-ответ на звонок)
        if (!localStream) {
            console.log('📞 Получен входящий вызов, запускаем видео...');
            await startVideoCall();
        }

        // Создаём peer-соединение
        const pc = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        });
        peerConnections[peerId] = pc;

        // Добавляем все треки локального потока
        localStream.getTracks().forEach(track => {
            pc.addTrack(track, localStream);
            console.log(`➕ Добавлен трек ${track.kind} для ${peerId}`);
        });

        pc.onicecandidate = (e) => {
            if (e.candidate) {
                socket.emit('send-ice-candidate', { 
                    toPeerId: peerId, 
                    candidate: e.candidate 
                });
            }
        };

        pc.ontrack = (e) => {
            console.log(`📥 Получен трек ${e.track.kind} от ${peerId}`);
            if (!document.getElementById(`video-${peerId}`)) {
                addVideoElement(peerId, e.streams[0], false);
            }
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('send-offer', { toPeerId: peerId, offer });
        console.log(`📤 Offer отправлен ${peerId}`);
    });

    // Получили offer от другого участника
    socket.on('receive-offer', async ({ from, offer }) => {
        console.log(`📩 Получен offer от ${from}`);

        // Если у нас нет потока — создаём
        if (!localStream) {
            console.log('📞 Получен offer, запускаем видео...');
            await startVideoCall();
        }

        const pc = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        });
        peerConnections[from] = pc;

        localStream.getTracks().forEach(track => {
            pc.addTrack(track, localStream);
        });

        pc.onicecandidate = (e) => {
            if (e.candidate) {
                socket.emit('send-ice-candidate', { 
                    toPeerId: from, 
                    candidate: e.candidate 
                });
            }
        };

        pc.ontrack = (e) => {
            console.log(`📥 Получен трек ${e.track.kind} от ${from}`);
            if (!document.getElementById(`video-${from}`)) {
                addVideoElement(from, e.streams[0], false);
            }
        };

        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('send-answer', { toPeerId: from, answer });
        console.log(`📤 Answer отправлен ${from}`);
    });

    // Получили answer
    socket.on('receive-answer', ({ from, answer }) => {
        console.log(`📩 Получен answer от ${from}`);
        if (peerConnections[from]) {
            peerConnections[from].setRemoteDescription(new RTCSessionDescription(answer));
        }
    });

    // Получили ICE-кандидат
    socket.on('receive-ice-candidate', ({ from, candidate }) => {
        console.log(`🧊 Получен ICE-кандидат от ${from}`);
        if (peerConnections[from]) {
            peerConnections[from].addIceCandidate(new RTCIceCandidate(candidate));
        }
    });

    // Пользователь покинул комнату
    socket.on('user-left', (peerId) => {
        console.log(`👋 user left: ${peerId}`);
        if (peerConnections[peerId]) {
            peerConnections[peerId].close();
            delete peerConnections[peerId];
        }
        removeVideoElement(peerId);
    });
}