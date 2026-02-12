// webrtc.js — КОМНАТНАЯ МОДЕЛЬ (Room Model) — КАК В ZOOM

let localStream = null;
let peerConnections = {};
let isCameraActive = false;
let isMicActive = true; // микрофон включён по умолчанию
let webrtcInitialized = false;
let pendingPeers = []; // пиры, ожидающие включения камеры

// ---------- ОТПРАВКА OFFER (КОГДА У НАС ПОЯВИЛОСЬ ВИДЕО) ----------
async function sendOffer(peerId, pc) {
    if (!pc || pc.signalingState !== 'stable' || pc._isNegotiating) return;
    if (!localStream) return; // нет потока — нет offer
    
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

// ---------- ВКЛЮЧЕНИЕ/ВЫКЛЮЧЕНИЕ КАМЕРЫ ----------
async function toggleCamera() {
    if (isCameraActive) {
        // Выключаем камеру
        if (localStream) {
            localStream.getVideoTracks().forEach(track => {
                track.enabled = false;
                // Не останавливаем track, только отключаем
            });
        }
        isCameraActive = false;
        document.getElementById('call-cam')?.classList.remove('active');
        console.log('📷 Камера выключена');
    } else {
        // Включаем камеру
        if (!localStream) {
            // Если ещё нет потока — создаём
            try {
                localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                isMicActive = true;
                isCameraActive = true;
                
                // Добавляем своё видео
                addVideoElement(window.socket.id, localStream, true);
                
                // Добавляем треки во ВСЕ существующие peer-соединения
                for (const [peerId, pc] of Object.entries(peerConnections)) {
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
                    
                    // Отправляем offer
                    await sendOffer(peerId, pc);
                }
                
                // Отправляем offer для отложенных пиров
                for (const peerId of pendingPeers) {
                    const pc = peerConnections[peerId];
                    if (pc) await sendOffer(peerId, pc);
                }
                pendingPeers = [];
                
                document.getElementById('call-cam')?.classList.add('active');
                document.getElementById('call-mic')?.classList.add('active');
                console.log('✅ Камера и микрофон включены');
            } catch (err) {
                console.error('❌ Ошибка доступа к камере:', err);
                alert('Не удалось включить камеру/микрофон');
                return;
            }
        } else {
            // Поток уже есть — просто включаем видео
            localStream.getVideoTracks().forEach(track => { track.enabled = true; });
            isCameraActive = true;
            document.getElementById('call-cam')?.classList.add('active');
            
            // Отправляем offer для всех пиров (переговоры)
            for (const [peerId, pc] of Object.entries(peerConnections)) {
                if (pc.signalingState === 'stable' && !pc._isNegotiating) {
                    await sendOffer(peerId, pc);
                }
            }
        }
    }
}

// ---------- ВКЛЮЧЕНИЕ/ВЫКЛЮЧЕНИЕ МИКРОФОНА ----------
function toggleMic() {
    if (!localStream) {
        // Если нет потока — включаем камеру и микрофон вместе
        toggleCamera();
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
async function toggleScreenShare() {
    if (!window.role === 'tutor') return;
    
    if (window.isScreenSharing) {
        // TODO: остановка демонстрации
        return;
    }
    
    try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        window.isScreenSharing = true;
        
        // Заменяем видеотрек на трек экрана
        const videoTrack = screenStream.getVideoTracks()[0];
        videoTrack.onended = () => {
            window.isScreenSharing = false;
            // Возвращаем камеру
            if (localStream) {
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

    // Сразу создаём transceivers для приёма и отправки
    pc.addTransceiver('audio', { direction: 'sendrecv' });
    pc.addTransceiver('video', { direction: 'sendrecv' });
    console.log(`🔧 Создано peer-соединение для ${peerId}`);

    pc._isNegotiating = false;
    peerConnections[peerId] = pc;

    pc.onicecandidate = (e) => {
        if (e.candidate) {
            window.socket.emit('send-ice-candidate', { toPeerId: peerId, candidate: e.candidate });
        }
    };

    pc.ontrack = (e) => {
        console.log(`🎥 Получен трек ${e.track.kind} от ${peerId}`);
        // Показываем видео-панель, если она скрыта
        document.getElementById('video-panel').style.display = 'flex';
        addVideoElement(peerId, e.streams[0], false);
    };

    pc.oniceconnectionstatechange = () => {
        console.log(`🔄 ICE state [${peerId}]: ${pc.iceConnectionState}`);
        if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
            removeVideoElement(peerId);
        }
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
            
            // Создаём peer-соединение для каждого участника
            const pc = createPeerConnection(peerId);
            
            // Если у нас уже есть поток — добавляем треки и отправляем offer
            if (localStream) {
                localStream.getTracks().forEach(track => {
                    const sender = pc.getSenders().find(s => s.track?.kind === track.kind);
                    if (sender) sender.replaceTrack(track);
                    else pc.addTrack(track, localStream);
                });
                sendOffer(peerId, pc);
            } else {
                // Запоминаем, что этому пиру нужно отправить offer после включения камеры
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
            localStream.getTracks().forEach(track => {
                const sender = pc.getSenders().find(s => s.track?.kind === track.kind);
                if (sender) sender.replaceTrack(track);
                else pc.addTrack(track, localStream);
            });
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
        
        if (localStream) {
            localStream.getTracks().forEach(track => {
                const sender = pc.getSenders().find(s => s.track?.kind === track.kind);
                if (sender) sender.replaceTrack(track);
                else pc.addTrack(track, localStream);
            });
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
            peerConnections[from].addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
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
    document.getElementById('call-cam')?.addEventListener('click', toggleCamera);
    document.getElementById('call-mic')?.addEventListener('click', toggleMic);
    document.getElementById('call-screen')?.addEventListener('click', toggleScreenShare);
    
    // Кнопка выхода/завершения звонка
    const exitBtn = document.getElementById('exit-btn') || document.getElementById('call-end');
    if (exitBtn) {
        exitBtn.addEventListener('click', () => {
            window.location.href = '/';
        });
    }
}