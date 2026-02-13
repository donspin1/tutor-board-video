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
        // ЗАПРАШИВАЕМ ВСЁ СРАЗУ (это решает проблему со звуком)
        // Но видео-трек сразу ставим в режим 'disabled'
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        
        // По умолчанию камера выключена
        localStream.getVideoTracks().forEach(track => track.enabled = false);
        isCameraActive = false;

        console.log("🎤 Связь инициализирована (Audio + Muted Video)");

        const panel = document.getElementById('video-panel');
        if (panel) panel.style.display = 'flex';
        
        // Отрисовываем себя (покажем темный экран, так как видео выключено)
        addVideoElement('local', localStream, true);
        
        // 👇 ДОБАВЛЕНО: если репетитор, делаем панель перетаскиваемой
        if (panel && role === 'tutor' && !panel.dataset.draggable) {
            const header = panel.querySelector('.video-header');
            if (header) {
                makeDraggable(panel, header);
                panel.dataset.draggable = 'true';
            }
        }
        
        updateMicUI(true); 
        updateCamUI(false);
    } catch (err) {
        console.error('Ошибка доступа к медиа:', err);
        // Если камеры нет вообще, пробуем только микрофон
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            addVideoElement('local', localStream, true);
        } catch (e) {
            console.error('Даже микрофон не доступен');
        }
    }

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

    // Сразу добавляем все треки из localStream
    if (localStream) {
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }

    pc.ontrack = (e) => {
        console.log("🎯 Поток от партнера:", peerId);
        addVideoElement(peerId, e.streams[0], false);
        
        const panel = document.getElementById('video-panel');
        if (panel && panel.style.display !== 'flex') {
            panel.style.display = 'flex';
        }
        // 👇 ДОБАВЛЕНО: если репетитор, делаем панель перетаскиваемой (при получении чужого видео)
        if (panel && window.role === 'tutor' && !panel.dataset.draggable) {
            const header = panel.querySelector('.video-header');
            if (header) {
                makeDraggable(panel, header);
                panel.dataset.draggable = 'true';
            }
        }
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
        } catch (err) { console.error("Ошибка переговоров:", err); }
    };

    return pc;
}

// ---------- 3. УПРАВЛЕНИЕ КАМЕРОЙ ----------
function toggleCamera() {
    if (!localStream) return;
    
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
        isCameraActive = !isCameraActive;
        videoTrack.enabled = isCameraActive;

        // Чтобы у СЕБЯ видеть темный экран или видео
        const localVideo = document.querySelector(`#container-local video`);
        if (localVideo) {
            localVideo.srcObject = isCameraActive ? localStream : null;
        }

        updateCamUI(isCameraActive);
    } else {
        alert("Камера не найдена в системе");
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

// ---------- 4. ОТРИСОВКА ----------
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
    
    // Если это локальное видео и оно выключено — не вешаем stream, чтобы был черный фон
    if (isLocal && !isCameraActive) {
        videoEl.srcObject = null;
    } else {
        if (videoEl.srcObject !== stream) {
            videoEl.srcObject = stream;
        }
    }
}

function removeVideoElement(peerId) {
    document.getElementById(`container-${peerId}`)?.remove();
}

// ---------- 5. КНОПКИ ----------
function setupButtons() {
    document.getElementById('call-mic').onclick = toggleMic;
    document.getElementById('call-cam').onclick = toggleCamera;
    
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

// ---------- 6. ДЕМОНСТРАЦИЯ ЭКРАНА ----------
async function startScreenShare() {
    try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const videoTrack = screenStream.getVideoTracks()[0];
        videoTrack.onended = () => {
            navigator.mediaDevices.getUserMedia({ video: true }).then(stream => {
                const newTrack = stream.getVideoTracks()[0];
                replaceVideoTrack(newTrack);
                updateCamUI(true);
            });
        };
        replaceVideoTrack(videoTrack);
        updateCamUI(true);
    } catch (err) {
        console.error('Ошибка демонстрации экрана:', err);
        alert("Не удалось начать демонстрацию");
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
        const localVideo = document.querySelector(`#container-local video`);
        if (localVideo) localVideo.srcObject = localStream;
    }
}

// ---------- 7. ПЕРЕТАСКИВАНИЕ ПАНЕЛЕЙ (уже есть) ----------
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