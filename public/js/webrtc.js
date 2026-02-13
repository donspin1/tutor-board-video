// webrtc.js — ФИНАЛЬНАЯ ВЕРСИЯ (перетаскивание видео-панели работает)

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

    // Сразу присоединяемся к видеокомнате
    socket.emit('join-video-room', { roomId, peerId: socket.id, role });

    // Обработчики событий
    socket.on('user-joined', async ({ peerId, role: remoteRole }) => {
        console.log(`👤 user joined: ${peerId} (${remoteRole})`);

        const pc = createPeerConnection(peerId);
        if (localStream) {
            localStream.getTracks().forEach(track => {
                pc.addTrack(track, localStream);
            });
        }

        if (pc.signalingState === 'stable') {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            socket.emit('send-offer', { toPeerId: peerId, offer });
        }
    });

    socket.on('receive-offer', async ({ from, offer }) => {
        console.log(`📩 Получен offer от ${from}`);
        const pc = createPeerConnection(from);
        await pc.setRemoteDescription(new RTCSessionDescription(offer));

        if (localStream) {
            localStream.getTracks().forEach(track => {
                pc.addTrack(track, localStream);
            });
        }

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

    // Настройка кнопок
    setupButtons();
}

function createPeerConnection(peerId) {
    if (peerConnections[peerId]) return peerConnections[peerId];

    const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    peerConnections[peerId] = pc;

    pc.ontrack = (e) => {
        console.log("🎯 Поток от партнера:", peerId);
        addVideoElement(peerId, e.streams[0], false);
        // Показываем панель, если скрыта
        const panel = document.getElementById('video-panel');
        if (panel && panel.style.display !== 'flex') {
            panel.style.display = 'flex';
        }
        // Инициализируем перетаскивание, если ещё не
        if (panel && !panel.dataset.draggable) {
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

    return pc;
}

async function startVideoCall() {
    try {
        if (!localStream) {
            localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        }
        isVideoActive = true;

        const panel = document.getElementById('video-panel');
        if (panel) {
            panel.style.display = 'flex';
            if (!panel.dataset.draggable) {
                const header = panel.querySelector('.video-header');
                if (header) {
                    makeDraggable(panel, header);
                    panel.dataset.draggable = 'true';
                }
            }
        }

        addVideoElement('local', localStream, true);
        updateMicUI(true);
        updateCamUI(true);

        // Если уже есть подключённые пиры, добавляем треки в их соединения
        Object.values(peerConnections).forEach(pc => {
            localStream.getTracks().forEach(track => {
                pc.addTrack(track, localStream);
            });
        });
    } catch (err) {
        console.error('❌ Ошибка запуска видео:', err);
        alert('Не удалось включить камеру/микрофон');
    }
}

function stopVideoCall() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    isVideoActive = false;
    document.getElementById('video-panel').style.display = 'none';
    document.getElementById('video-grid').innerHTML = '';
    updateMicUI(false);
    updateCamUI(false);
}

function toggleVideoCall() {
    if (isVideoActive) stopVideoCall();
    else startVideoCall();
}

function addVideoElement(peerId, stream, isLocal) {
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
    videoEl.srcObject = stream;
}

function removeVideoElement(peerId) {
    document.getElementById(`container-${peerId}`)?.remove();
}

function toggleMicrophone() {
    if (!localStream) return;
    const track = localStream.getAudioTracks()[0];
    if (track) {
        track.enabled = !track.enabled;
        updateMicUI(track.enabled);
    }
}

function toggleCamera() {
    if (!localStream) return;
    const track = localStream.getVideoTracks()[0];
    if (track) {
        track.enabled = !track.enabled;
        updateCamUI(track.enabled);
        // Для локального видео: если камера выключена — показываем чёрный фон
        const localVideo = document.querySelector('#container-local video');
        if (localVideo) {
            localVideo.srcObject = track.enabled ? localStream : null;
        }
    }
}

function updateMicUI(enabled) {
    const btn = document.getElementById('call-mic');
    if (btn) {
        btn.innerHTML = enabled ? '<i class="fas fa-microphone"></i>' : '<i class="fas fa-microphone-slash"></i>';
        btn.classList.toggle('active', enabled);
    }
}

function updateCamUI(enabled) {
    const btn = document.getElementById('call-cam');
    if (btn) {
        btn.innerHTML = enabled ? '<i class="fas fa-video"></i>' : '<i class="fas fa-video-slash"></i>';
        btn.classList.toggle('active', enabled);
    }
}

function setupButtons() {
    document.getElementById('call-mic')?.addEventListener('click', toggleMicrophone);
    document.getElementById('call-cam')?.addEventListener('click', toggleCamera);
    document.getElementById('call-end')?.addEventListener('click', () => {
        window.location.href = '/';
    });
    document.getElementById('exit-btn')?.addEventListener('click', () => {
        window.location.href = '/';
    });
    document.getElementById('call-screen')?.addEventListener('click', startScreenShare);
}

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
        console.error('❌ Ошибка демонстрации экрана:', err);
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
        const localVideo = document.querySelector('#container-local video');
        if (localVideo) localVideo.srcObject = localStream;
    }
}

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