// webrtc.js — ФИНАЛЬНАЯ СТАБИЛЬНАЯ ВЕРСИЯ
// Аудио включается сразу при входе, видео — по кнопке
// Никаких гонок, чёрных экранов, порядок m-lines фиксирован

let localStream = null;
let peerConnections = {};
let isCameraActive = false;  // включена ли камера
let isMicActive = false;     // включён ли микрофон (по умолчанию false, но мы включим сразу)
let webrtcInitialized = false;
let pendingPeers = [];

// ---------- ОТПРАВКА OFFER (ТОЛЬКО КОГДА ЕСТЬ ЛОКАЛЬНЫЙ ПОТОК) ----------
async function sendOffer(peerId, pc) {
    if (!pc || pc.signalingState !== 'stable' || pc._isNegotiating) return;
    if (!localStream) return;
    try {
        pc._isNegotiating = true;
        console.log(`🔄 Отправка offer для ${peerId}`);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        window.socket.emit('send-offer', { toPeerId: peerId, offer });
    } catch (e) {
        console.error(`❌ Ошибка sendOffer:`, e);
    } finally {
        pc._isNegotiating = false;
    }
}

// ---------- ДОБАВЛЕНИЕ ЛОКАЛЬНЫХ ТРЕКОВ В PEER-СОЕДИНЕНИЕ ----------
function addLocalTracksToPeerConnection(pc, peerId) {
    if (!localStream) return;

    // Убеждаемся, что трансиверы существуют в правильном порядке
    const audioTransceiver = pc.getTransceivers().find(t => t.receiver.track.kind === 'audio');
    const videoTransceiver = pc.getTransceivers().find(t => t.receiver.track.kind === 'video');

    // Аудио трансивер должен быть всегда sendrecv
    if (audioTransceiver) {
        if (audioTransceiver.direction !== 'sendrecv') {
            audioTransceiver.direction = 'sendrecv';
            console.log(`🔄 audio transceiver ${peerId} -> sendrecv`);
        }
    }

    // Видео трансивер: если камера включена -> sendrecv, иначе recvonly
    if (videoTransceiver) {
        const desiredDirection = isCameraActive ? 'sendrecv' : 'recvonly';
        if (videoTransceiver.direction !== desiredDirection) {
            videoTransceiver.direction = desiredDirection;
            console.log(`🔄 video transceiver ${peerId} -> ${desiredDirection}`);
        }
    }

    // Добавляем/заменяем треки
    localStream.getTracks().forEach(track => {
        const sender = pc.getSenders().find(s => s.track?.kind === track.kind);
        if (sender) {
            sender.replaceTrack(track);
            console.log(`🔄 replaceTrack ${track.kind} для ${peerId}`);
        } else {
            pc.addTrack(track, localStream);
            console.log(`➕ addTrack ${track.kind} для ${peerId}`);
        }
    });
}

// ---------- ВКЛЮЧЕНИЕ МИКРОФОНА (СРАЗУ ПРИ ИНИЦИАЛИЗАЦИИ) ----------
async function enableMicrophone() {
    if (localStream) return; // уже есть поток
    try {
        console.log('🎤 Запрос микрофона...');
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        isMicActive = true;
        console.log('✅ Микрофон получен');

        // Показываем видео-панель (она может быть скрыта, но теперь отобразим)
        const panel = document.getElementById('video-panel');
        if (panel) panel.style.display = 'flex';

        // Добавляем своё видео (только локальное, без камеры — просто чёрный квадрат)
        addVideoElement(window.socket.id, localStream, true);

        // Добавляем треки во все существующие peer-соединения
        for (const [peerId, pc] of Object.entries(peerConnections)) {
            addLocalTracksToPeerConnection(pc, peerId);
            await sendOffer(peerId, pc);
        }

        // Обрабатываем отложенные пиры
        for (const peerId of pendingPeers) {
            const pc = peerConnections[peerId];
            if (pc) {
                addLocalTracksToPeerConnection(pc, peerId);
                await sendOffer(peerId, pc);
            }
        }
        pendingPeers = [];

        // Обновляем иконку микрофона
        const micBtn = document.getElementById('call-mic');
        if (micBtn) {
            micBtn.innerHTML = '<i class="fas fa-microphone"></i>';
            micBtn.classList.add('active');
        }
    } catch (err) {
        console.error('❌ Не удалось получить доступ к микрофону:', err);
        alert('Не удалось включить микрофон. Проверьте разрешения.');
    }
}

// ---------- ВКЛЮЧЕНИЕ/ВЫКЛЮЧЕНИЕ КАМЕРЫ ----------
async function toggleCamera() {
    if (!localStream) {
        // Если ещё нет потока (нет микрофона) — сначала включаем микрофон
        await enableMicrophone();
    }

    if (isCameraActive) {
        // Выключаем камеру: отключаем видеотрек, меняем направление трансивера
        localStream.getVideoTracks().forEach(track => {
            track.enabled = false;
            // Не останавливаем, просто отключаем
        });
        isCameraActive = false;
        document.getElementById('call-cam')?.classList.remove('active');

        // Обновляем направление трансиверов и отправляем offer всем
        for (const [peerId, pc] of Object.entries(peerConnections)) {
            const videoTransceiver = pc.getTransceivers().find(t => t.receiver.track.kind === 'video');
            if (videoTransceiver) {
                videoTransceiver.direction = 'recvonly';
            }
            // Также можно отправить offer для обновления
            await sendOffer(peerId, pc);
        }
        console.log('📷 Камера выключена');
    } else {
        // Включаем камеру
        try {
            // Если у нас уже есть поток (микрофон), добавляем видеотрек
            if (!localStream.getVideoTracks().length) {
                const videoStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
                const videoTrack = videoStream.getVideoTracks()[0];
                localStream.addTrack(videoTrack);
            }
            localStream.getVideoTracks().forEach(track => { track.enabled = true; });
            isCameraActive = true;
            document.getElementById('call-cam')?.classList.add('active');

            // Обновляем направление трансиверов и отправляем offer всем
            for (const [peerId, pc] of Object.entries(peerConnections)) {
                const videoTransceiver = pc.getTransceivers().find(t => t.receiver.track.kind === 'video');
                if (videoTransceiver) {
                    videoTransceiver.direction = 'sendrecv';
                }
                addLocalTracksToPeerConnection(pc, peerId);
                await sendOffer(peerId, pc);
            }
            console.log('📷 Камера включена');
        } catch (err) {
            console.error('❌ Не удалось включить камеру:', err);
            alert('Не удалось включить камеру. Проверьте разрешения.');
        }
    }
}

// ---------- ВКЛЮЧЕНИЕ/ВЫКЛЮЧЕНИЕ МИКРОФОНА ----------
function toggleMic() {
    if (!localStream) {
        enableMicrophone();
        return;
    }
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        isMicActive = audioTrack.enabled;
        const btn = document.getElementById('call-mic');
        if (btn) {
            btn.innerHTML = isMicActive ? '<i class="fas fa-microphone"></i>' : '<i class="fas fa-microphone-slash"></i>';
            btn.classList.toggle('active', isMicActive);
        }
        console.log(`🎤 Микрофон ${isMicActive ? 'включён' : 'выключен'}`);
    }
}

// ---------- ДЕМОНСТРАЦИЯ ЭКРАНА (ТОЛЬКО РЕПЕТИТОР) ----------
let isScreenSharing = false;

async function toggleScreenShare() {
    if (window.role !== 'tutor') return;

    if (isScreenSharing) {
        // TODO: остановка демонстрации экрана (можно добавить позже)
        return;
    }

    try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        isScreenSharing = true;

        const videoTrack = screenStream.getVideoTracks()[0];
        videoTrack.onended = () => {
            isScreenSharing = false;
            // Возвращаем камеру, если она была включена
            if (localStream && isCameraActive) {
                const camTrack = localStream.getVideoTracks()[0];
                if (camTrack) {
                    replaceVideoTrack(camTrack);
                }
            }
            document.getElementById('call-screen')?.classList.remove('active');
        };

        replaceVideoTrack(videoTrack);
        document.getElementById('call-screen')?.classList.add('active');
    } catch (err) {
        console.error('❌ Ошибка демонстрации экрана:', err);
    }
}

function replaceVideoTrack(newTrack) {
    Object.values(peerConnections).forEach(pc => {
        const sender = pc.getSenders().find(s => s.track?.kind === 'video');
        if (sender) sender.replaceTrack(newTrack);
    });
}

// ---------- ВИДЕО-ЭЛЕМЕНТЫ ----------
function removeVideoElement(peerId) {
    const container = document.getElementById(`container-${peerId}`);
    if (container) {
        const video = container.querySelector('video');
        if (video && video.srcObject) {
            video.srcObject.getTracks().forEach(track => track.stop());
            video.srcObject = null;
        }
        container.remove();
        console.log(`🗑️ Удалён видео-элемент для ${peerId}`);
    }
}

function addVideoElement(peerId, stream, isLocal = false) {
    const grid = document.getElementById('video-grid');
    if (!grid) return;

    removeVideoElement(peerId);

    const container = document.createElement('div');
    container.className = 'video-container';
    container.id = `container-${peerId}`;

    const video = document.createElement('video');
    video.id = `video-${peerId}`;
    video.autoplay = true;
    video.playsInline = true;
    if (isLocal) video.muted = true;

    const label = document.createElement('span');
    label.className = 'video-label';
    label.textContent = isLocal ? 'Вы' : (window.role === 'tutor' ? 'Ученик' : 'Репетитор');

    container.appendChild(video);
    container.appendChild(label);
    grid.appendChild(container);

    const videoEl = container.querySelector('video');
    videoEl.srcObject = stream;
    console.log(`🖼️ Добавлено видео для ${peerId} (isLocal: ${isLocal})`);
}

// ---------- СОЗДАНИЕ PEER-СОЕДИНЕНИЯ ----------
function createPeerConnection(peerId) {
    if (peerConnections[peerId]) {
        console.warn(`⚠️ Соединение с ${peerId} уже есть, закрываем`);
        peerConnections[peerId].close();
        delete peerConnections[peerId];
    }

    const pc = new RTCPeerConnection({
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ]
    });

    // 🔥 ФИКСИРОВАННЫЙ ПОРЯДОК: сначала audio, потом video
    // Для аудио: сразу sendrecv (чтобы отправлять микрофон)
    // Для видео: recvonly (ждём, пока собеседник включит камеру)
    pc.addTransceiver('audio', { direction: 'sendrecv' });
    pc.addTransceiver('video', { direction: 'recvonly' });
    console.log(`🔧 Создано peer-соединение для ${peerId} (audio:sendrecv, video:recvonly)`);

    pc._isNegotiating = false;
    peerConnections[peerId] = pc;

    pc.onicecandidate = (e) => {
        if (e.candidate) {
            window.socket.emit('send-ice-candidate', { toPeerId: peerId, candidate: e.candidate });
        }
    };

    pc.ontrack = (e) => {
        console.log(`🎥 ontrack: получен трек ${e.track.kind} от ${peerId}`);
        document.getElementById('video-panel').style.display = 'flex';
        addVideoElement(peerId, e.streams[0], false);
    };

    pc.oniceconnectionstatechange = () => {
        console.log(`🔄 ICE state [${peerId}]: ${pc.iceConnectionState}`);
        if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
            removeVideoElement(peerId);
        }
    };

    pc.onsignalingstatechange = () => {
        console.log(`🔄 Signaling state [${peerId}]: ${pc.signalingState}`);
    };

    return pc;
}

// ---------- ИНИЦИАЛИЗАЦИЯ ----------
function initWebRTC(socket, roomId, role) {
    if (webrtcInitialized) return;
    webrtcInitialized = true;

    window.socket = socket;
    window.roomId = roomId;
    window.role = role;

    console.log(`📹 WebRTC: Инициализация для ${role}`);

    // --- ПРИСОЕДИНЕНИЕ К КОМНАТЕ ---
    socket.emit('join-room', roomId, role);

    // --- ПОЛУЧЕНИЕ СПИСКА ТЕКУЩИХ УЧАСТНИКОВ ---
    socket.on('room-participants', (participants) => {
        console.log(`📋 Получен список участников:`, participants);

        for (const { peerId } of participants) {
            if (peerId === socket.id) continue;
            const pc = createPeerConnection(peerId);

            if (localStream) {
                addLocalTracksToPeerConnection(pc, peerId);
                sendOffer(peerId, pc);
            } else {
                pendingPeers.push(peerId);
            }
        }
    });

    // --- НОВЫЙ УЧАСТНИК ПРИСОЕДИНИЛСЯ ---
    socket.on('user-joined', ({ peerId, role: remoteRole }) => {
        if (!peerId || peerId === socket.id) return;
        console.log(`👤 Новый участник: ${peerId} (${remoteRole})`);

        removeVideoElement(peerId);
        if (peerConnections[peerId]) {
            peerConnections[peerId].close();
            delete peerConnections[peerId];
        }

        const pc = createPeerConnection(peerId);

        if (localStream) {
            addLocalTracksToPeerConnection(pc, peerId);
            sendOffer(peerId, pc);
        } else {
            pendingPeers.push(peerId);
        }
    });

    // --- ПОЛУЧЕНИЕ OFFER ---
    socket.on('receive-offer', async ({ from, offer }) => {
        if (!from || from === socket.id) return;
        console.log(`📩 Получен offer от ${from}`);

        let pc = peerConnections[from];
        if (!pc) pc = createPeerConnection(from);

        // Добавляем локальные треки (если есть)
        if (localStream) {
            addLocalTracksToPeerConnection(pc, from);
        }

        try {
            await pc.setRemoteDescription(new RTCSessionDescription(offer));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.emit('send-answer', { toPeerId: from, answer });
            console.log(`📤 Отправлен answer для ${from}`);
        } catch (e) {
            console.error(`❌ Ошибка обработки offer:`, e);
        }
    });

    // --- ПОЛУЧЕНИЕ ANSWER ---
    socket.on('receive-answer', ({ from, answer }) => {
        if (!from || from === socket.id) return;
        const pc = peerConnections[from];
        if (pc && pc.signalingState === 'have-local-offer') {
            pc.setRemoteDescription(new RTCSessionDescription(answer))
                .then(() => console.log(`✅ Answer установлен для ${from}`))
                .catch(e => console.error('❌ Ошибка установки answer:', e));
        }
    });

    // --- ПОЛУЧЕНИЕ ICE CANDIDATE ---
    socket.on('receive-ice-candidate', ({ from, candidate }) => {
        if (!from || from === socket.id) return;
        if (peerConnections[from]) {
            peerConnections[from].addIceCandidate(new RTCIceCandidate(candidate)).catch(e => {});
        }
    });

    // --- УЧАСТНИК ПОКИНУЛ КОМНАТУ ---
    socket.on('user-left', (peerId) => {
        if (!peerId || peerId === socket.id) return;
        console.log(`👋 Участник покинул: ${peerId}`);
        if (peerConnections[peerId]) {
            peerConnections[peerId].close();
            delete peerConnections[peerId];
        }
        removeVideoElement(peerId);
        pendingPeers = pendingPeers.filter(id => id !== peerId);
    });

    // --- ПРИВЯЗКА КНОПОК ---
    const camBtn = document.getElementById('call-cam');
    if (camBtn) camBtn.addEventListener('click', toggleCamera);

    const micBtn = document.getElementById('call-mic');
    if (micBtn) {
        micBtn.addEventListener('click', toggleMic);
        // Устанавливаем начальное состояние (микрофон выключен, но мы его включим позже)
        micBtn.innerHTML = '<i class="fas fa-microphone-slash"></i>';
        micBtn.classList.remove('active');
    }

    const screenBtn = document.getElementById('call-screen');
    if (screenBtn && role === 'tutor') {
        screenBtn.addEventListener('click', toggleScreenShare);
    }

    const exitBtn = document.getElementById('exit-btn') || document.getElementById('call-end');
    if (exitBtn) {
        exitBtn.addEventListener('click', () => {
            window.location.href = '/';
        });
    }

    // --- АВТОМАТИЧЕСКОЕ ВКЛЮЧЕНИЕ МИКРОФОНА ДЛЯ УЧЕНИКА ---
    if (role === 'student') {
        enableMicrophone();
    } else if (role === 'tutor') {
        // Для репетитора тоже автоматически включаем микрофон при входе
        enableMicrophone();
    }
}