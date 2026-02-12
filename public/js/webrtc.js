// webrtc.js — ФИНАЛЬНАЯ СТАБИЛЬНАЯ ВЕРСИЯ (без дублей, аудио сразу, видео по кнопке)

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

    // Шаг 1: Сразу получаем микрофон (аудио-поток)
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        // Показываем видео-сетку и добавляем своё превью (чёрный квадрат)
        document.getElementById('video-panel').style.display = 'flex';
        addVideoElement(socket.id, localStream, true);
        updateMicUI(true); // Микрофон активен
    } catch (err) {
        console.error('❌ Ошибка при получении микрофона:', err);
        alert('Не удалось получить доступ к микрофону. Проверьте разрешения.');
    }

    // Шаг 2: Входим в видео-комнату
    socket.emit('join-video-room', { roomId, peerId: socket.id, role });

    // --- СОБЫТИЯ СОКЕТА ---
    socket.on('user-joined', ({ peerId }) => {
        if (peerId === socket.id) return;
        createPeerConnection(peerId);
    });

    socket.on('receive-offer', async ({ from, offer }) => {
        const pc = createPeerConnection(from);
        try {
            await pc.setRemoteDescription(new RTCSessionDescription(offer));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.emit('send-answer', { toPeerId: from, answer });
        } catch (e) {
            console.error('❌ Ошибка receive-offer:', e);
        }
    });

    socket.on('receive-answer', async ({ from, answer }) => {
        const pc = peerConnections[from];
        if (pc) {
            try {
                await pc.setRemoteDescription(new RTCSessionDescription(answer));
            } catch (e) {
                console.error('❌ Ошибка receive-answer:', e);
            }
        }
    });

    socket.on('receive-ice-candidate', ({ from, candidate }) => {
        const pc = peerConnections[from];
        if (pc) {
            pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
        }
    });

    socket.on('user-left', (peerId) => {
        removeVideoElement(peerId);
        if (peerConnections[peerId]) {
            peerConnections[peerId].close();
            delete peerConnections[peerId];
        }
    });

    // Привязываем кнопки управления
    setupButtons();
}

// ---------- 2. СОЗДАНИЕ PEER-СОЕДИНЕНИЯ ----------
function createPeerConnection(peerId) {
    if (peerConnections[peerId]) return peerConnections[peerId];

    const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    peerConnections[peerId] = pc;

    // Добавляем локальные аудио-треки (микрофон) сразу при создании PC
    if (localStream) {
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }

    // Получение видео/аудио от удалённого участника
    pc.ontrack = (e) => {
        addVideoElement(peerId, e.streams[0], false);
    };

    pc.onicecandidate = (e) => {
        if (e.candidate) {
            window.socket.emit('send-ice-candidate', { toPeerId: peerId, candidate: e.candidate });
        }
    };

    // Автоматические переговоры при изменении состояния (например, включение камеры)
    pc.onnegotiationneeded = async () => {
        try {
            if (pc.signalingState !== 'stable') return;
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            window.socket.emit('send-offer', { toPeerId: peerId, offer });
        } catch (err) { 
            console.error('❌ onnegotiationneeded:', err); 
        }
    };

    return pc;
}

// ---------- 3. УПРАВЛЕНИЕ КАМЕРОЙ ----------
async function toggleCamera() {
    try {
        if (!isCameraActive) {
            // Включаем камеру
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            const videoTrack = stream.getVideoTracks()[0];

            if (localStream) {
                // Удаляем старые видеотреки (если были)
                localStream.getVideoTracks().forEach(t => {
                    t.stop();
                    localStream.removeTrack(t);
                });
                // Добавляем новый видеотрек
                localStream.addTrack(videoTrack);
            } else {
                // Если localStream почему-то нет (микрофон не включился), создаём новый поток
                localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
                // Обновляем иконку микрофона
                updateMicUI(true);
            }

            // Обновляем видео-превью (удаляем старый контейнер и создаём новый с видео)
            addVideoElement(window.socket.id, localStream, true);

            // Заменяем/добавляем видеотрек во все peer-соединения
            for (let pc of Object.values(peerConnections)) {
                const sender = pc.getSenders().find(s => s.track?.kind === 'video');
                if (sender) {
                    sender.replaceTrack(videoTrack);
                } else {
                    pc.addTrack(videoTrack, localStream);
                }
            }
            isCameraActive = true;
        } else {
            // Выключаем камеру
            if (localStream) {
                localStream.getVideoTracks().forEach(t => {
                    t.stop();
                    localStream.removeTrack(t);
                });
                // Обновляем превью (теперь без видео, только аудио)
                addVideoElement(window.socket.id, localStream, true);
                // Удаляем видеотрек из всех peer-соединений (заменяем на null)
                for (let pc of Object.values(peerConnections)) {
                    const sender = pc.getSenders().find(s => s.track?.kind === 'video');
                    if (sender) sender.replaceTrack(null);
                }
            }
            isCameraActive = false;
        }
        updateCamUI(isCameraActive);
    } catch (err) { 
        console.error('❌ Ошибка переключения камеры:', err);
        alert('Не удалось запустить камеру'); 
    }
}

// ---------- 4. УПРАВЛЕНИЕ МИКРОФОНОМ ----------
function toggleMic() {
    if (!localStream) return;
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        updateMicUI(audioTrack.enabled);
    }
}

// ---------- 5. ОТРИСОВКА ВИДЕО (БЕЗ ДУБЛИКАТОВ) ----------
function addVideoElement(peerId, stream, isLocal = false) {
    const grid = document.getElementById('video-grid');
    if (!grid) return;

    // 🔥 УДАЛЯЕМ ВСЕ СУЩЕСТВУЮЩИЕ КОНТЕЙНЕРЫ С ЭТИМ peerId (гарантия отсутствия дублей)
    const existing = document.querySelectorAll(`#container-${peerId}`);
    existing.forEach(el => el.remove());

    const container = document.createElement('div');
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

    const videoEl = container.querySelector('video');
    videoEl.srcObject = stream;
}

function removeVideoElement(peerId) {
    const el = document.getElementById(`container-${peerId}`);
    if (el) el.remove();
}

// ---------- 6. ПРИВЯЗКА КНОПОК ----------
function setupButtons() {
    // Микрофон (общий)
    const micBtn = document.getElementById('call-mic');
    if (micBtn) micBtn.onclick = toggleMic;

    // Камера (общий)
    const camBtn = document.getElementById('call-cam');
    if (camBtn) camBtn.onclick = toggleCamera;

    // Завершение звонка (разные ID у ученика и репетитора)
    const endBtnTutor = document.getElementById('call-end');
    const endBtnStudent = document.getElementById('exit-btn');
    const leaveRoom = () => { window.location.href = '/'; };
    if (endBtnTutor) endBtnTutor.onclick = leaveRoom;
    if (endBtnStudent) endBtnStudent.onclick = leaveRoom;

    // Демонстрация экрана (только репетитор)
    const screenBtn = document.getElementById('call-screen');
    if (screenBtn && window.role === 'tutor') {
        screenBtn.onclick = async () => {
            try {
                const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
                const screenTrack = screenStream.getVideoTracks()[0];
                // Заменяем видеотрек во всех PC
                for (let pc of Object.values(peerConnections)) {
                    const sender = pc.getSenders().find(s => s.track?.kind === 'video');
                    if (sender) sender.replaceTrack(screenTrack);
                }
                screenTrack.onended = () => {
                    // При завершении демонстрации возвращаем камеру (если она была включена)
                    if (isCameraActive) {
                        const camTrack = localStream?.getVideoTracks()[0];
                        if (camTrack) {
                            for (let pc of Object.values(peerConnections)) {
                                const sender = pc.getSenders().find(s => s.track?.kind === 'video');
                                if (sender) sender.replaceTrack(camTrack);
                            }
                        }
                    }
                };
            } catch (e) { console.error('❌ Демонстрация экрана:', e); }
        };
    }
}

// ---------- 7. ОБНОВЛЕНИЕ ИКОНОК ----------
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