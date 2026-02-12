// webrtc.js — ПОЛНОСТЬЮ НЕЗАВИСИМАЯ СВЯЗЬ (финальная версия)

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

    console.log(`📹 WebRTC: Инициализация для ${role}`);

    // При входе сразу уведомляем сервер
    socket.emit('join-video-room', { roomId, peerId: socket.id, role });

    // СОБЫТИЕ: Кто-то зашел в комнату
    socket.on('user-joined', async ({ peerId, role: remoteRole }) => {
        console.log(`👤 Подключился: ${peerId} (${remoteRole})`);
        
        const pc = createPeerConnection(peerId);

        if (localStream) {
            localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
        }

        if (window.role === 'tutor' || (window.role === 'student' && remoteRole === 'tutor')) {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            socket.emit('send-offer', { toPeerId: peerId, offer });
        }
    });

    socket.on('receive-offer', async ({ from, offer }) => {
        let pc = createPeerConnection(from);
        if (localStream) {
            localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
        }
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('send-answer', { toPeerId: from, answer });
    });

    socket.on('receive-answer', async ({ from, answer }) => {
        if (peerConnections[from]) {
            await peerConnections[from].setRemoteDescription(new RTCSessionDescription(answer));
        }
    });

    socket.on('receive-ice-candidate', async ({ from, candidate }) => {
        if (peerConnections[from]) {
            await peerConnections[from].addIceCandidate(new RTCIceCandidate(candidate)).catch(e => {});
        }
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

function setupButtons() {
    const btnMap = {
        'tool-video': toggleVideoCall,
        'toggle-mic': toggleMicrophone,
        'toggle-cam': toggleCamera,
        'end-call': stopVideoCall,
        'toggle-screen': () => window.role === 'tutor' && startScreenShare()
    };

    Object.entries(btnMap).forEach(([id, func]) => {
        const btn = document.getElementById(id);
        if (btn) btn.onclick = func;
    });
}

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
        document.getElementById('video-panel').style.display = 'flex';
        addVideoElement(peerId, e.streams[0], false);
    };

    pc.onnegotiationneeded = async () => {
        if (pc.signalingState === 'stable') {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            window.socket.emit('send-offer', { toPeerId: peerId, offer });
        }
    };

    return pc;
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

        Object.values(peerConnections).forEach(pc => {
            localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
        });

        updateMicButton(true);
        updateCamButton(true);
        document.getElementById('tool-video')?.classList.add('active');
    } catch (err) {
        alert('Ошибка доступа к камере/микрофону');
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
        const localVideo = document.querySelector(`#video-${window.socket.id}`);
        if (localVideo) localVideo.srcObject = localStream;
    }
}

// ---------- ОТОБРАЖЕНИЕ ВИДЕО ----------
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
        
        const label = document.createElement('span');
        label.className = 'video-label';
        label.textContent = isLocal ? "Вы" : (window.role === 'tutor' ? 'Ученик' : 'Репетитор');
        
        container.appendChild(video);
        container.appendChild(label);
        grid.appendChild(container);
    }
    
    const videoEl = container.querySelector('video');
    if (videoEl.srcObject !== stream) {
        videoEl.srcObject = stream;
    }
}

function removeVideoElement(peerId) {
    document.getElementById(`container-${peerId}`)?.remove();
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