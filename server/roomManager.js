const { createId, createReconnectToken, createRoomCode, normalizeName } = require('./utils');
const { PLAYER_COLORS } = require('./gameEngine');

const MAX_PLAYERS = 4;
const MIN_PLAYERS = 2;

class RoomManager {
  constructor() {
    this.rooms = new Map();
    this.tokens = new Map();
  }

  createRoom({ name, socketId, debug = false }) {
    const cleanName = normalizeName(name);
    if (!cleanName) return { ok: false, reason: 'Enter a Pounce Name.' };
    const code = createRoomCode(new Set(this.rooms.keys()));
    const player = this.createPlayer(cleanName, socketId, 0);
    const room = {
      code,
      hostId: player.id,
      phase: 'lobby',
      round: 1,
      players: [player],
      foundations: [],
      lastRoundResults: null,
      lastPouncePlayerId: null,
      winner: null,
      debug: Boolean(debug)
    };
    this.rooms.set(code, room);
    this.tokens.set(player.reconnectToken, { roomCode: code, playerId: player.id });
    return { ok: true, room, player };
  }

  joinRoom({ code, name, socketId }) {
    const room = this.rooms.get(String(code || '').trim().toUpperCase());
    if (!room) return { ok: false, reason: 'That room code does not exist.' };
    if (room.phase !== 'lobby') return { ok: false, reason: 'That game is already in progress.' };
    if (room.players.length >= MAX_PLAYERS) return { ok: false, reason: 'That room is full.' };
    const cleanName = normalizeName(name);
    if (!cleanName) return { ok: false, reason: 'Enter a Pounce Name.' };
    if (room.players.some((player) => player.name.toLowerCase() === cleanName.toLowerCase())) {
      return { ok: false, reason: 'That Pounce Name is already taken in this room.' };
    }
    const player = this.createPlayer(cleanName, socketId, room.players.length);
    room.players.push(player);
    this.tokens.set(player.reconnectToken, { roomCode: room.code, playerId: player.id });
    return { ok: true, room, player };
  }

  createPlayer(name, socketId, seat) {
    return {
      id: createId('player'),
      socketId,
      reconnectToken: createReconnectToken(),
      name,
      score: 0,
      connected: true,
      ready: false,
      seat,
      markerColor: PLAYER_COLORS[seat % PLAYER_COLORS.length],
      roundState: null
    };
  }

  getRoom(code) {
    return this.rooms.get(String(code || '').trim().toUpperCase()) || null;
  }

  getRoomBySocket(socketId) {
    for (const room of this.rooms.values()) {
      const player = room.players.find((candidate) => candidate.socketId === socketId);
      if (player) return { room, player };
    }
    return null;
  }

  reconnect({ token, socketId }) {
    const mapped = this.tokens.get(token);
    if (!mapped) return { ok: false, reason: 'Reconnect token not found.' };
    const room = this.rooms.get(mapped.roomCode);
    if (!room) return { ok: false, reason: 'Room no longer exists.' };
    const player = room.players.find((candidate) => candidate.id === mapped.playerId);
    if (!player) return { ok: false, reason: 'Player no longer exists.' };
    player.socketId = socketId;
    player.connected = true;
    return { ok: true, room, player };
  }

  canStart(room) {
    const connected = room.players.filter((player) => player.connected).length;
    if (connected < MIN_PLAYERS && !room.debug) return { ok: false, reason: 'At least 2 players are required.' };
    if (connected > MAX_PLAYERS) return { ok: false, reason: 'A room can have at most 4 players.' };
    if (room.phase !== 'lobby' && room.phase !== 'roundResults') return { ok: false, reason: 'The game cannot start from this state.' };
    return { ok: true };
  }

  markDisconnected(socketId) {
    const found = this.getRoomBySocket(socketId);
    if (!found) return null;
    const { room, player } = found;
    player.connected = false;
    player.socketId = null;
    if (room.hostId === player.id) this.transferHost(room);
    setTimeout(() => this.cleanupRoom(room.code), 10 * 60 * 1000);
    return found;
  }

  removePlayer(room, playerId) {
    const index = room.players.findIndex((player) => player.id === playerId);
    if (index === -1) return;
    const [player] = room.players.splice(index, 1);
    this.tokens.delete(player.reconnectToken);
    if (room.hostId === player.id) this.transferHost(room);
    room.players.forEach((candidate, seat) => {
      candidate.seat = seat;
      candidate.markerColor = PLAYER_COLORS[seat % PLAYER_COLORS.length];
    });
    this.cleanupRoom(room.code);
  }

  transferHost(room) {
    const next = room.players.find((player) => player.connected);
    room.hostId = next ? next.id : null;
  }

  cleanupRoom(code) {
    const room = this.rooms.get(code);
    if (!room) return;
    if (room.players.length === 0 || room.players.every((player) => !player.connected)) {
      room.players.forEach((player) => this.tokens.delete(player.reconnectToken));
      this.rooms.delete(code);
    }
  }

  resetGame(room) {
    room.phase = 'lobby';
    room.round = 1;
    room.foundations = [];
    room.lastRoundResults = null;
    room.lastPouncePlayerId = null;
    room.winner = null;
    room.players.forEach((player) => {
      player.score = 0;
      player.ready = false;
      player.roundState = null;
    });
  }
}

module.exports = {
  RoomManager,
  MAX_PLAYERS,
  MIN_PLAYERS
};
