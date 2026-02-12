// webrtc.js — ФИНАЛЬНАЯ ВЕРСИЯ (независимое видео, гарантированная передача треков)

let localStream = null;
let peerConnections = {};
let isVideoActive = false;
let webrtcInitialized = false;

function initWebRTC(socket, roomId, role) {
    if (webrtcInitialized) {
        console.log('⚠️ WebRTC уже инициализирован, пропускаем');
        return;
    }
    
    window.socket = socket;
    window.roomId = roomId;
    window.role = role;

    console.log(`📹 WebRTC инициализирован для ${role}`);
    webrtcInitialized = true;

    const videoBtn = document.getElementById('tool-video');
    if (videoBtn) {
        videoBtn.removeEventListener('click', toggleVideoCall);
        videoBtn.addEventListener('click', toggleVideoCall);
    }

    const toggleMic = document.getElementById('toggle-mic');
    if (toggleMic) {
        toggleMic.removeEventListener('click', toggleMicrophone);
        toggleMic.addEventListener('click', toggleMicrophone);
    }

    const toggleCam = document.getElementById('toggle-cam');
    if (toggleCam) {
        toggleCam.removeEventListener('click', toggleCamera);
        toggleCam.addEventListener('click', toggleCamera);
    }

    const endCallBtn = document.getElementById('end-call');
    if (endCallBtn) {
        endCallBtn.removeEventListener('click', stopVideoCall);
        endCallBtn.addEventListener('click', stopVideoCall);
    }

    const toggleScreen = document.getElementById('toggle-screen');
    if (toggleScreen && role === 'tutor') {
        toggleScreen.removeEventListener('click', startScreenShare);
        toggleScreen.addEventListener('click', startScreenShare);
    }

    // 👇 ОБА УЧАСТНИКА НЕМЕДЛЕННО ПРИСОЕДИНЯЮТСЯ К ВИДЕОКОМНАТЕ
    socket.emit('join-video-room', {
        roomId: roomId,
        peerId: socket.id,
        role: role
    });
    console.log(`📡 ${role} присоединился к видеокомнате`);

    setupSocketListeners();
}

async function toggleVideoCall() {
    if (!isVideoActive) await startVideoCall();
    else stopVideoCall();
}

async function startVideoCall() {
    try {
        if (!localStream) {
            console.log('🎥 Запрашиваем камеру и микрофон...');
            localStream = await navigator.mediaDevices.getUserMedia({ 
                video: true, 
                audio: true 
            }).catch(err => {
                console.error('Ошибка getUserMedia:', err);
                return navigator.mediaDevices.getUserMedia({ video: false, audio: true });
            });
            
            if (!localStream) throw new Error('Не удалось получить доступ к устройствам');
            console.log('✅ Поток получен');
        }

        isVideoActive = true;
        const panel = document.getElementById('video-panel');
        if (panel) {
            panel.style.display = 'flex';
            if (!panel.dataset.draggable) {
                makeDraggable(panel, panel.querySelector('.video-header'));
                panel.dataset.draggable = 'true';
            }
        }

        addLocalVideo();
        
        // 👇 ДОБАВЛЯЕМ ТРЕКИ ВО ВСЕ СУЩЕСТВУЮЩИЕ PEER-СОЕДИНЕНИЯ
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
    } catch (err) {
        console.error('❌ Ошибка запуска видео:', err);
        alert('Не удалось включить камеру/микрофон. Проверьте устройства и разрешения.');
    }
}

function stopVideoCall() {
    console.log('🛑 Завершение видеозвонка');
    
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
    
    if (window.socket) {
        window.socket.emit('leave-video-room', {
            roomId: window.roomId,
            peerId: window.socket.id
        });
    }
    console.log('👋 Покинули видеокомнату');
    
    updateMicButton(false);
    updateCamButton(false);
}

function addLocalVideo() {
    if (!localStream) return;
    addVideoElement(window.socket.id, localStream, true);
}

function addVideoElement(peerId, stream, isLocal = false) {
    const grid = document.getElementById('video-grid');
    if (!grid) return;

    const existing = document.getElementById(`video-${peerId}`);
    if (existing) existing.remove();

    const container = document.createElement('div');
    container.className = 'video-container';
    container.id = `video-${peerId}`;

    const video = document.createElement('video');
    video.srcObject = stream;
    video.autoplay = true;
    video.playsInline = true;
    if (isLocal) {
        video.muted = true;
        video.style.transform = 'scaleX(-1)';
    }

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

function setupSocketListeners() {
    const socket = window.socket;

    socket.on('user-joined', async ({ peerId, role }) => {
        console.log(`👤 user joined: ${peerId} (${role})`);

        // Создаём peer-соединение, если его ещё нет
        let pc = peerConnections[peerId];
        if (!pc) {
            pc = new RTCPeerConnection({
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' }
                ]
            });
            peerConnections[peerId] = pc;

            pc.onicecandidate = (e) => {
                if (e.candidate) {
                    socket.emit('send-ice-candidate', { toPeerId: peerId, candidate: e.candidate });
                }
            };

            pc.ontrack = (e) => {
                console.log(`📥 Получен трек ${e.track.kind} от ${peerId}`);
                if (!document.getElementById(`video-${peerId}`)) {
                    addVideoElement(peerId, e.streams[0], false);
                }
            };
        }

        // Добавляем локальные треки, если они уже есть
        if (localStream) {
            const senders = pc.getSenders().map(s => s.track?.kind);
            localStream.getTracks().forEach(track => {
                if (!senders.includes(track.kind)) {
                    pc.addTrack(track, localStream);
                    console.log(`➕ Добавлен трек ${track.kind} для ${peerId}`);
                }
            });
        }

        // Инициатором offer'а всегда выступает репетитор,
        // или ученик, если к нему присоединился репетитор
        if (window.role === 'tutor' || (window.role === 'student' && role === 'tutor')) {
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
            pc = new RTCPeerConnection({
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' }
                ]
            });
            peerConnections[from] = pc;

            pc.onicecandidate = (e) => {
                if (e.candidate) {
                    socket.emit('send-ice-candidate', { toPeerId: from, candidate: e.candidate });
                }
            };

            pc.ontrack = (e) => {
                console.log(`📥 Получен трек ${e.track.kind} от ${from}`);
                if (!document.getElementById(`video-${from}`)) {
                    addVideoElement(from, e.streams[0], false);
                }
            };
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
        console.log(`📤 Answer отправлен ${from}`);
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