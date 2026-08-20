const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { io } = require('socket.io-client');

function once(socket, event) {
  return new Promise((resolve) => socket.once(event, resolve));
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

function waitForServer(proc, port) {
  return new Promise((resolve, reject) => {
    let stderr = '';
    let settled = false;
    function finish(fn, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    }
    const timer = setTimeout(() => finish(reject, new Error(`Server did not start in time. ${stderr}`)), 10000);
    proc.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    proc.on('exit', (code) => {
      const error = new Error(`Server exited before readiness with code ${code}. ${stderr}`);
      if (stderr.includes('listen EPERM')) error.code = 'EPERM';
      finish(reject, error);
    });

    async function poll() {
      try {
        const response = await fetch(`http://localhost:${port}/health`);
        if (response.ok) {
          finish(resolve);
          return;
        }
      } catch {
        // Keep polling until timeout.
      }
      if (settled) return;
      setTimeout(poll, 100);
    }
    poll();
  });
}

test('real Socket.IO clients can create, join, start, finish, continue, and finish match', async (t) => {
  const port = 3199;
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(() => proc.kill());
  try {
    await waitForServer(proc, port);
  } catch (error) {
    if (error.code === 'EPERM') {
      t.skip('Sandbox blocked binding a test HTTP server.');
      return;
    }
    throw error;
  }

  const a = io(`http://localhost:${port}`, { reconnection: false });
  const b = io(`http://localhost:${port}`, { reconnection: false });
  t.after(() => {
    a.close();
    b.close();
  });
  await Promise.all([once(a, 'connect'), once(b, 'connect')]);

  a.emit('room:create', { name: 'B-Bippy', debug: true });
  const created = await once(a, 'room:created');
  assert.match(created.code, /^[A-Z0-9]{4}$/);

  b.emit('room:join', { name: 'Gassy', code: created.code });
  const joined = await once(b, 'room:joined');
  assert.equal(joined.code, created.code);

  let roomUpdate = await once(a, 'room:update');
  if (roomUpdate.players.length < 2) roomUpdate = await once(a, 'room:update');
  assert.equal(roomUpdate.players.length, 2);

  a.emit('game:start');
  await once(a, 'game:started');
  const [publicA, privateA, privateB] = await Promise.all([
    once(a, 'game:publicState'),
    once(a, 'game:privateState'),
    once(b, 'game:privateState')
  ]);
  assert.equal(publicA.phase, 'playing');
  assert.equal(privateA.roundState.pounceCount, 2);
  assert.equal(privateB.roundState.pounceCount, 2);
  assert.notEqual(privateA.roundState.pounceTop.id, privateB.roundState.pounceTop.id);

  b.emit('stock:draw');
  const stock = await once(b, 'stock:updated');
  assert.equal(stock.ok, true);

  const emptyReady = waitFor(a, 'game:privateState', (state) => state.roundState && state.roundState.canPounce);
  a.emit('debug:emptyPounce');
  const emptied = await emptyReady;
  assert.equal(emptied.roundState.canPounce, true);
  a.emit('pounce:call');
  const resultsPayload = await once(a, 'round:results');
  assert.equal(Array.isArray(resultsPayload.results), true);
  assert.equal(resultsPayload.results.length, 2);

  a.emit('round:start');
  const nextRound = await once(a, 'round:started');
  assert.equal(nextRound.round, 2);

  const scoreReady = waitFor(a, 'game:publicState', (state) => state.players.some((player) => player.id === created.playerId && player.score === 100));
  a.emit('debug:setScore', { playerId: created.playerId, score: 100 });
  await scoreReady;
  const finalEmptyReady = waitFor(a, 'game:privateState', (state) => state.roundState && state.roundState.canPounce);
  a.emit('debug:emptyPounce');
  await finalEmptyReady;
  a.emit('pounce:call');
  const finished = await once(a, 'game:finished');
  assert.equal(finished.winner.playerId, created.playerId);
});
