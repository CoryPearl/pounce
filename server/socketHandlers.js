const engine = require('./gameEngine');

function registerSocketHandlers(io, roomManager) {
  function emitRoom(room) {
    io.to(room.code).emit('room:update', engine.publicState(room));
  }

  function emitStates(room) {
    io.to(room.code).emit('game:publicState', engine.publicState(room));
    room.players.forEach((player) => {
      if (player.socketId) {
        io.to(player.socketId).emit('game:privateState', engine.privateState(player));
      }
    });
  }

  function emitReject(socket, result) {
    socket.emit('move:rejected', { reason: result.reason || 'Move rejected.' });
  }

  function updateStockDrawVote(room, player, wantsDrawOne) {
    if (!room.stockDrawVotes) room.stockDrawVotes = new Set();
    if (room.stockDrawCount === 1) {
      return { ok: true, changed: false };
    }
    if (wantsDrawOne) {
      room.stockDrawVotes.add(player.id);
    } else {
      room.stockDrawVotes.delete(player.id);
    }
    const connectedIds = room.players.filter((candidate) => candidate.connected).map((candidate) => candidate.id);
    const unanimous = connectedIds.length > 0 && connectedIds.every((playerId) => room.stockDrawVotes.has(playerId));
    if (unanimous) {
      room.stockDrawCount = 1;
      return { ok: true, changed: true };
    }
    return { ok: true, changed: false };
  }

  function updateEndRoundVote(room, player, wantsEndRound) {
    if (!room.endRoundVotes) room.endRoundVotes = new Set();
    if (room.phase !== 'playing') {
      return { ok: false, reason: 'The round is not active.' };
    }
    if (wantsEndRound) {
      room.endRoundVotes.add(player.id);
    } else {
      room.endRoundVotes.delete(player.id);
    }
    const connectedIds = room.players.filter((candidate) => candidate.connected).map((candidate) => candidate.id);
    const unanimous = connectedIds.length > 0 && connectedIds.every((playerId) => room.endRoundVotes.has(playerId));
    return { ok: true, changed: unanimous };
  }

  function withPlayer(socket, callback) {
    const found = roomManager.getRoomBySocket(socket.id);
    if (!found) {
      socket.emit('room:error', { reason: 'You are not in a room.' });
      return;
    }
    callback(found.room, found.player);
  }

  io.on('connection', (socket) => {
    socket.on('room:reconnect', ({ token } = {}) => {
      const result = roomManager.reconnect({ token, socketId: socket.id });
      if (!result.ok) {
        socket.emit('room:error', { reason: result.reason });
        return;
      }
      socket.join(result.room.code);
      socket.emit('room:joined', {
        code: result.room.code,
        playerId: result.player.id,
        token: result.player.reconnectToken
      });
      emitRoom(result.room);
      emitStates(result.room);
    });

    socket.on('room:create', ({ name, debug } = {}) => {
      const result = roomManager.createRoom({ name, socketId: socket.id, debug });
      if (!result.ok) {
        socket.emit('room:error', { reason: result.reason });
        return;
      }
      socket.join(result.room.code);
      socket.emit('room:created', {
        code: result.room.code,
        playerId: result.player.id,
        token: result.player.reconnectToken
      });
      emitRoom(result.room);
    });

    socket.on('room:join', ({ code, name } = {}) => {
      const result = roomManager.joinRoom({ code, name, socketId: socket.id });
      if (!result.ok) {
        socket.emit('room:error', { reason: result.reason });
        return;
      }
      socket.join(result.room.code);
      socket.emit('room:joined', {
        code: result.room.code,
        playerId: result.player.id,
        token: result.player.reconnectToken
      });
      emitRoom(result.room);
    });

    socket.on('room:leave', () => {
      withPlayer(socket, (room, player) => {
        const roomCode = room.code;
        const result = roomManager.removePlayer(room, player.id);
        socket.leave(roomCode);
        socket.emit('room:left');
        if (result.closed) {
          io.to(roomCode).emit('room:closed', {
            reason: 'The room closed because only one player was left.'
          });
          io.in(roomCode).socketsLeave(roomCode);
          return;
        }
        emitRoom(room);
        emitStates(room);
      });
    });

    socket.on('room:setMatchGoal', ({ goal } = {}) => {
      withPlayer(socket, (room, player) => {
        const result = roomManager.setMatchGoal(room, player.id, goal);
        if (!result.ok) {
          socket.emit('room:error', { reason: result.reason });
          return;
        }
        emitRoom(room);
        emitStates(room);
      });
    });

    socket.on('game:start', () => {
      withPlayer(socket, (room, player) => {
        if (room.hostId !== player.id) {
          socket.emit('room:error', { reason: 'Only the host can start.' });
          return;
        }
        const allowed = roomManager.canStart(room);
        if (!allowed.ok) {
          socket.emit('room:error', { reason: allowed.reason });
          return;
        }
        const options = room.debug ? { pounceSize: 2 } : {};
        engine.startRound(room, options);
        io.to(room.code).emit('game:started', engine.publicState(room));
        emitStates(room);
      });
    });

    socket.on('round:start', () => {
      withPlayer(socket, (room, player) => {
        if (room.hostId !== player.id) {
          socket.emit('room:error', { reason: 'Only the host can start the next round.' });
          return;
        }
        if (room.phase !== 'roundResults') {
          socket.emit('room:error', { reason: 'The next round is not ready.' });
          return;
        }
        room.round += 1;
        engine.startRound(room, room.debug ? { pounceSize: 2 } : {});
        io.to(room.code).emit('round:started', engine.publicState(room));
        emitStates(room);
      });
    });

    socket.on('round:ready', () => {
      withPlayer(socket, (room, player) => {
        player.ready = true;
        emitRoom(room);
      });
    });

    socket.on('card:foundation', (action = {}) => {
      withPlayer(socket, (room, player) => {
        const result = engine.playToFoundation(room, player.id, action);
        if (!result.ok) {
          emitReject(socket, result);
          return;
        }
        io.to(room.code).emit('card:moved', {
          kind: 'foundation',
          playerId: player.id,
          cardId: result.card.id,
          foundationId: result.foundationId
        });
        emitStates(room);
      });
    });

    socket.on('card:tableau', (action = {}) => {
      withPlayer(socket, (room, player) => {
        const result = engine.playToTableau(room, player.id, action);
        if (!result.ok) {
          emitReject(socket, result);
          return;
        }
        io.to(room.code).emit('card:moved', { kind: 'tableau', playerId: player.id, cardId: result.card.id });
        emitStates(room);
      });
    });

    socket.on('card:tableauStack', (action = {}) => {
      withPlayer(socket, (room, player) => {
        const result = engine.moveTableauStack(room, player.id, action);
        if (!result.ok) {
          emitReject(socket, result);
          return;
        }
        io.to(room.code).emit('card:moved', { kind: 'tableauStack', playerId: player.id });
        emitStates(room);
      });
    });

    socket.on('stock:draw', () => {
      withPlayer(socket, (room, player) => {
        const result = engine.drawStock(room, player.id);
        if (!result.ok) {
          emitReject(socket, result);
          return;
        }
        socket.emit('stock:updated', result);
        emitStates(room);
      });
    });

    socket.on('stock:voteDrawOne', ({ vote } = {}) => {
      withPlayer(socket, (room, player) => {
        const result = updateStockDrawVote(room, player, Boolean(vote));
        if (result.changed) {
          io.to(room.code).emit('stock:drawModeChanged', { drawCount: room.stockDrawCount });
        }
        emitStates(room);
      });
    });

    socket.on('round:voteEndEarly', ({ vote } = {}) => {
      withPlayer(socket, (room, player) => {
        const voteResult = updateEndRoundVote(room, player, Boolean(vote));
        if (!voteResult.ok) {
          socket.emit('room:error', { reason: voteResult.reason });
          return;
        }
        if (voteResult.changed) {
          const result = engine.finishRoundEarly(room);
          io.to(room.code).emit('round:endedEarly', { reason: 'Vote passed' });
          io.to(room.code).emit('round:results', { results: result.results, winner: result.winner, reason: result.reason });
          if (room.phase === 'finished') {
            io.to(room.code).emit('game:finished', { winner: result.winner, results: result.results });
          }
        }
        emitStates(room);
      });
    });

    socket.on('pounce:call', () => {
      withPlayer(socket, (room, player) => {
        const result = engine.finishRound(room, player.id);
        if (!result.ok) {
          emitReject(socket, result);
          return;
        }
        io.to(room.code).emit('pounce:called', { playerId: player.id, playerName: player.name });
        io.to(room.code).emit('round:results', { results: result.results, winner: result.winner });
        if (room.phase === 'finished') {
          io.to(room.code).emit('game:finished', { winner: result.winner, results: result.results });
        }
        emitStates(room);
      });
    });

    socket.on('game:restart', () => {
      withPlayer(socket, (room, player) => {
        if (room.hostId !== player.id) {
          socket.emit('room:error', { reason: 'Only the host can restart.' });
          return;
        }
        roomManager.resetGame(room);
        emitRoom(room);
        emitStates(room);
      });
    });

    socket.on('debug:state', () => {
      withPlayer(socket, (room) => {
        if (!room.debug) return;
        socket.emit('debug:state', room);
      });
    });

    socket.on('debug:emptyPounce', () => {
      withPlayer(socket, (room, player) => {
        if (!room.debug || room.phase !== 'playing') return;
        player.roundState.pouncePile = [];
        emitStates(room);
      });
    });

    socket.on('debug:setScore', ({ playerId, score } = {}) => {
      withPlayer(socket, (room, player) => {
        if (!room.debug || room.hostId !== player.id) return;
        const target = room.players.find((candidate) => candidate.id === playerId);
        if (!target) return;
        target.score = Number(score) || 0;
        emitStates(room);
      });
    });

    socket.on('disconnect', () => {
      const found = roomManager.markDisconnected(socket.id);
      if (!found) return;
      io.to(found.room.code).emit('player:disconnected', {
        playerId: found.player.id,
        playerName: found.player.name
      });
      emitRoom(found.room);
      emitStates(found.room);
    });
  });
}

module.exports = registerSocketHandlers;
