const test = require('node:test');
const assert = require('node:assert/strict');
const { RoomManager } = require('../server/roomManager');

function makeRoom(manager, names) {
  const created = manager.createRoom({ name: names[0], socketId: `${names[0]}-socket` });
  assert.equal(created.ok, true);
  const room = created.room;
  names.slice(1).forEach((name) => {
    const joined = manager.joinRoom({ code: room.code, name, socketId: `${name}-socket` });
    assert.equal(joined.ok, true);
  });
  return room;
}

test('explicit leave closes a room when only one player remains', () => {
  const manager = new RoomManager();
  const room = makeRoom(manager, ['Bippy', 'Gassy']);
  const survivorToken = room.players[1].reconnectToken;

  const result = manager.removePlayer(room, room.players[0].id);

  assert.equal(result.ok, true);
  assert.equal(result.closed, true);
  assert.equal(manager.getRoom(room.code), null);
  assert.equal(manager.tokens.has(survivorToken), false);
});

test('explicit leave keeps a room open when two or more players remain', () => {
  const manager = new RoomManager();
  const room = makeRoom(manager, ['Bippy', 'Gassy', 'Cringy']);
  const leavingId = room.players[0].id;

  const result = manager.removePlayer(room, leavingId);

  assert.equal(result.ok, true);
  assert.equal(result.closed, false);
  assert.equal(manager.getRoom(room.code), room);
  assert.equal(room.players.length, 2);
  assert.equal(room.hostId, room.players[0].id);
  assert.deepEqual(room.players.map((player) => player.seat), [0, 1]);
});
