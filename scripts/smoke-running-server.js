const { io } = require('socket.io-client');

function once(socket, event, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), timeout);
    socket.once('connect_error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function waitFor(socket, event, predicate, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeout);
    function handler(payload) {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    }
    socket.on(event, handler);
  });
}

async function main() {
  const url = process.env.POUNCE_URL || 'http://localhost:3000';
  const a = io(url, { reconnection: false });
  const b = io(url, { reconnection: false });
  try {
    await Promise.all([once(a, 'connect'), once(b, 'connect')]);
    a.emit('room:create', { name: 'B-Bippy', debug: true });
    const created = await once(a, 'room:created');
    b.emit('room:join', { name: 'Gassy', code: created.code });
    const joined = await once(b, 'room:joined');

    let update = await once(a, 'room:update');
    if (update.players.length < 2) update = await once(a, 'room:update');

    a.emit('game:start');
    await once(a, 'game:started');
    const [publicState, privateA, privateB] = await Promise.all([
      once(a, 'game:publicState'),
      once(a, 'game:privateState'),
      once(b, 'game:privateState')
    ]);

    b.emit('stock:draw');
    await once(b, 'stock:updated');

    const emptyReady = waitFor(a, 'game:privateState', (state) => state.roundState && state.roundState.canPounce);
    a.emit('debug:emptyPounce');
    await emptyReady;
    a.emit('pounce:call');
    const roundResults = await once(a, 'round:results');

    a.emit('round:start');
    const nextRound = await once(a, 'round:started');

    const scoreReady = waitFor(a, 'game:publicState', (state) => state.players.some((player) => player.id === created.playerId && player.score === 100));
    a.emit('debug:setScore', { playerId: created.playerId, score: 100 });
    await scoreReady;
    const finalEmptyReady = waitFor(a, 'game:privateState', (state) => state.roundState && state.roundState.canPounce);
    a.emit('debug:emptyPounce');
    await finalEmptyReady;
    a.emit('pounce:call');
    const finished = await once(a, 'game:finished');

    console.log(JSON.stringify({
      url,
      code: created.code,
      joined: joined.code,
      players: update.players.length,
      phase: publicState.phase,
      pounceA: privateA.roundState.pounceCount,
      pounceB: privateB.roundState.pounceCount,
      roundResults: roundResults.results.length,
      nextRound: nextRound.round,
      winner: finished.winner.name,
      total: finished.winner.total
    }, null, 2));
  } finally {
    a.close();
    b.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
