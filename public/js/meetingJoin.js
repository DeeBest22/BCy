class ReactionManager {
  constructor(socket) {
    this.socket = socket;
    this.raisedHands = new Set();
    this.setupEventListeners();
    this.setupSocketListeners();
  }

  setupEventListeners() {
    // Emoji picker toggle
    const emojiBtn = document.getElementById('emojiBtn');
    const emojiPicker = document.getElementById('emojiPicker');
    
    if (emojiBtn && emojiPicker) {
      emojiBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleEmojiPicker();
      });

      // Close emoji picker when clicking outside
      document.addEventListener('click', (e) => {
        if (!emojiPicker.contains(e.target) && !emojiBtn.contains(e.target)) {
          this.closeEmojiPicker();
        }
      });

      // Emoji buttons
      const emojiButtons = emojiPicker.querySelectorAll('.emoji-btn');
      emojiButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.sendReaction(btn.textContent);
          this.closeEmojiPicker();
        });
      });
    }

    // Hand raise toggle
    const handBtn = document.getElementById('handBtn');
    if (handBtn) {
      handBtn.addEventListener('click', () => {
        this.toggleHandRaise();
      });
    }
  }

  setupSocketListeners() {
    this.socket.on('reaction-received', (data) => {
      this.displayReaction(data);
    });

    this.socket.on('hand-raised', (data) => {
      this.raisedHands.add(data.socketId);
      this.updateParticipantsDisplay();
    });

    this.socket.on('hand-lowered', (data) => {
      this.raisedHands.delete(data.socketId);
      this.updateParticipantsDisplay();
    });
  }

  toggleEmojiPicker() {
    const emojiPicker = document.getElementById('emojiPicker');
    if (emojiPicker) {
      emojiPicker.classList.toggle('show');
    }
  }

  closeEmojiPicker() {
    const emojiPicker = document.getElementById('emojiPicker');
    if (emojiPicker) {
      emojiPicker.classList.remove('show');
    }
  }

  sendReaction(emoji) {
    this.socket.emit('send-reaction', {
      emoji: emoji,
      timestamp: Date.now()
    });
  }

  displayReaction(data) {
    const { emoji, participantName, socketId } = data;
    
    // Find the participant's video wrapper
    const videoWrapper = document.querySelector(`[data-socket-id="${socketId}"]`);
    if (!videoWrapper) return;

    // Create reaction element
    const reaction = document.createElement('div');
    reaction.className = 'reaction-animation';
    reaction.innerHTML = `
      <div class="reaction-emoji">${emoji}</div>
      <div class="reaction-name">${participantName}</div>
    `;

    // Position the reaction
    const rect = videoWrapper.getBoundingClientRect();
    reaction.style.position = 'fixed';
    reaction.style.left = `${rect.left + rect.width / 2 - 25}px`;
    reaction.style.top = `${rect.top + rect.height / 2 - 25}px`;
    reaction.style.zIndex = '1000';

    document.body.appendChild(reaction);

    // Animate the reaction
    setTimeout(() => reaction.classList.add('animate'), 100);

    // Remove after animation
    setTimeout(() => {
      if (reaction.parentNode) {
        reaction.parentNode.removeChild(reaction);
      }
    }, 3000);
  }

  toggleHandRaise() {
    const handBtn = document.getElementById('handBtn');
    const isRaised = handBtn.getAttribute('data-active') === 'true';
    
    if (isRaised) {
      this.socket.emit('lower-hand');
      handBtn.setAttribute('data-active', 'false');
      handBtn.style.background = '';
    } else {
      this.socket.emit('raise-hand');
      handBtn.setAttribute('data-active', 'true');
      handBtn.style.background = '#fbbf24';
    }
  }

  updateHandRaised(socketId, participantName, isRaised) {
    if (isRaised) {
      this.raisedHands.add(socketId);
    } else {
      this.raisedHands.delete(socketId);
    }
    this.updateParticipantsDisplay();
  }

  updateParticipantsDisplay() {
    // Update hand raised indicators on video wrappers
    this.raisedHands.forEach(socketId => {
      const wrapper = document.querySelector(`[data-socket-id="${socketId}"]`);
      if (wrapper && !wrapper.querySelector('.hand-raised-indicator')) {
        const indicator = document.createElement('div');
        indicator.className = 'hand-raised-indicator';
        indicator.innerHTML = '<i class="fas fa-hand-paper"></i> Hand Raised';
        wrapper.appendChild(indicator);
      }
    });

    // Remove indicators for lowered hands
    document.querySelectorAll('.hand-raised-indicator').forEach(indicator => {
      const wrapper = indicator.closest('[data-socket-id]');
      if (wrapper) {
        const socketId = wrapper.dataset.socketId;
        if (!this.raisedHands.has(socketId)) {
          indicator.remove();
        }
      }
    });
  }

  onParticipantsUpdated() {
    this.updateParticipantsDisplay();
  }
}

class WebRTCManager {
  constructor(socket) {
    this.socket = socket;
    this.localStream = null;
    this.screenStream = null;
    this.peerConnections = new Map();
    this.remoteStreams = new Map();
    this.isScreenSharing = false;
    this.audioContext = null;
    this.isReady = false;
    
    this.configuration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    };

    this.setupSocketListeners();
  }

  setupSocketListeners() {
    this.socket.on('initiate-connection', async (data) => {
      const { targetSocketId, shouldCreateOffer } = data;
      console.log(`Initiating connection with ${targetSocketId}, shouldCreateOffer: ${shouldCreateOffer}`);
      
      if (shouldCreateOffer) {
        await this.createPeerConnection(targetSocketId, true);
      } else {
        await this.createPeerConnection(targetSocketId, false);
      }
    });

    this.socket.on('offer', async (data) => {
      await this.handleOffer(data);
    });

    this.socket.on('answer', async (data) => {
      await this.handleAnswer(data);
    });

    this.socket.on('ice-candidate', async (data) => {
      await this.handleIceCandidate(data);
    });
  }

  async initialize() {
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        video: { 
          width: { ideal: 1280 }, 
          height: { ideal: 720 },
          frameRate: { ideal: 30 }
        },
        audio: { 
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      
      // Start audio level monitoring
      this.startAudioLevelMonitoring();
      
      console.log('Local stream initialized');
      return true;
    } catch (error) {
      console.error('Error accessing media devices:', error);
      return false;
    }
  }

  setReady() {
    this.isReady = true;
    this.socket.emit('participant-ready');
  }

  startAudioLevelMonitoring() {
    if (!this.localStream) return;

    try {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = this.audioContext.createAnalyser();
      const microphone = this.audioContext.createMediaStreamSource(this.localStream);
      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      microphone.connect(analyser);
      analyser.fftSize = 256;

      const checkAudioLevel = () => {
        if (this.audioContext.state === 'suspended') {
          this.audioContext.resume();
        }
        
        analyser.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
        const normalizedLevel = average / 255;

        // Send audio level to server for auto-spotlight
        this.socket.emit('audio-level', { level: normalizedLevel });

        requestAnimationFrame(checkAudioLevel);
      };

      checkAudioLevel();
    } catch (error) {
      console.error('Error setting up audio monitoring:', error);
    }
  }

  async createPeerConnection(remoteSocketId, shouldCreateOffer) {
    try {
      console.log(`Creating peer connection with ${remoteSocketId}, shouldCreateOffer: ${shouldCreateOffer}`);
      
      // Close existing connection if it exists
      if (this.peerConnections.has(remoteSocketId)) {
        this.peerConnections.get(remoteSocketId).close();
        this.peerConnections.delete(remoteSocketId);
      }

      const peerConnection = new RTCPeerConnection(this.configuration);
      this.peerConnections.set(remoteSocketId, peerConnection);

      // Add local stream tracks
      if (this.localStream) {
        this.localStream.getTracks().forEach(track => {
          peerConnection.addTrack(track, this.localStream);
        });
      }

      // Handle remote stream
      peerConnection.ontrack = (event) => {
        console.log('Received remote track from:', remoteSocketId);
        const [remoteStream] = event.streams;
        this.remoteStreams.set(remoteSocketId, remoteStream);
        this.updateRemoteVideo(remoteSocketId, remoteStream);
      };

      // Handle ICE candidates
      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          this.socket.emit('ice-candidate', {
            target: remoteSocketId,
            candidate: event.candidate
          });
        }
      };

      // Handle connection state changes
      peerConnection.onconnectionstatechange = () => {
        console.log(`Connection state with ${remoteSocketId}:`, peerConnection.connectionState);
        if (peerConnection.connectionState === 'failed') {
          console.log(`Connection failed with ${remoteSocketId}, attempting restart`);
          peerConnection.restartIce();
        }
      };

      // Create and send offer if we should
      if (shouldCreateOffer) {
        const offer = await peerConnection.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true
        });
        await peerConnection.setLocalDescription(offer);
        
        this.socket.emit('offer', {
          target: remoteSocketId,
          offer: offer
        });
      }
    } catch (error) {
      console.error('Error creating peer connection:', error);
    }
  }

  async handleOffer(data) {
    const { offer, sender } = data;
    console.log(`Handling offer from ${sender}`);
    
    try {
      let peerConnection = this.peerConnections.get(sender);
      
      if (!peerConnection) {
        peerConnection = new RTCPeerConnection(this.configuration);
        this.peerConnections.set(sender, peerConnection);

        // Add local stream tracks
        if (this.localStream) {
          this.localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, this.localStream);
          });
        }

        // Handle remote stream
        peerConnection.ontrack = (event) => {
          console.log('Received remote track from:', sender);
          const [remoteStream] = event.streams;
          this.remoteStreams.set(sender, remoteStream);
          this.updateRemoteVideo(sender, remoteStream);
        };

        // Handle ICE candidates
        peerConnection.onicecandidate = (event) => {
          if (event.candidate) {
            this.socket.emit('ice-candidate', {
              target: sender,
              candidate: event.candidate
            });
          }
        };

        // Handle connection state changes
        peerConnection.onconnectionstatechange = () => {
          console.log(`Connection state with ${sender}:`, peerConnection.connectionState);
          if (peerConnection.connectionState === 'failed') {
            console.log(`Connection failed with ${sender}, attempting restart`);
            peerConnection.restartIce();
          }
        };
      }

      // Set remote description and create answer
      await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      
      this.socket.emit('answer', {
        target: sender,
        answer: answer
      });
    } catch (error) {
      console.error('Error handling offer:', error);
    }
  }

  async handleAnswer(data) {
    const { answer, sender } = data;
    console.log(`Handling answer from ${sender}`);
    
    const peerConnection = this.peerConnections.get(sender);
    
    if (peerConnection && peerConnection.signalingState === 'have-local-offer') {
      try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
      } catch (error) {
        console.error('Error handling answer:', error);
      }
    }
  }

  async handleIceCandidate(data) {
    const { candidate, sender } = data;
    const peerConnection = this.peerConnections.get(sender);
    
    if (peerConnection && peerConnection.remoteDescription) {
      try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (error) {
        console.error('Error handling ICE candidate:', error);
      }
    }
  }

  updateRemoteVideo(socketId, stream) {
    // Wait a bit for the DOM to be ready
    setTimeout(() => {
      const videoWrapper = document.querySelector(`[data-socket-id="${socketId}"]`);
      if (videoWrapper) {
        const video = videoWrapper.querySelector('.video-frame');
        if (video && video.srcObject !== stream) {
          video.srcObject = stream;
          video.play().catch(e => console.error('Error playing video:', e));
        }
      }
    }, 100);
  }

  getRemoteStream(socketId) {
    return this.remoteStreams.get(socketId);
  }

  removePeerConnection(socketId) {
    const peerConnection = this.peerConnections.get(socketId);
    if (peerConnection) {
      peerConnection.close();
      this.peerConnections.delete(socketId);
    }
    this.remoteStreams.delete(socketId);
  }

  async toggleAudio(enabled) {
    if (this.localStream) {
      const audioTrack = this.localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = enabled;
      }
    }
  }

  async toggleVideo(enabled) {
    if (this.localStream) {
      const videoTrack = this.localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = enabled;
      }
    }
  }

  async startScreenShare() {
    try {
      this.screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: 'always' },
        audio: true
      });

      // Replace video track in all peer connections
      const videoTrack = this.screenStream.getVideoTracks()[0];
      
      for (const [socketId, peerConnection] of this.peerConnections) {
        const sender = peerConnection.getSenders().find(s => 
          s.track && s.track.kind === 'video'
        );
        
        if (sender) {
          await sender.replaceTrack(videoTrack);
        }
      }

      // Update local video to show screen share
      const localVideo = document.querySelector(`[data-socket-id="${this.socket.id}"] .video-frame`);
      if (localVideo) {
        localVideo.srcObject = this.screenStream;
      }

      // Add screen share label
      const localWrapper = document.querySelector(`[data-socket-id="${this.socket.id}"]`);
      if (localWrapper) {
        let label = localWrapper.querySelector('.video-label');
        if (!label) {
          label = document.createElement('div');
          label.className = 'video-label';
          localWrapper.appendChild(label);
        }
        label.innerHTML = '<i class="fas fa-desktop"></i> Screen Share';
      }

      // Handle screen share end
      videoTrack.onended = () => {
        this.stopScreenShare();
      };

      this.isScreenSharing = true;
      
    } catch (error) {
      console.error('Error starting screen share:', error);
      throw error;
    }
  }

  async stopScreenShare() {
    if (this.screenStream) {
      this.screenStream.getTracks().forEach(track => track.stop());
      this.screenStream = null;
    }

    // Replace back to camera video
    if (this.localStream) {
      const videoTrack = this.localStream.getVideoTracks()[0];
      
      for (const [socketId, peerConnection] of this.peerConnections) {
        const sender = peerConnection.getSenders().find(s => 
          s.track && s.track.kind === 'video'
        );
        
        if (sender) {
          await sender.replaceTrack(videoTrack);
        }
      }

      // Update local video back to camera
      const localVideo = document.querySelector(`[data-socket-id="${this.socket.id}"] .video-frame`);
      if (localVideo) {
        localVideo.srcObject = this.localStream;
      }

      // Remove screen share label
      const localWrapper = document.querySelector(`[data-socket-id="${this.socket.id}"]`);
      if (localWrapper) {
        const label = localWrapper.querySelector('.video-label');
        if (label) {
          label.remove();
        }
      }
    }

    this.isScreenSharing = false;
  }
}

class JoinMeeting {
  constructor() {
    this.socket = io();
    this.meetingId = window.location.pathname.split('/').pop();
    this.userName = '';
    this.isHost = false;
    this.participants = new Map();
    this.currentView = 'sidebar';
    this.spotlightedParticipant = null;
    this.pinnedParticipant = null;
    this.webrtc = new WebRTCManager(this.socket);
    this.participantsPanelOpen = false;
    this.searchTerm = '';
    this.reactionManager = null;
    
    this.meetingPermissions = {
      chatEnabled: true,
      fileSharing: true,
      emojiReactions: true
    };
    
    this.init().then(() => {
      // Store global references after initialization
      window.joinMeetingInstance = this;
      window.myName = this.userName;
      console.log('Join meeting initialized. Participant name:', window.myName);
    });
  }

  async init() {
    await this.getUserName();
    this.setupSocketListeners();
    this.setupEventListeners();
    this.updateTime();
    this.joinMeeting();
    
    // Initialize WebRTC and show local video immediately
    const initialized = await this.webrtc.initialize();
    if (initialized) {
      this.showLocalVideo();
      // Set ready after a short delay to ensure everything is set up
      setTimeout(() => {
        this.webrtc.setReady();
      }, 1000);
    }

    // Initialize Reaction Manager
    this.reactionManager = new ReactionManager(this.socket);
  }

  showLocalVideo() {
    // Create local video immediately
    this.participants.set(this.socket.id, {
      socketId: this.socket.id,
      name: this.userName,
      isHost: false,
      isCoHost: false,
      isMuted: false,
      isCameraOff: false,
      isSpotlighted: false,
      isScreenSharing: false,
      handRaised: false
    });
    this.renderParticipants();
    this.renderParticipantsList();
  }

  async getUserName() {
    try {
      const response = await fetch('/api/user');
      const data = await response.json();
      if (data.user) {
        this.userName = data.user.name;
      } else {
        window.location.href = '/login';
      }
    } catch (error) {
      console.error('Error fetching user data:', error);
      window.location.href = '/login';
    }
  }

  setupSocketListeners() {
    this.socket.on('joined-meeting', (data) => {
      console.log('Joined meeting as participant:', data);
      this.updateParticipants(data.participants);
      this.spotlightedParticipant = data.spotlightedParticipant;
      if (data.permissions) {
        this.meetingPermissions = data.permissions;
        this.updatePermissionControls();
      }
      this.updateMeetingTitle();
      this.updateRaisedHands(data.raisedHands);
    });

    this.socket.on('participant-joined', (data) => {
      console.log('Participant joined:', data);
      this.updateParticipants(data.participants);
      this.showToast(`${data.participant.name} joined the meeting`);
    });

    this.socket.on('participant-left', (data) => {
      console.log('Participant left:', data);
      this.removeParticipantVideo(data.socketId);
      this.updateParticipants(data.participants);
      this.showToast(`${data.participantName} left the meeting`);
      
      // Clean up WebRTC connection
      this.webrtc.removePeerConnection(data.socketId);
    });

    this.socket.on('participant-spotlighted', (data) => {
      console.log('Participant spotlighted:', data);
      this.handleSpotlightChange(data.spotlightedParticipant);
      this.updateParticipants(data.participants);
    });

    this.socket.on('spotlight-removed', (data) => {
      console.log('Spotlight removed:', data);
      this.handleSpotlightRemoved();
      this.updateParticipants(data.participants);
    });

    this.socket.on('participant-pinned', (data) => {
      console.log('Participant pinned:', data);
      this.handleParticipantPinned(data.pinnedParticipant);
    });

    this.socket.on('participant-muted', (data) => {
      console.log('Participant muted:', data);
      this.updateParticipantAudio(data.targetSocketId, data.isMuted);
      this.updateParticipants(data.participants);
    });

    this.socket.on('force-mute', (data) => {
      console.log('Force muted by host:', data);
      this.handleForceMute(data.isMuted);
    });

    this.socket.on('made-cohost', () => {
      console.log('Made co-host');
      this.showToast('You have been made a co-host!');
    });

    this.socket.on('kicked-from-meeting', () => {
      console.log('Kicked from meeting');
      this.showKickedModal();
    });

    this.socket.on('meeting-ended', () => {
      console.log('Meeting ended by host');
      this.showMeetingEndedModal();
    });

    this.socket.on('meeting-locked', (data) => {
      console.log('Meeting is locked:', data);
      this.showMeetingLockedModal(data.message);
    });

    this.socket.on('action-error', (data) => {
      console.error('Action error:', data);
      this.showToast(data.message, 'error');
    });

    // Hand raised events
    this.socket.on('hand-raised', (data) => {
      this.updateRaisedHands(data.raisedHands);
      if (this.reactionManager) {
        this.reactionManager.updateHandRaised(data.socketId, data.participantName, true);
      }
    });

    this.socket.on('hand-lowered', (data) => {
      this.updateRaisedHands(data.raisedHands);
      if (this.reactionManager) {
        this.reactionManager.updateHandRaised(data.socketId, data.participantName, false);
      }
    });

    // Permission updates
    this.socket.on('meeting-permissions-updated', (data) => {
      console.log('Meeting permissions updated:', data);
      this.meetingPermissions = data.permissions;
      this.updatePermissionControls();
      this.showToast(`Meeting permissions updated by ${data.changedBy}`, 'info');
    });
  }

  setupEventListeners() {
    // Participants panel toggle
    const memberToggleBtn = document.getElementById('memberToggleBtn');
    if (memberToggleBtn) {
      memberToggleBtn.addEventListener('click', () => {
        this.toggleParticipantsPanel();
      });
    }

    const closeParticipants = document.getElementById('closeParticipants');
    if (closeParticipants) {
      closeParticipants.addEventListener('click', () => {
        this.closeParticipantsPanel();
      });
    }

    // Search functionality
    const participantSearch = document.getElementById('participantSearch');
    if (participantSearch) {
      participantSearch.addEventListener('input', (e) => {
        this.searchTerm = e.target.value.toLowerCase();
        this.renderParticipantsList();
      });
    }

    // View toggle
    const viewToggle = document.getElementById('viewToggle');
    if (viewToggle) {
      viewToggle.addEventListener('click', () => {
        this.toggleView();
      });
    }

    // Mic toggle
    const micBtn = document.getElementById('micBtn');
    if (micBtn) {
      micBtn.addEventListener('click', (e) => {
        this.toggleMic(e.currentTarget);
      });
    }

    // Camera toggle
    const cameraBtn = document.getElementById('cameraBtn');
    if (cameraBtn) {
      cameraBtn.addEventListener('click', (e) => {
        this.toggleCamera(e.currentTarget);
      });
    }

    // Screen share toggle
    const screenShareBtn = document.getElementById('screenShareBtn');
    if (screenShareBtn) {
      screenShareBtn.addEventListener('click', (e) => {
        this.toggleScreenShare(e.currentTarget);
      });
    }

    // Leave call
    const endCallBtn = document.getElementById('endCallBtn');
    if (endCallBtn) {
      endCallBtn.addEventListener('click', () => {
        this.leaveMeeting();
      });
    }

    // Close participants panel when clicking outside
    document.addEventListener('click', (e) => {
      if (this.participantsPanelOpen && 
          !document.getElementById('participantsPanel')?.contains(e.target) &&
          !document.getElementById('memberToggleBtn')?.contains(e.target)) {
        this.closeParticipantsPanel();
      }
    });
  }

  updatePermissionControls() {
    // Update emoji button
    const emojiBtn = document.getElementById('emojiBtn');
    if (emojiBtn) {
      emojiBtn.disabled = !this.meetingPermissions.emojiReactions;
      emojiBtn.style.opacity = this.meetingPermissions.emojiReactions ? '1' : '0.5';
      emojiBtn.title = this.meetingPermissions.emojiReactions ? 
        'Send reaction' : 'Reactions disabled by host';
    }

    // Update hand raise button
    const handBtn = document.getElementById('handBtn');
    if (handBtn) {
      handBtn.disabled = !this.meetingPermissions.emojiReactions;
      handBtn.style.opacity = this.meetingPermissions.emojiReactions ? '1' : '0.5';
      handBtn.title = this.meetingPermissions.emojiReactions ? 
        'Raise hand' : 'Hand raising disabled by host';
    }
  }

  updateRaisedHands(raisedHands) {
    if (this.reactionManager) {
      this.reactionManager.raisedHands.clear();
      raisedHands.forEach(socketId => {
        this.reactionManager.raisedHands.add(socketId);
      });
      this.reactionManager.updateParticipantsDisplay();
    }
  }

  toggleParticipantsPanel() {
    if (this.participantsPanelOpen) {
      this.closeParticipantsPanel();
    } else {
      this.openParticipantsPanel();
    }
  }

  openParticipantsPanel() {
    this.participantsPanelOpen = true;
    const participantsPanel = document.getElementById('participantsPanel');
    const videoContainer = document.getElementById('videoContainer');
    if (participantsPanel) participantsPanel.classList.add('open');
    if (videoContainer) videoContainer.classList.add('participants-open');
    this.renderParticipantsList();
  }

  closeParticipantsPanel() {
    this.participantsPanelOpen = false;
    const participantsPanel = document.getElementById('participantsPanel');
    const videoContainer = document.getElementById('videoContainer');
    if (participantsPanel) participantsPanel.classList.remove('open');
    if (videoContainer) videoContainer.classList.remove('participants-open');
  }

  renderParticipantsList() {
    const participantsList = document.getElementById('participantsList');
    const participantsPanelCount = document.getElementById('participantsPanelCount');
    
    if (!participantsList || !participantsPanelCount) return;
    
    participantsList.innerHTML = '';
    
    const filteredParticipants = Array.from(this.participants.values()).filter(participant => 
      participant.name.toLowerCase().includes(this.searchTerm)
    );

    participantsPanelCount.textContent = filteredParticipants.length;

    filteredParticipants.forEach(participant => {
      const participantItem = this.createParticipantItem(participant);
      participantsList.appendChild(participantItem);
    });

    // Update reaction manager if available
    if (this.reactionManager) {
      this.reactionManager.onParticipantsUpdated();
    }
  }

  createParticipantItem(participant) {
    const item = document.createElement('div');
    item.className = 'participant-item';
    item.dataset.socketId = participant.socketId;

    const initials = participant.name.split(' ').map(n => n[0]).join('').toUpperCase();
    
    let roleText = 'Participant';
    let roleClass = 'participant';
    if (participant.isHost) {
      roleText = 'Host';
      roleClass = 'host';
    } else if (participant.isCoHost) {
      roleText = 'Co-Host';
      roleClass = 'cohost';
    }

    const statusIcons = [];
    if (participant.isMuted) {
      statusIcons.push('<div class="status-icon muted"><i class="fas fa-microphone-slash"></i></div>');
    }
    if (participant.isCameraOff) {
      statusIcons.push('<div class="status-icon camera-off"><i class="fas fa-video-slash"></i></div>');
    }

    item.innerHTML = `
      <div class="participant-avatar">${initials}</div>
      <div class="participant-info">
        <div class="participant-name">${participant.name}</div>
        <div class="participant-role">
          <span class="role-badge ${roleClass}">${roleText}</span>
          ${participant.isSpotlighted ? '<i class="fas fa-star" style="color: #fbbf24; margin-left: 4px;"></i>' : ''}
        </div>
      </div>
      <div class="participant-status">
        ${statusIcons.join('')}
      </div>
    `;

    return item;
  }

  joinMeeting() {
    this.socket.emit('join-meeting', {
      meetingId: this.meetingId,
      participantName: this.userName
    });
  }

  updateParticipants(participants) {
    // Keep local participant if not in server list
    const localParticipant = this.participants.get(this.socket.id);
    
    this.participants.clear();
    participants.forEach(p => {
      this.participants.set(p.socketId, p);
    });

    // Ensure local participant is always present
    if (localParticipant && !this.participants.has(this.socket.id)) {
      this.participants.set(this.socket.id, localParticipant);
    }

    this.renderParticipants();
    this.updateParticipantCount();
    if (this.participantsPanelOpen) {
      this.renderParticipantsList();
    }
  }

  renderParticipants() {
    const mainVideoSection = document.getElementById('mainVideoSection');
    const secondaryVideosSection = document.getElementById('secondaryVideosSection');
    
    if (!mainVideoSection || !secondaryVideosSection) return;
    
    // Clear existing videos
    mainVideoSection.innerHTML = '';
    secondaryVideosSection.innerHTML = '';

    const participantArray = Array.from(this.participants.values());
    
    participantArray.forEach((participant, index) => {
      const videoWrapper = this.createVideoWrapper(participant);
      
      if ((participant.isSpotlighted || participant.socketId === this.pinnedParticipant) && this.currentView === 'sidebar') {
        videoWrapper.classList.add('main-video');
        videoWrapper.setAttribute('data-main-video', 'true');
        mainVideoSection.appendChild(videoWrapper);
      } else {
        secondaryVideosSection.appendChild(videoWrapper);
      }
    });
  }

  createVideoWrapper(participant) {
    const wrapper = document.createElement('div');
    wrapper.className = 'video-wrapper';
    wrapper.dataset.socketId = participant.socketId;
    
    if (participant.isSpotlighted || participant.socketId === this.pinnedParticipant) {
      wrapper.setAttribute('data-main-video', 'true');
    }

    const dropdownOptions = this.getDropdownOptions(participant);
    
    wrapper.innerHTML = `
      <video class="video-frame" autoplay playsinline ${participant.socketId === this.socket.id ? 'muted' : ''}></video>
      <div class="video-controls">
        <button class="menu-dots">⋮</button>
        <div class="dropdown-menu">
          ${dropdownOptions}
        </div>
      </div>
      <div class="participant-name">${participant.name}${participant.isHost ? ' (Host)' : ''}${participant.isCoHost ? ' (Co-Host)' : ''}</div>
      ${participant.isSpotlighted ? '<div class="spotlight-badge"><i class="fas fa-star"></i></div>' : ''}
      ${participant.socketId === this.pinnedParticipant ? '<div class="pin-badge"><i class="fas fa-thumbtack"></i></div>' : ''}
      ${participant.isMuted ? '<div class="audio-indicator"><i class="fas fa-microphone-slash"></i></div>' : ''}
    `;

    this.bindVideoWrapperEvents(wrapper, participant);
    
    // Attach video stream
    setTimeout(() => {
      const video = wrapper.querySelector('.video-frame');
      if (participant.socketId === this.socket.id) {
        // Local video
        if (this.webrtc.isScreenSharing && this.webrtc.screenStream) {
          video.srcObject = this.webrtc.screenStream;
        } else if (this.webrtc.localStream) {
          video.srcObject = this.webrtc.localStream;
        }
        video.play().catch(e => console.error('Error playing local video:', e));
      } else {
        // Remote video
        const remoteStream = this.webrtc.getRemoteStream(participant.socketId);
        if (remoteStream) {
          video.srcObject = remoteStream;
          video.play().catch(e => console.error('Error playing remote video:', e));
        }
      }
    }, 100);
    
    return wrapper;
  }

  getDropdownOptions(participant) {
    let options = [];
    
    if (participant.socketId === this.pinnedParticipant) {
      options.push('<button data-action="unpin">Unpin</button>');
    } else {
      options.push('<button data-action="pin">Pin</button>');
    }
    
    return options.join('');
  }

  bindVideoWrapperEvents(wrapper, participant) {
    // Double click to pin
    wrapper.addEventListener('dblclick', () => {
      if (participant.socketId !== this.pinnedParticipant) {
        this.pinParticipant(participant.socketId);
      }
    });

    // Dropdown menu actions
    const dropdownButtons = wrapper.querySelectorAll('.dropdown-menu button');
    dropdownButtons.forEach(button => {
      button.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = button.dataset.action;
        this.handleParticipantAction(action, participant.socketId);
      });
    });
  }

  handleParticipantAction(action, socketId) {
    switch(action) {
      case 'pin':
        this.pinParticipant(socketId);
        break;
      case 'unpin':
        this.unpinParticipant();
        break;
    }
  }

  pinParticipant(socketId) {
    this.pinnedParticipant = socketId;
    this.socket.emit('pin-participant', { targetSocketId: socketId });
    this.renderParticipants();
  }

  unpinParticipant() {
    this.pinnedParticipant = null;
    this.renderParticipants();
  }

  handleParticipantPinned(pinnedSocketId) {
    this.pinnedParticipant = pinnedSocketId;
    this.renderParticipants();
  }

  handleSpotlightChange(spotlightedSocketId) {
    this.spotlightedParticipant = spotlightedSocketId;
    this.renderParticipants();
    if (this.participantsPanelOpen) {
      this.renderParticipantsList();
    }
  }

  handleSpotlightRemoved() {
    this.spotlightedParticipant = null;
    this.renderParticipants();
    if (this.participantsPanelOpen) {
      this.renderParticipantsList();
    }
  }

  handleForceMute(isMuted) {
    const micBtn = document.getElementById('micBtn');
    if (micBtn) {
      micBtn.setAttribute('data-active', !isMuted);
      const icon = micBtn.querySelector('i');
      if (icon) {
        icon.className = isMuted ? 'fas fa-microphone-slash' : 'fas fa-microphone';
      }
    }
    
    this.webrtc.toggleAudio(!isMuted);
    this.showToast(isMuted ? 'You have been muted by the host' : 'You have been unmuted by the host', 'info');
  }

  removeParticipantVideo(socketId) {
    const wrapper = document.querySelector(`[data-socket-id="${socketId}"]`);
    if (wrapper) {
      wrapper.style.transition = 'all 0.3s ease';
      wrapper.style.opacity = '0';
      wrapper.style.transform = 'scale(0.8)';
      setTimeout(() => wrapper.remove(), 300);
    }
  }

  updateParticipantAudio(socketId, isMuted) {
    const wrapper = document.querySelector(`[data-socket-id="${socketId}"]`);
    if (wrapper) {
      let audioIndicator = wrapper.querySelector('.audio-indicator');
      if (isMuted && !audioIndicator) {
        audioIndicator = document.createElement('div');
        audioIndicator.className = 'audio-indicator';
        audioIndicator.innerHTML = '<i class="fas fa-microphone-slash"></i>';
        wrapper.appendChild(audioIndicator);
      } else if (!isMuted && audioIndicator) {
        audioIndicator.remove();
      }
    }
  }

  toggleView() {
    const videoContainer = document.getElementById('videoContainer');
    const viewToggleIcon = document.getElementById('viewToggleIcon');
    const viewToggleText = document.getElementById('viewToggleText');
    
    if (!videoContainer) return;
    
    if (this.currentView === 'sidebar') {
      this.currentView = 'grid';
      videoContainer.classList.remove('sidebar-view');
      videoContainer.classList.add('grid-view');
      if (viewToggleIcon) viewToggleIcon.className = 'fas fa-columns';
      if (viewToggleText) viewToggleText.textContent = 'Sidebar View';
    } else {
      this.currentView = 'sidebar';
      videoContainer.classList.remove('grid-view');
      videoContainer.classList.add('sidebar-view');
      if (viewToggleIcon) viewToggleIcon.className = 'fas fa-th';
      if (viewToggleText) viewToggleText.textContent = 'Grid View';
    }
    
    this.renderParticipants();
  }

  async toggleMic(button) {
    const isActive = button.getAttribute('data-active') === 'true';
    button.setAttribute('data-active', !isActive);
    
    const icon = button.querySelector('i');
    if (icon) {
      icon.className = isActive ? 'fas fa-microphone-slash' : 'fas fa-microphone';
    }
    
    await this.webrtc.toggleAudio(!isActive);
    this.socket.emit('toggle-mic', { isMuted: isActive });
  }

  async toggleCamera(button) {
    const isActive = button.getAttribute('data-active') === 'true';
    button.setAttribute('data-active', !isActive);
    
    const icon = button.querySelector('i');
    if (icon) {
      icon.className = isActive ? 'fas fa-video-slash' : 'fas fa-video';
    }
    
    await this.webrtc.toggleVideo(!isActive);
    this.socket.emit('toggle-camera', { isCameraOff: isActive });
  }

  async toggleScreenShare(button) {
    const isActive = button.getAttribute('data-active') === 'true';
    
    if (isActive) {
      await this.webrtc.stopScreenShare();
      button.setAttribute('data-active', 'false');
      this.socket.emit('stop-screen-share');
    } else {
      try {
        await this.webrtc.startScreenShare();
        button.setAttribute('data-active', 'true');
        this.socket.emit('start-screen-share', { streamId: 'screen' });
      } catch (error) {
        console.error('Failed to start screen share:', error);
        this.showToast('Failed to start screen sharing', 'error');
      }
    }
  }

  updateParticipantCount() {
    const count = this.participants.size;
    const participantCount = document.getElementById('participantCount');
    if (participantCount) {
      participantCount.textContent = count;
    }
  }

  updateMeetingTitle() {
    const meetingTitle = document.getElementById('meetingTitle');
    if (meetingTitle) {
      meetingTitle.textContent = `Meeting ${this.meetingId}`;
    }
  }

  updateTime() {
    const timeElement = document.getElementById('meetingTime');
    if (timeElement) {
      const now = new Date();
      const timeString = now.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: true 
      });
      timeElement.textContent = timeString;
    }
    
    setTimeout(() => this.updateTime(), 60000);
  }

  showMeetingLockedModal(message) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h3>Meeting Locked</h3>
        </div>
        <div class="modal-body">
          <p>${message}</p>
        </div>
        <div class="modal-footer">
          <button class="btn btn-primary" onclick="window.location.href='/dashboard'">Go to Dashboard</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  showKickedModal() {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h3>Removed from Meeting</h3>
        </div>
        <div class="modal-body">
          <p>You have been removed from the meeting by the host.</p>
        </div>
        <div class="modal-footer">
          <button class="btn btn-primary" onclick="window.location.href='/dashboard'">Go to Dashboard</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  showMeetingEndedModal() {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h3>Meeting Ended</h3>
        </div>
        <div class="modal-body">
          <p>The meeting has been ended by the host.</p>
        </div>
        <div class="modal-footer">
          <button class="btn btn-primary" onclick="window.location.href='/dashboard'">Go to Dashboard</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast ${type === 'error' ? 'error' : type === 'info' ? 'info' : ''}`;
    toast.textContent = message;
    
    document.body.appendChild(toast);
    
    setTimeout(() => toast.classList.add('show'), 100);
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  leaveMeeting() {
    if (confirm('Are you sure you want to leave the meeting?')) {
      this.socket.disconnect();
      window.location.href = '/dashboard';
    }
  }
}

// Close dropdowns when clicking outside
document.addEventListener('click', () => {
  document.querySelectorAll('.participant-dropdown').forEach(dropdown => {
    dropdown.classList.remove('show');
  });
});

// Initialize the join meeting
document.addEventListener('DOMContentLoaded', () => {
  new JoinMeeting();
});

// Make participant name globally accessible
var myName = null;
window.myName = null;

// Store global reference when meeting initializes  
window.addEventListener('load', function() {
  setTimeout(() => {
    if (window.joinMeetingInstance && window.joinMeetingInstance.userName) {
      myName = window.joinMeetingInstance.userName;
      window.myName = myName;
      console.log('myName set to:', myName);
    }
  }, 3000); // Wait 3 seconds for everything to load
});