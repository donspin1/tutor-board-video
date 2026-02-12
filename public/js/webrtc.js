// webrtc.js — ФИНАЛЬНАЯ ВЕРСИЯ (полностью независимое видео)

let localStream = null;
let peerConnections = {};
let isVideoActive = false;
let webrtcInitialized = false;

function initWebRTC(socket, roomId, role) {
    if (webrtcInitialized) return;
    
    window.socket = socket;
    window.roomId = roomId;
    window.role = role;
    webrtcInitialized = true;

    console.log(`📹 WebRTC инициализирован для ${role}`);

    // НЕМЕДЛЕННО присоединяемся к видеокомнате (даже без камеры)
    socket.emit('join-video-room', { roomId, peerId: socket.id, role });

    // --- Обработчики событий ---
    socket.on('user-joined', async ({ peerId, role: remoteRole }) => {
        console.log(`👤 user joined: ${peerId} (${remoteRole})`);

        // Всегда создаём peer-соединение
        let pc = peerConnections[peerId];
        if (!pc) {
            pc = createPeerConnection(peerId);
        }

        // Если у нас уже есть локальный поток — добавляем треки
        if (localStream) {
            const senders = pc.getSenders().map(s => s.track?.kind);
            localStream.getTracks().forEach(track => {
                if (!senders.includes(track.kind)) {
                    pc.addTrack(track, localStream);
                    console.log(`➕ Добавлен трек ${track.kind} для ${peerId}`);
                }
            });
        }

        // Кто создаёт offer?
        // Правило: репетитор всегда инициатор, если он в комнате.
        // Если репетитора нет, то инициатором может быть ученик.
        // Упростим: тот, у кого роль 'tutor' создаёт offer,
        // а ученик создаёт offer только если к нему присоединился репетитор.
        if (window.role === 'tutor' || (window.role === 'student' && remoteRole === 'tutor')) {
            // Предотвращаем гонку: создаём offer только если состояние stable
            if (pc.signalingState === 'stable') {
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                socket.emit('send-offer', { toPeerId: peerId, offer });
                console.log(`📤 Offer отправлен ${peerId}`);
            }
        }
    });

    socket.on('receive-offer', async ({ from, offer }) => {
        console.log(`📩 Получен offer от ${from}`);

        let pc = peerConnections[from];
        if (!pc) {
            pc = createPeerConnection(from);
        }

        // Добавляем локальные треки, если есть
        if (localStream) {
            const senders = pc.getSenders().map(s => s.track?.kind);
            localStream.getTracks().forEach(track => {
                if (!senders.includes(track.kind)) {
                    pc.addTrack(track, localStream);
                }
            });
        }

        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('send-answer', { toPeerId: from, answer });
        console.log(`📤 Answer отправлен ${from}`);
    });

    socket.on('receive-answer', async ({ from, answer }) => {
        if (peerConnections[from]) {
            await peerConnections[from].setRemoteDescription(new RTCSessionDescription(answer));
        }
    });

    socket.on('receive-ice-candidate', async ({ from, candidate }) => {
        if (peerConnections[from]) {
            try {
                await peerConnections[from].addIceCandidate(new RTCIceCandidate(candidate));
            } catch (e) {
                console.error('❌ Ошибка добавления ICE кандидата:', e);
            }
        }
    });

    socket.on('user-left', (peerId) => {
        console.log(`👋 user left: ${peerId}`);
        removeVideoElement(peerId);
        if (peerConnections[peerId]) {
            peerConnections[peerId].close();
            delete peerConnections[peerId];
        }
    });

    // --- Кнопки ---
    const videoBtn = document.getElementById('tool-video');
    if (videoBtn) {
        videoBtn.onclick = toggleVideoCall;
    }

    const toggleMic = document.getElementById('toggle-mic');
    if (toggleMic) {
        toggleMic.onclick = toggleMicrophone;
    }

    const toggleCam = document.getElementById('toggle-cam');
    if (toggleCam) {
        toggleCam.onclick = toggleCamera;
    }

    const endCallBtn = document.getElementById('end-call');
    if (endCallBtn) {
        endCallBtn.onclick = stopVideoCall;
    }

    const toggleScreen = document.getElementById('toggle-screen');
    if (toggleScreen && role === 'tutor') {
        toggleScreen.onclick = startScreenShare;
    }
}

// ---------- УПРАВЛЕНИЕ ЗВОНКОМ ----------
async function toggleVideoCall() {
    if (isVideoActive) {
        stopVideoCall();
    } else {
        await startVideoCall();
    }
}

async function startVideoCall() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        isVideoActive = true;

        const panel = document.getElementById('video-panel');
        if (panel) {
            panel.style.display = 'flex';
            if (!panel.dataset.draggable) {
                makeDraggable(panel, panel.querySelector('.video-header'));
                panel.dataset.draggable = 'true';
            }
        }

        addVideoElement(window.socket.id, localStream, true);
        
        // Добавляем треки во ВСЕ существующие peer-соединения
        Object.values(peerConnections).forEach(pc => {
            const senders = pc.getSenders().map(s => s.track?.kind);
            localStream.getTracks().forEach(track => {
                if (!senders.includes(track.kind)) {
                    pc.addTrack(track, localStream);
                    console.log(`➕ Добавлен трек ${track.kind} в соединение`);
                }
            });
        });

        updateMicButton(true);
        updateCamButton(true);

        document.getElementById('tool-video')?.classList.add('active');
        console.log('✅ Видеозвонок запущен');
    } catch (err) {
        console.error('❌ Ошибка включения камеры:', err);
        alert('Не удалось включить камеру/микрофон. Проверьте устройства и разрешения.');
    }
}

function stopVideoCall() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    isVideoActive = false;

    const myVideo = document.getElementById(`video-${window.socket.id}`);
    if (myVideo) myVideo.remove();

    document.getElementById('video-panel').style.display = 'none';
    document.getElementById('tool-video')?.classList.remove('active');
    updateMicButton(false);
    updateCamButton(false);

    console.log('🛑 Видеозвонок завершён');
}

// ---------- УПРАВЛЕНИЕ МИКРОФОНОМ И КАМЕРОЙ ----------
function toggleMicrophone() {
    if (!localStream) return;
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
    if (!localStream) return;
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

// ---------- WEBRTC СОЕДИНЕНИЯ ----------
function createPeerConnection(peerId) {
    if (peerConnections[peerId]) return peerConnections[peerId];

    const pc = new RTCPeerConnection({
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ]
    });

    peerConnections[peerId] = pc;

    pc.onicecandidate = (e) => {
        if (e.candidate) {
            window.socket.emit('send-ice-candidate', { toPeerId: peerId, candidate: e.candidate });
        }
    };

    pc.ontrack = (e) => {
        console.log(`📥 Получен трек ${e.track.kind} от ${peerId}`);
        if (!document.getElementById(`video-${peerId}`)) {
            addVideoElement(peerId, e.streams[0], false);
        }
        // Показываем панель видео, если она скрыта
        document.getElementById('video-panel').style.display = 'flex';
    };

    return pc;
}

async function createOffer(peerId) {
    const pc = createPeerConnection(peerId);
    if (localStream) {
        const senders = pc.getSenders().map(s => s.track?.kind);
        localStream.getTracks().forEach(track => {
            if (!senders.includes(track.kind)) {
                pc.addTrack(track, localStream);
                console.log(`➕ Добавлен трек ${track.kind} для ${peerId}`);
            }
        });
    }

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    window.socket.emit('send-offer', { toPeerId: peerId, offer });
}

// ---------- ОТОБРАЖЕНИЕ ВИДЕО ----------
function addVideoElement(peerId, stream, isLocal = false) {
    const grid = document.getElementById('video-grid');
    if (!grid) return;

    let video = document.getElementById(`video-${peerId}`);
    if (video) {
        video.srcObject = stream;
        return;
    }

    video = document.createElement('video');
    video.id = `video-${peerId}`;
    video.srcObject = stream;
    video.autoplay = true;
    video.playsInline = true;
    if (isLocal) video.muted = true;

    const container = document.createElement('div');
    container.className = 'video-container';
    container.id = `container-${peerId}`;

    const label = document.createElement('span');
    label.className = 'video-label';
    label.textContent = isLocal ? `Вы (${window.role})` : (window.role === 'tutor' ? 'Ученик' : 'Репетитор');

    container.appendChild(video);
    container.appendChild(label);
    grid.appendChild(container);
}

function removeVideoElement(peerId) {
    const el = document.getElementById(`container-${peerId}`);
    if (el) el.remove();
}

// ---------- ДЕМОНСТРАЦИЯ ЭКРАНА ----------
async function startScreenShare() {
    try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const videoTrack = screenStream.getVideoTracks()[0];
        videoTrack.onended = () => {
            navigator.mediaDevices.getUserMedia({ video: true }).then(stream => {
                const newTrack = stream.getVideoTracks()[0];
                replaceVideoTrack(newTrack);
                updateCamButton(true);
            });
        };
        replaceVideoTrack(videoTrack);
        updateCamButton(true);
    } catch (err) {
        console.error('❌ Ошибка демонстрации экрана:', err);
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
        const localVideo = document.querySelector(`#video-${window.socket.id}`);
        if (localVideo) localVideo.srcObject = localStream;
    }
}

// ---------- ПЕРЕТАСКИВАНИЕ ПАНЕЛЕЙ ----------
function makeDraggable(element, handle) {
    if (!element || !handle) return;
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
    handle.style.cursor = 'move';
    handle.addEventListener('mousedown', dragMouseDown);

    function dragMouseDown(e) {
        e.preventDefault();
        pos3 = e.clientX;
        pos4 = e.clientY;
        document.addEventListener('mousemove', elementDrag);
        document.addEventListener('mouseup', closeDragElement);
    }

    function elementDrag(e) {
        e.preventDefault();
        pos1 = pos3 - e.clientX;
        pos2 = pos4 - e.clientY;
        pos3 = e.clientX;
        pos4 = e.clientY;
        let top = element.offsetTop - pos2;
        let left = element.offsetLeft - pos1;
        const canvasArea = document.querySelector('.canvas-area');
        if (canvasArea) {
            top = Math.max(0, Math.min(top, canvasArea.clientHeight - element.clientHeight));
            left = Math.max(0, Math.min(left, canvasArea.clientWidth - element.clientWidth));
        }
        element.style.top = top + 'px';
        element.style.left = left + 'px';
        element.style.right = 'auto';
        element.style.bottom = 'auto';
        element.style.transform = 'none';
    }

    function closeDragElement() {
        document.removeEventListener('mousemove', elementDrag);
        document.removeEventListener('mouseup', closeDragElement);
    }
}