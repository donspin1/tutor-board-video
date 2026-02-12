// webrtc.js — ФИНАЛЬНАЯ ВЕРСИЯ (полная очистка при отключении и переподключении)

let localStream = null;
let peerConnections = {};
let isVideoActive = false;
let webrtcInitialized = false;

// ---------- ПРИНУДИТЕЛЬНАЯ ПЕРЕГОВОРНАЯ СЕССИЯ ----------
async function negotiate(peerId, pc) {
    if (!pc || pc.signalingState !== 'stable') return;
    console.log(`🔄 Negotiation with ${peerId}`);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    window.socket.emit('send-offer', { toPeerId: peerId, offer });
}

// ---------- ОСНОВНЫЕ ФУНКЦИИ ВИДЕО ----------
async function startVideoCall(isSilent = false) {
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

        // Добавляем треки во все существующие peer-соединения и форсируем переговоры
        for (const [peerId, pc] of Object.entries(peerConnections)) {
            const senders = pc.getSenders().map(s => s.track?.kind);
            localStream.getTracks().forEach(track => {
                if (!senders.includes(track.kind)) {
                    pc.addTrack(track, localStream);
                    console.log(`➕ Добавлен трек ${track.kind} для ${peerId}`);
                }
            });
            await negotiate(peerId, pc);
        }

        updateMicButton(true);
        updateCamButton(true);
        document.getElementById('tool-video')?.classList.add('active');
    } catch (err) {
        console.error('❌ Ошибка камеры:', err);
        if (!isSilent) alert('Нет доступа к камере/микрофону');
    }
}

function stopVideoCall() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    isVideoActive = false;
    document.getElementById(`container-${window.socket.id}`)?.remove();
    document.getElementById('video-panel').style.display = 'none';
    document.getElementById('tool-video')?.classList.remove('active');
    updateMicButton(false);
    updateCamButton(false);
}

function toggleVideoCall() {
    if (isVideoActive) stopVideoCall();
    else startVideoCall(false);
}

// ---------- УПРАВЛЕНИЕ МИКРОФОНОМ ----------
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

// ---------- УПРАВЛЕНИЕ КАМЕРОЙ ----------
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
        const localVideo = document.getElementById(`video-${window.socket.id}`);
        if (localVideo) localVideo.srcObject = localStream;
    }
}

// ---------- ПОЛНОЕ УДАЛЕНИЕ ВИДЕО-ЭЛЕМЕНТА ----------
function removeVideoElement(peerId) {
    const container = document.getElementById(`container-${peerId}`);
    if (container) {
        // Останавливаем видео-поток
        const video = container.querySelector('video');
        if (video && video.srcObject) {
            video.srcObject.getTracks().forEach(track => track.stop());
            video.srcObject = null;
        }
        container.remove();
        console.log(`🗑️ Удалён видео-элемент для ${peerId}`);
    }
}

// ---------- ДОБАВЛЕНИЕ ВИДЕО-ЭЛЕМЕНТА ----------
function addVideoElement(peerId, stream, isLocal = false) {
    const grid = document.getElementById('video-grid');
    if (!grid) return;

    // Принудительно удаляем старый контейнер, если он есть
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

// ---------- ПЕРЕТАСКИВАНИЕ ----------
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

// ---------- СОЗДАНИЕ PEER-СОЕДИНЕНИЯ ----------
function createPeerConnection(peerId) {
    // Если соединение с таким peerId уже есть, закрываем его и удаляем
    if (peerConnections[peerId]) {
        console.warn(`⚠️ Соединение с ${peerId} уже существует, закрываем старое`);
        peerConnections[peerId].close();
        delete peerConnections[peerId];
    }

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
        console.log(`🎥 Получен трек ${e.track.kind} от ${peerId}`);
        document.getElementById('video-panel').style.display = 'flex';
        addVideoElement(peerId, e.streams[0], false);
    };

    pc.oniceconnectionstatechange = () => {
        console.log(`🔄 ICE state с ${peerId}: ${pc.iceConnectionState}`);
        if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
            removeVideoElement(peerId);
        }
    };

    pc.onsignalingstatechange = () => {
        console.log(`🔄 Signaling state с ${peerId}: ${pc.signalingState}`);
    };

    pc.onnegotiationneeded = async () => {
        console.log(`🤝 negotiationneeded для ${peerId}`);
        if (pc.signalingState === 'stable') {
            await negotiate(peerId, pc);
        }
    };

    return pc;
}

// ---------- НАВЕШИВАНИЕ КНОПОК ----------
function setupButtons() {
    const videoBtn = document.getElementById('tool-video');
    if (videoBtn) videoBtn.onclick = toggleVideoCall;

    const toggleMic = document.getElementById('toggle-mic');
    if (toggleMic) toggleMic.onclick = toggleMicrophone;

    const toggleCam = document.getElementById('toggle-cam');
    if (toggleCam) toggleCam.onclick = toggleCamera;

    const endCallBtn = document.getElementById('end-call');
    if (endCallBtn) endCallBtn.onclick = stopVideoCall;

    const toggleScreen = document.getElementById('toggle-screen');
    if (toggleScreen && window.role === 'tutor') {
        toggleScreen.onclick = startScreenShare;
    }
}

// ---------- ИНИЦИАЛИЗАЦИЯ ----------
function initWebRTC(socket, roomId, role) {
    if (webrtcInitialized) return;
    webrtcInitialized = true;
    
    window.socket = socket;
    window.roomId = roomId;
    window.role = role;
    
    console.log(`📹 WebRTC: Инициализация для ${role}`);

    const joinVideoRoom = () => {
        if (socket.id) {
            socket.emit('join-video-room', { roomId, peerId: socket.id, role });
            console.log(`✅ Отправлен join-video-room, peerId: ${socket.id}`);
        } else {
            console.error('❌ socket.id не определён!');
        }
    };

    if (socket.connected) {
        joinVideoRoom();
    } else {
        socket.once('connect', joinVideoRoom);
    }

    // --- СОБЫТИЯ ---
    socket.on('user-joined', async ({ peerId, role: remoteRole }) => {
        if (!peerId) {
            console.warn('⚠️ user-joined без peerId');
            return;
        }
        console.log(`👤 user-joined: ${peerId} (${remoteRole})`);
        
        // Удаляем старый видео-элемент (на случай, если он застрял)
        removeVideoElement(peerId);
        
        const pc = createPeerConnection(peerId);

        if (localStream) {
            localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
        }

        // Репетитор всегда инициатор
        if (role === 'tutor') {
            // Небольшая задержка для стабилизации
            setTimeout(async () => {
                if (pc.signalingState === 'stable') {
                    await negotiate(peerId, pc);
                }
            }, 200);
        }
    });

    socket.on('receive-offer', async ({ from, offer }) => {
        if (!from || !offer) return;
        console.log(`📩 receive-offer от ${from}`);
        
        let pc = peerConnections[from];
        if (!pc) {
            pc = createPeerConnection(from);
        }

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
        console.log(`📤 Answer отправлен для ${from}`);
    });

    socket.on('receive-answer', ({ from, answer }) => {
        if (!from || !answer) return;
        if (peerConnections[from]) {
            peerConnections[from].setRemoteDescription(new RTCSessionDescription(answer));
            console.log(`✅ Answer установлен для ${from}`);
        }
    });

    socket.on('receive-ice-candidate', ({ from, candidate }) => {
        if (!from || !candidate) return;
        if (peerConnections[from]) {
            peerConnections[from].addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
        }
    });

    socket.on('user-left', (peerId) => {
        if (!peerId) return;
        console.log(`👋 user-left: ${peerId}`);
        if (peerConnections[peerId]) {
            peerConnections[peerId].close();
            delete peerConnections[peerId];
        }
        removeVideoElement(peerId);
    });

    setupButtons();

    // АВТОСТАРТ ДЛЯ УЧЕНИКА
    if (role === 'student') {
        const startVideo = () => {
            setTimeout(() => {
                startVideoCall(true);
            }, 1500);
        };
        if (socket.connected) {
            startVideo();
        } else {
            socket.once('connect', startVideo);
        }
    }
}