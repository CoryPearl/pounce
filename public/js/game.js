(function () {
  const socket = io();
  const params = new URLSearchParams(window.location.search);
  const roomCodeFromUrl = params.get('room');
  const token = localStorage.getItem('pounceReconnectToken');
  const storedRoom = localStorage.getItem('pounceRoomCode');
  const myPlayerId = localStorage.getItem('pouncePlayerId');

  const els = {
    roomCode: document.getElementById('roomCode'),
    roundNumber: document.getElementById('roundNumber'),
    opponents: document.getElementById('opponents'),
    foundationGrid: document.getElementById('foundationGrid'),
    pouncePile: document.getElementById('pouncePile'),
    tableau: document.getElementById('tableau'),
    stockPile: document.getElementById('stockPile'),
    wastePile: document.getElementById('wastePile'),
    pounceButton: document.getElementById('pounceButton'),
    statusOverlay: document.getElementById('statusOverlay'),
    overlayContent: document.getElementById('overlayContent'),
    muteButton: document.getElementById('muteButton'),
    howToPlay: document.getElementById('howToPlay')
  };

  let publicState = null;
  let privateState = null;
  let selected = null;
  let drag = null;
  let latestMyPlayerId = myPlayerId;

  function myMarker(card) {
    const owner = publicState && publicState.players.find((player) => player.id === card.ownerPlayerId);
    return owner ? owner.markerColor : '#f6d34a';
  }

  function sourceFromCardEl(cardEl) {
    return {
      type: cardEl.dataset.sourceType,
      columnIndex: cardEl.dataset.columnIndex === undefined ? undefined : Number(cardEl.dataset.columnIndex),
      cardIndex: cardEl.dataset.cardIndex === undefined ? undefined : Number(cardEl.dataset.cardIndex)
    };
  }

  function cardPayload(cardEl) {
    return {
      cardId: cardEl.dataset.cardId,
      source: sourceFromCardEl(cardEl)
    };
  }

  function render() {
    if (!publicState) return;
    els.roomCode.textContent = publicState.code;
    els.roundNumber.textContent = publicState.round;
    renderOpponents();
    renderFoundations();
    renderPrivate();
    renderPhase();
    renderDebug();
  }

  function renderOpponents() {
    const players = publicState.players || [];
    els.opponents.innerHTML = players.map((player) => {
      const urgent = player.pounceCount !== null && player.pounceCount <= 1 ? 'urgent' : '';
      const pounceText = player.pounceCount === null ? '-' : `${player.pounceCount}/${player.pounceTotal || 7}`;
      return `
        <div class="opponent ${urgent}" style="--owner-color:${player.markerColor}">
          <span class="player-dot"></span>
          <strong>${escapeHtml(player.name)}</strong>
          <span>Pounce: ${pounceText}</span>
          <span>Score: ${player.score}</span>
          ${player.connected ? '' : '<em>Disconnected</em>'}
        </div>
      `;
    }).join('');
  }

  function renderFoundations() {
    const suits = ['hearts', 'diamonds', 'clubs', 'spades'];
    els.foundationGrid.innerHTML = suits.map((suit) => {
      const piles = publicState.foundations.filter((pile) => pile.suit === suit);
      return `
        <div class="suit-group drop-target" data-drop-type="foundation-new" data-suit="${suit}">
          <h3>${PounceCards.SUIT_NAMES[suit]}</h3>
          <div class="foundation-piles">
            ${piles.map((pile) => `
              <div class="foundation-pile drop-target" role="button" tabindex="0" data-drop-type="foundation" data-foundation-id="${pile.id}">
                <span class="depth">${pile.count}</span>
                ${pile.topCard ? cardHtml(pile.topCard) : ''}
              </div>
            `).join('')}
            <button class="empty-foundation drop-target" type="button" data-drop-type="foundation-new" data-suit="${suit}">A${PounceCards.SUIT_SYMBOLS[suit]}</button>
          </div>
        </div>
      `;
    }).join('');
  }

  function cardHtml(card) {
    const el = PounceCards.createCard(card, { ownerColor: myMarker(card) });
    return el.outerHTML;
  }

  function stackGapFor(cardCount) {
    if (cardCount <= 1) return 0;
    const narrow = window.innerWidth <= 560;
    const tablet = window.innerWidth <= 940;
    const compactHeight = window.innerHeight <= 760;
    const cardHeight = narrow ? 80 : tablet ? 88 : 108;
    const targetHeight = narrow ? 168 : compactHeight ? 184 : 224;
    const comfortableGap = narrow ? 13 : tablet ? 15 : 18;
    const minimumGap = narrow ? 7 : 9;
    const fittedGap = Math.floor((targetHeight - cardHeight) / (cardCount - 1));
    return Math.max(minimumGap, Math.min(comfortableGap, fittedGap));
  }

  function renderPrivate() {
    if (!privateState || !privateState.roundState) return;
    const state = privateState.roundState;
    els.pouncePile.innerHTML = '';
    if (state.pounceTop) {
      const back = PounceCards.createBack(Math.max(0, state.pounceCount - 1), 'Hidden Pounce cards');
      if (state.pounceCount > 1) els.pouncePile.appendChild(back);
      els.pouncePile.appendChild(PounceCards.createCard(state.pounceTop, { sourceType: 'pounce', ownerColor: myMarker(state.pounceTop) }));
    } else {
      els.pouncePile.innerHTML = '<div class="empty-slot">Empty</div>';
    }

    els.tableau.innerHTML = '';
    state.tableau.forEach((column, columnIndex) => {
      const columnEl = document.createElement('div');
      columnEl.className = 'tableau-column drop-target';
      columnEl.dataset.dropType = 'tableau';
      columnEl.dataset.columnIndex = columnIndex;
      columnEl.style.setProperty('--stack-gap', `${stackGapFor(column.length)}px`);
      if (column.length === 0) columnEl.innerHTML = '<div class="empty-slot">Empty</div>';
      column.forEach((entry, cardIndex) => {
        let cardEl;
        if (!entry.faceUp) {
          cardEl = PounceCards.createBack('', 'Face-down start-pile card');
          cardEl.classList.add('tableau-hidden');
        } else {
          const card = entry.card;
          cardEl = PounceCards.createCard(card, {
            sourceType: 'tableau',
            columnIndex,
            cardIndex,
            ownerColor: myMarker(card)
          });
        }
        cardEl.style.setProperty('--stack-index', cardIndex);
        columnEl.appendChild(cardEl);
      });
      els.tableau.appendChild(columnEl);
    });

    els.stockPile.innerHTML = '';
    if (state.stockCount > 0 || state.wasteCount > 0) {
      const stock = PounceCards.createBack(state.stockCount, 'Draw stock');
      stock.classList.add('stock-card');
      els.stockPile.appendChild(stock);
    } else {
      els.stockPile.innerHTML = '<div class="empty-slot">Empty</div>';
    }

    els.wastePile.innerHTML = '';
    if (state.wasteTop) {
      els.wastePile.appendChild(PounceCards.createCard(state.wasteTop, { sourceType: 'waste', ownerColor: myMarker(state.wasteTop) }));
      const count = document.createElement('span');
      count.className = 'waste-count';
      count.textContent = `${state.wasteCount}`;
      els.wastePile.appendChild(count);
    } else {
      els.wastePile.innerHTML = '<div class="empty-slot">Empty</div>';
    }
    els.pounceButton.classList.toggle('hidden', !state.canPounce || publicState.phase !== 'playing');
    bindCardEvents();
  }

  function renderPhase() {
    if (publicState.phase === 'roundResults' && publicState.lastRoundResults) {
      showResults(false);
    } else if (publicState.phase === 'finished' && publicState.lastRoundResults) {
      showResults(true);
    } else if (publicState.phase === 'lobby') {
      const current = publicState.players.find((player) => player.id === latestMyPlayerId);
      const isHost = current && current.isHost;
      showOverlay(`
        <h1>Waiting in Lobby</h1>
        <p>Room ${publicState.code}</p>
        ${isHost ? '<button class="primary" type="button" id="restartStart">Start Game</button>' : '<p>Waiting for the host to start.</p>'}
        <button class="primary" type="button" id="backLobby">Back to Lobby</button>
      `);
      document.getElementById('backLobby').onclick = () => window.location.href = '/';
      const restartStart = document.getElementById('restartStart');
      if (restartStart) restartStart.onclick = () => socket.emit('game:start');
    } else {
      hideOverlay();
    }
  }

  function renderDebug() {
    let panel = document.getElementById('debugPanel');
    if (!publicState.debug) {
      if (panel) panel.remove();
      return;
    }
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'debugPanel';
      panel.className = 'debug-panel';
      panel.innerHTML = `
        <button type="button" id="debugEmpty">Empty Pounce</button>
        <button type="button" id="debugState">Inspect State</button>
      `;
      document.body.appendChild(panel);
      document.getElementById('debugEmpty').onclick = () => socket.emit('debug:emptyPounce');
      document.getElementById('debugState').onclick = () => socket.emit('debug:state');
    }
  }

  function showResults(final) {
    const rows = publicState.lastRoundResults.slice().sort((a, b) => b.total - a.total);
    const current = publicState.players.find((player) => player.id === latestMyPlayerId);
    const isHost = current && current.isHost;
    const winner = publicState.winner || rows[0];
    showOverlay(`
      <h1>${final ? `${escapeHtml(winner.name).toUpperCase()} WINS!` : `Round ${publicState.round} Results`}</h1>
      <table class="results-table">
        <thead><tr><th>Player</th><th>Center</th><th>Pounce Left</th><th>Round</th><th>Total</th></tr></thead>
        <tbody>
          ${rows.map((row, index) => `
            <tr class="${row.called ? 'called' : ''} ${row.overallLeader ? 'leader' : ''}">
              <td>${final ? `${index + 1}. ` : ''}${escapeHtml(row.name)}${row.called ? ' called' : ''}</td>
              <td>${row.center}</td>
              <td>${row.pounceLeft}</td>
              <td>${row.roundScore >= 0 ? '+' : ''}${row.roundScore}</td>
              <td>${row.total}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      ${isHost ? `<button class="primary" type="button" id="${final ? 'playAgain' : 'nextRound'}">${final ? 'Play Again' : 'Next Round'}</button>` : '<p>Waiting for host...</p>'}
    `);
    const next = document.getElementById('nextRound');
    const again = document.getElementById('playAgain');
    if (next) next.onclick = () => socket.emit('round:start');
    if (again) again.onclick = () => socket.emit('game:restart');
  }

  function showPounceCall(data) {
    PounceUI.sounds.pounce();
    document.body.classList.add('screen-pulse');
    showOverlay(`<div class="pounce-call"><h2>${escapeHtml(data.playerName).toUpperCase()}</h2><h1>POUNCE!</h1></div>`);
    setTimeout(() => document.body.classList.remove('screen-pulse'), 700);
  }

  function showOverlay(html) {
    els.overlayContent.innerHTML = html;
    els.statusOverlay.classList.remove('hidden');
  }

  function hideOverlay() {
    els.statusOverlay.classList.add('hidden');
  }

  function bindCardEvents() {
    document.querySelectorAll('.card:not(.card-back)').forEach((card) => {
      if (!isPlayableCardEl(card)) return;
      card.addEventListener('pointerdown', onPointerDown);
      card.addEventListener('click', onCardClick);
    });
    document.querySelectorAll('.drop-target, .foundation-pile, .empty-foundation').forEach((target) => {
      target.addEventListener('click', onTargetClick);
    });
  }

  function isPlayableCardEl(card) {
    return ['pounce', 'waste', 'tableau'].includes(card.dataset.sourceType);
  }

  function onCardClick(event) {
    if (drag && drag.moved) return;
    const card = event.currentTarget;
    event.stopPropagation();
    if (selected && selected.cardId !== card.dataset.cardId) {
      const destination = card.closest('.drop-target, .foundation-pile, .empty-foundation');
      if (destination) {
        sendMove(selected, destination);
        clearSelection();
        return;
      }
    }
    if (selected && selected.cardId === card.dataset.cardId) {
      clearSelection();
      return;
    }
    selected = cardPayload(card);
    clearSelection(false);
    card.classList.add('selected');
    highlightTargets(true);
  }

  function onTargetClick(event) {
    if (!selected) return;
    event.stopPropagation();
    const target = event.target.closest('.drop-target, .foundation-pile, .empty-foundation') || event.currentTarget;
    sendMove(selected, target);
    clearSelection();
  }

  function clearSelection(clearPayload = true) {
    if (clearPayload) selected = null;
    document.querySelectorAll('.selected').forEach((el) => el.classList.remove('selected'));
    highlightTargets(false);
  }

  function onPointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return;
    const card = event.currentTarget;
    if (!isPlayableCardEl(card)) return;
    const rect = card.getBoundingClientRect();
    drag = {
      card,
      payload: cardPayload(card),
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      moved: false
    };
    card.setPointerCapture(event.pointerId);
    card.classList.add('dragging');
    highlightTargets(true);
    card.addEventListener('pointermove', onPointerMove);
    card.addEventListener('pointerup', onPointerUp, { once: true });
  }

  function onPointerMove(event) {
    if (!drag) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (Math.abs(dx) + Math.abs(dy) > 6) drag.moved = true;
    if (!drag.moved) return;
    drag.card.style.position = 'fixed';
    drag.card.style.left = `${event.clientX - drag.offsetX}px`;
    drag.card.style.top = `${event.clientY - drag.offsetY}px`;
    drag.card.style.zIndex = 50;
    drag.card.style.pointerEvents = 'none';
  }

  function onPointerUp(event) {
    if (!drag) return;
    const target = document.elementFromPoint(event.clientX, event.clientY);
    const drop = target && target.closest('.drop-target, .foundation-pile, .empty-foundation');
    const payload = drag.payload;
    cleanupDrag();
    if (drop) sendMove(payload, drop);
  }

  function cleanupDrag() {
    if (!drag) return;
    drag.card.removeEventListener('pointermove', onPointerMove);
    drag.card.classList.remove('dragging');
    drag.card.style.position = '';
    drag.card.style.left = '';
    drag.card.style.top = '';
    drag.card.style.zIndex = '';
    drag.card.style.pointerEvents = '';
    highlightTargets(false);
    drag = null;
  }

  function highlightTargets(active) {
    document.querySelectorAll('.drop-target, .foundation-pile, .empty-foundation').forEach((target) => {
      target.classList.toggle('target-lit', active);
    });
  }

  function sendMove(payload, target) {
    const dropType = target.dataset.dropType;
    if (dropType === 'foundation' || dropType === 'foundation-new') {
      const suit = target.dataset.suit || target.closest('[data-suit]')?.dataset.suit;
      socket.emit('card:foundation', {
        cardId: payload.cardId,
        source: payload.source,
        destinationPileId: target.dataset.foundationId || null,
        suit
      });
      return;
    }
    if (dropType === 'tableau') {
      const sourceType = payload.source.type;
      socket.emit(sourceType === 'tableau' ? 'card:tableauStack' : 'card:tableau', {
        cardId: payload.cardId,
        source: payload.source,
        destinationColumnIndex: Number(target.dataset.columnIndex)
      });
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

  els.stockPile.addEventListener('click', () => socket.emit('stock:draw'));
  els.pounceButton.addEventListener('click', () => socket.emit('pounce:call'));
  els.howToPlay.addEventListener('click', PounceUI.howToPlay);
  els.muteButton.textContent = PounceUI.isMuted() ? '♩' : '♪';
  els.muteButton.addEventListener('click', () => {
    PounceUI.setMuted(!PounceUI.isMuted());
    els.muteButton.textContent = PounceUI.isMuted() ? '♩' : '♪';
  });

  document.addEventListener('keydown', (event) => {
    if (event.code === 'Space') {
      event.preventDefault();
      socket.emit('stock:draw');
    }
    if (event.key.toLowerCase() === 'p' && privateState?.roundState?.canPounce) {
      socket.emit('pounce:call');
    }
    if (event.key === 'Escape') {
      if (els.statusOverlay.classList.contains('hidden')) {
        PounceUI.howToPlay();
      } else {
        hideOverlay();
      }
    }
  });

  socket.on('connect', () => {
    if (token && (roomCodeFromUrl || storedRoom)) {
      socket.emit('room:reconnect', { token });
    } else {
      window.location.href = '/';
    }
  });
  socket.on('room:joined', (data) => {
    latestMyPlayerId = data.playerId;
    localStorage.setItem('pouncePlayerId', data.playerId);
    localStorage.setItem('pounceReconnectToken', data.token);
    localStorage.setItem('pounceRoomCode', data.code);
  });
  socket.on('room:update', (state) => { publicState = state; render(); });
  socket.on('game:publicState', (state) => { publicState = state; render(); });
  socket.on('game:privateState', (state) => { privateState = state; latestMyPlayerId = state.playerId; render(); });
  socket.on('card:moved', () => PounceUI.sounds.place());
  socket.on('stock:updated', () => PounceUI.sounds.flip());
  socket.on('move:rejected', (error) => {
    PounceUI.sounds.invalid();
    PounceUI.toast(error.reason, 'danger');
    document.querySelector('.selected')?.classList.add('shake');
    setTimeout(() => document.querySelector('.shake')?.classList.remove('shake'), 260);
  });
  socket.on('room:error', (error) => PounceUI.toast(error.reason, 'danger'));
  socket.on('pounce:called', showPounceCall);
  socket.on('round:results', () => setTimeout(render, 900));
  socket.on('game:finished', () => PounceUI.sounds.win());
  socket.on('player:disconnected', (data) => PounceUI.toast(`${data.playerName} disconnected.`, 'danger'));
  socket.on('debug:state', (state) => console.log('Pounce debug state', state));
})();
