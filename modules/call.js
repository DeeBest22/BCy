articipantInfo.meetingId}`);
    });

    socket.on('raise-hand', () => {
      const participantInfo = participants.get(socket.id);
      if (!participantInfo) return;

      const meeting = meetings.get(participantInfo.meetingId);
      if (!meeting) return;

      const participant = meeting.participants.get(socket.id);
      if (!participant) return;

      meeting.raiseHand(socket.id);

      io.to(participantInfo.meetingId).emit('hand-raised', {
        socketId: socket.id,
        participantName: participant.name,
        raisedHands: meeting.getRaisedHands()
      });

      console.log(`${participant.name} raised hand in meeting ${participantInfo.meetingId}`);
    });

    socket.on('lower-hand', () => {
      const participantInfo = participants.get(socket.id);
      if (!participantInfo) return;

      const meeting = meetings.get(participantInfo.meetingId);
      if (!meeting) return;

      const participant = meeting.participants.get(socket.id);
      if (!participant) return;

      meeting.lowerHand(socket.id);

      io.to(participantInfo.meetingId).emit('hand-lowered', {
        socketId: socket.id,
        participantName: participant.name,
        raisedHands: meeting.getRaisedHands()
      });

      console.log(`${participant.name} lowered hand in meeting ${participantInfo.meetingId}`);
    });

    socket.on('start-screen-share', (data) => {
      const participantInfo = participants.get(socket.id);
      if (!participantInfo) return;
      
      const meeting = meetings.get(participantInfo.meetingId);
      if (!meeting) return;

      meeting.addScreenShare(socket.id, data.streamId);
      
      socket.to(participantInfo.meetingId).emit('screen-share-started', {
        participantId: socket.id,
        streamId: data.streamId,
        participantName: meeting.participants.get(socket.id)?.name
      });

      console.log(`Screen share started by ${socket.id} in meeting ${participantInfo.meetingId}`);
    });

    socket.on('stop-screen-share', () => {
      const participantInfo = participants.get(socket.id);
      if (!participantInfo) return;
      
      const meeting = meetings.get(participantInfo.meetingId);
      if (!meeting) return;

      meeting.removeScreenShare(socket.id);
      
      socket.to(participantInfo.meetingId).emit('screen-share-stopped', {
        participantId: socket.id
      });

      console.log(`Screen share stopped by ${socket.id} in meeting ${participantInfo.meetingId}`);
    });

    socket.on('spotlight-participant', (data) => {
      const { targetSocketId } = data;
      const participantInfo = participants.get(socket.id);
      
      if (!participantInfo) return;
      
      const meeting = meetings.get(participantInfo.meetingId);
      if (!meeting || !meeting.canPerformHostAction(socket.id)) {
        socket.emit('action-error', { message: 'Insufficient permissions' });
        return;
      }

      meeting.spotlightParticipant(targetSocketId);
      
      io.to(participantInfo.meetingId).emit('participant-spotlighted', {
        spotlightedParticipant: targetSocketId,
        participants: Array.from(meeting.participants.values()),
        reason: 'manual'
      });

      console.log(`Participant ${targetSocketId} spotlighted in meeting ${participantInfo.meetingId}`);
    });

    socket.on('remove-spotlight', () => {
      const participantInfo = participants.get(socket.id);
      
      if (!participantInfo) return;
      
      const meeting = meetings.get(participantInfo.meetingId);
      if (!meeting || !meeting.canPerformHostAction(socket.id)) {
        socket.emit('action-error', { message: 'Insufficient permissions' });
        return;
      }

      meeting.removeSpotlight();
      
      io.to(participantInfo.meetingId).emit('spotlight-removed', {
        participants: Array.from(meeting.participants.values())
      });

      console.log(`Spotlight removed in meeting ${participantInfo.meetingId}`);
    });

    socket.on('pin-participant', (data) => {
      const { targetSocketId } = data;
      const participantInfo = participants.get(socket.id);
      
      if (!participantInfo) return;
      
      socket.emit('participant-pinned', {
        pinnedParticipant: targetSocketId
      });

      console.log(`Participant ${socket.id} pinned ${targetSocketId}`);
    });

    socket.on('mute-participant', (data) => {
      const { targetSocketId } = data;
      const participantInfo = participants.get(socket.id);
      
      if (!participantInfo) return;
      
      const meeting = meetings.get(participantInfo.meetingId);
      if (!meeting || !meeting.canPerformHostAction(socket.id)) {
        socket.emit('action-error', { message: 'Insufficient permissions' });
        return;
      }

      const targetParticipant = meeting.participants.get(targetSocketId);
      if (targetParticipant) {
        targetParticipant.isMuted = !targetParticipant.isMuted;
        
        io.to(targetSocketId).emit('force-mute', {
          isMuted: targetParticipant.isMuted
        });
        
        io.to(participantInfo.meetingId).emit('participant-muted', {
          targetSocketId,
          isMuted: targetParticipant.isMuted,
          participants: Array.from(meeting.participants.values())
        });

        console.log(`Participant ${targetSocketId} ${targetParticipant.isMuted ? 'muted' : 'unmuted'} in meeting ${participantInfo.meetingId}`);
      }
    });

    socket.on('make-cohost', (data) => {
      const { targetSocketId } = data;
      const participantInfo = participants.get(socket.id);
      
      if (!participantInfo) return;
      
      const meeting = meetings.get(participantInfo.meetingId);
      if (!meeting || !meeting.canMakeCoHost(socket.id)) {
        socket.emit('action-error', { message: 'Only host can make co-hosts' });
        return;
      }

      meeting.makeCoHost(targetSocketId);
      
      io.to(targetSocketId).emit('made-cohost');
      
      io.to(participantInfo.meetingId).emit('cohost-assigned', {
        targetSocketId,
        participants: Array.from(meeting.participants.values())
      });

      console.log(`Participant ${targetSocketId} made co-host in meeting ${participantInfo.meetingId}`);
    });

    socket.on('kick-participant', (data) => {
      const { targetSocketId } = data;
      const participantInfo = participants.get(socket.id);
      
      if (!participantInfo) return;
      
      const meeting = meetings.get(participantInfo.meetingId);
      if (!meeting) return;

      const requester = meeting.participants.get(socket.id);
      const target = meeting.participants.get(targetSocketId);
      
      if (!requester || !target) return;
      
      if (!requester.isHost || target.isCoHost) {
        socket.emit('action-error', { message: 'Cannot kick this participant' });
        return;
      }

      meeting.removeParticipant(targetSocketId);
      participants.delete(targetSocketId);
      
      io.to(targetSocketId).emit('kicked-from-meeting');
      
      socket.to(participantInfo.meetingId).emit('participant-kicked', {
        targetSocketId,
        participants: Array.from(meeting.participants.values())
      });

      const targetSocket = io.sockets.sockets.get(targetSocketId);
      if (targetSocket) {
        targetSocket.leave(participantInfo.meetingId);
        targetSocket.disconnect();
      }

      console.log(`Participant ${targetSocketId} kicked from meeting ${participantInfo.meetingId}`);
    });

    socket.on('toggle-mic', (data) => {
      const { isMuted } = data;
      const participantInfo = participants.get(socket.id);
      
      if (!participantInfo) return;
      
      const meeting = meetings.get(participantInfo.meetingId);
      if (!meeting) return;

      const participant = meeting.participants.get(socket.id);
      if (participant) {
        participant.isMuted = isMuted;
        
        socket.to(participantInfo.meetingId).emit('participant-audio-changed', {
          socketId: socket.id,
          isMuted,
          participants: Array.from(meeting.participants.values())
        });
      }
    });

    socket.on('toggle-camera', (data) => {
      const { isCameraOff } = data;
      const participantInfo = participants.get(socket.id);
      
      if (!participantInfo) return;
      
      const meeting = meetings.get(participantInfo.meetingId);
      if (!meeting) return;

      const participant = meeting.participants.get(socket.id);
      if (participant) {
        participant.isCameraOff = isCameraOff;
        
        socket.to(participantInfo.meetingId).emit('participant-video-changed', {
          socketId: socket.id,
          isCameraOff,
          participants: Array.from(meeting.participants.values())
        });
      }
    });

    socket.on('disconnect', () => {
      const participantInfo = participants.get(socket.id);
      
      if (participantInfo) {
        const meeting = meetings.get(participantInfo.meetingId);
        
        if (meeting) {
          const participant = meeting.participants.get(socket.id);
          
          meeting.removeParticipant(socket.id);
          
          if (participantInfo.isHost) {
            socket.to(participantInfo.meetingId).emit('meeting-ended');
            
            meetings.delete(participantInfo.meetingId);
            
            console.log(`Meeting ${participantInfo.meetingId} ended - host disconnected`);
          } else {
            socket.to(participantInfo.meetingId).emit('participant-left', {
              socketId: socket.id,
              participantName: participant?.name,
              participants: Array.from(meeting.participants.values())
            });
            
            console.log(`Participant ${socket.id} left meeting ${participantInfo.meetingId}`);
          }
        }
        
        participants.delete(socket.id);
      }
      
      console.log('User disconnected:', socket.id);
    });

    // Handle meeting permission updates
    socket.on('update-meeting-permissions', (data) => {
      const participantInfo = participants.get(socket.id);
      if (!participantInfo) return;
      
      const meeting = meetings.get(participantInfo.meetingId);
      if (!meeting || !meeting.canPerformHostAction(socket.id)) {
        socket.emit('action-error', { message: 'Only host can change meeting permissions' });
        return;
      }

      const participant = meeting.participants.get(socket.id);
      if (!participant) return;

      // Update meeting permissions
      meeting.permissions = data.permissions;
      
      // Broadcast permission changes to all participants
      io.to(participantInfo.meetingId).emit('meeting-permissions-updated', {
        permissions: data.permissions,
        changedBy: participant.name
      });

      console.log(`Meeting permissions updated by ${participant.name} in meeting ${participantInfo.meetingId}:`, data.permissions);
    });
  });

  return { io, setupMeetingRoutes };
};