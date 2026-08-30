(function () {
  const socket = io();
  const names = ['B-Bippy', 'Gassy', 'Cringy', 'Bibbie', 'Card Bandit', 'Ace Bandit', 'Deck Destroyer', 'Pâté-Lady', 'King Crusher', 'Queen Machine'];
  const params = new URLSearchParams(window.location.search);
  const debug = params.get('debug') === 'true';

  const els = {
    setupPanel: document.getElementById('setupPanel'),
    createForm: document.getElementById('createForm'),
    joinForm: document.getElementById('joinForm'),
    createName: document.getElementById('createName'),
    joinName: document.getElementById('joinName'),
    joinCode: document.getElementById('joinCode'),
    randomCreate: document.getElementById('randomCreate'),
    randomJoin: document.getElementById('randomJoin'),
    roomPanel: document.getElementById('roomPanel'),
    roomCode: document.getElementById('roomCode'),
    copyCode: document.getElementById('copyCode'),
    playerList: document.getElementById('playerList'),
    startGame: document.getElementById('startGame'),
    startHint: document.getElementById('startHint'),
    matchSettings: document.getElementById('matchSettings'),
    goalMode: document.getElementById('goalMode'),
    customGoal: document.getElementById('customGoal'),
    goalHint: document.getElementById('goalHint'),
    connectionStatus: document.getElementById('connectionStatus'),
    howToPlay: document.getElementById('howToPlay')
  };

  let me = {
    playerId: localStorage.getItem('pouncePlayerId'),
    token: localStorage.getItem('pounceReconnectToken'),
    roomCode: localStorage.getItem('pounceRoomCode')
  };
  let latestRoom = null;

  function randomName() {
    return names[Math.floor(Math.random() * names.length)];
  }

  function saveSession(data) {
    me = { ...me, ...data };
    if (me.token) localStorage.setItem('pounceReconnectToken', me.token);
    if (me.playerId) localStorage.setItem('pouncePlayerId', me.playerId);
    if (me.roomCode) localStorage.setItem('pounceRoomCode', me.roomCode);
  }

  function goalLabel(goal) {
    return goal === null ? 'No point goal' : `First to ${goal} points wins`;
  }

  function goalFromControls() {
    if (els.goalMode.value === 'none') return null;
    if (els.goalMode.value === 'custom') return Number(els.customGoal.value);
    return Number(els.goalMode.value);
  }

  function syncGoalControls(room, isHost) {
    const goal = room.matchGoal === undefined ? 100 : room.matchGoal;
    const presetValues = ['50', '75', '100', '150', '200'];
    if (goal === null) {
      els.goalMode.value = 'none';
    } else if (presetValues.includes(String(goal))) {
      els.goalMode.value = String(goal);
    } else {
      els.goalMode.value = 'custom';
    }
    if (goal !== null) els.customGoal.value = goal;
    els.customGoal.classList.toggle('hidden', els.goalMode.value !== 'custom');
    els.goalHint.textContent = goal === null ? 'No goal. The host can keep starting new rounds.' : `${goalLabel(goal)}. Ties at the goal play another round.`;
    els.goalMode.disabled = !isHost;
    els.customGoal.disabled = !isHost || els.goalMode.value !== 'custom';
    els.matchSettings.classList.toggle('locked', !isHost);
  }

  function sendGoalChange() {
    if (!latestRoom) return;
    socket.emit('room:setMatchGoal', { goal: goalFromControls() });
  }

  function renderRoom(room) {
    latestRoom = room;
    els.roomPanel.classList.remove('hidden');
    els.createForm.classList.add('hidden');
    els.joinForm.classList.add('hidden');
    els.roomCode.textContent = room.code;
    const current = room.players.find((player) => player.id === me.playerId);
    const isHost = current && current.isHost;
    els.playerList.innerHTML = room.players.map((player) => `
      <li style="--owner-color:${player.markerColor}">
        <span class="player-dot"></span>
        <strong>${escapeHtml(player.name)}</strong>
        ${player.isHost ? '<em>Host</em>' : ''}
        ${player.connected ? '<span>Online</span>' : '<span class="danger">Disconnected</span>'}
      </li>
    `).join('');
    els.startGame.disabled = !isHost || (room.players.filter((player) => player.connected).length < 2 && !debug);
    syncGoalControls(room, isHost);
    els.startHint.textContent = isHost
      ? (els.startGame.disabled ? 'Waiting for at least 2 connected players.' : 'Ready to start.')
      : `Waiting for the host to start. ${goalLabel(room.matchGoal === undefined ? 100 : room.matchGoal)}.`;
    if (room.phase === 'playing' || room.phase === 'roundResults' || room.phase === 'finished') {
      window.location.href = `/game.html?room=${encodeURIComponent(room.code)}`;
    }
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[char]));
  }

  document.querySelectorAll('.tab').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((tab) => tab.classList.remove('active'));
      button.classList.add('active');
      els.createForm.classList.toggle('active', button.dataset.tab === 'create');
      els.joinForm.classList.toggle('active', button.dataset.tab === 'join');
    });
  });

  els.randomCreate.addEventListener('click', () => { els.createName.value = randomName(); });
  els.randomJoin.addEventListener('click', () => { els.joinName.value = randomName(); });
  els.howToPlay.addEventListener('click', PounceUI.howToPlay);

  els.createForm.addEventListener('submit', (event) => {
    event.preventDefault();
    socket.emit('room:create', { name: els.createName.value, debug });
  });

  els.joinForm.addEventListener('submit', (event) => {
    event.preventDefault();
    socket.emit('room:join', { name: els.joinName.value, code: els.joinCode.value.toUpperCase() });
  });

  els.copyCode.addEventListener('click', async () => {
    if (!latestRoom) return;
    await navigator.clipboard.writeText(latestRoom.code);
    PounceUI.toast('Room code copied.');
  });

  els.goalMode.addEventListener('change', () => {
    els.customGoal.classList.toggle('hidden', els.goalMode.value !== 'custom');
    els.customGoal.disabled = els.goalMode.value !== 'custom';
    sendGoalChange();
  });
  els.customGoal.addEventListener('change', sendGoalChange);
  els.startGame.addEventListener('click', () => socket.emit('game:start'));

  socket.on('connect', () => {
    els.connectionStatus.textContent = 'Connected';
    if (me.token && me.roomCode) socket.emit('room:reconnect', { token: me.token });
  });
  socket.on('disconnect', () => { els.connectionStatus.textContent = 'Disconnected'; });
  socket.on('room:created', (data) => saveSession({ playerId: data.playerId, token: data.token, roomCode: data.code }));
  socket.on('room:joined', (data) => saveSession({ playerId: data.playerId, token: data.token, roomCode: data.code }));
  socket.on('room:update', renderRoom);
  socket.on('game:started', (room) => {
    saveSession({ roomCode: room.code });
    window.location.href = `/game.html?room=${encodeURIComponent(room.code)}`;
  });
  socket.on('room:error', (error) => PounceUI.toast(error.reason, 'danger'));
})();
