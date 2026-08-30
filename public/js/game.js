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
    opponentPreviews: document.getElementById('opponentPreviews'),
    foundationGrid: document.getElementById('foundationGrid'),
    pouncePile: document.getElementById('pouncePile'),
    tableau: document.getElementById('tableau'),
    stockPile: document.getElementById('stockPile'),
    wastePile: document.getElementById('wastePile'),
    pounceButton: document.getElementById('pounceButton'),
    stockVotePanel: document.getElementById('stockVotePanel'),
    statusOverlay: document.getElementById('statusOverlay'),
    overlayContent: document.getElementById('overlayContent'),
    leaveGame: document.getElementById('leaveGame'),
    muteButton: document.getElementById('muteButton'),
    howToPlay: document.getElementById('howToPlay')
  };

  let publicState = null;
  let privateState = null;
  let selected = null;
  let drag = null;
  let latestMyPlayerId = myPlayerId;
  let pendingFoundationPulse = null;

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
    renderOpponentPreviews();
    renderFoundations();
    renderPrivate();
    renderStockVote();
    renderPhase();
    renderDebug();
    syncSelectionVisual();
    flushFoundationPulse();
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

  function renderOpponentPreviews() {
    const opponents = (publicState.players || []).filter((player) => player.id !== latestMyPlayerId && player.handPreview);
    if (!opponents.length) {
      els.opponentPreviews.innerHTML = '';
      els.opponentPreviews.classList.add('hidden');
      return;
    }
    els.opponentPreviews.classList.remove('hidden');
    els.opponentPreviews.innerHTML = opponents.map((player) => {
      const preview = player.handPreview;
      return `
        <section class="opponent-preview" style="--owner-color:${player.markerColor}">
          <div class="preview-head">
            <span class="player-dot"></span>
            <strong>${escapeHtml(player.name)}</strong>
            <span>${preview.pounceCount}/${preview.pounceTotal || 7}</span>
          </div>
          <div class="preview-hand">
            ${miniPile('P', preview.pounceTop, preview.pounceCount, player.markerColor)}
            ${miniBackPile('S', preview.stockCount)}
            ${miniPile('W', preview.wasteTop, preview.wasteCount, player.markerColor)}
            <div class="preview-start-piles">
              ${preview.tableau.map((pile, index) => miniStartPile(pile, index, player.markerColor)).join('')}
            </div>
          </div>
        </section>
      `;
    }).join('');
  }

  function renderStockVote() {
    if (!publicState || publicState.phase === 'lobby') {
      els.stockVotePanel.classList.add('hidden');
      return;
    }
    const stockVotes = publicState.stockDrawVotes || [];
    const endVotes = publicState.endRoundVotes || [];
    const current = publicState.players.find((player) => player.id === latestMyPlayerId);
    const voted = stockVotes.includes(latestMyPlayerId);
    const endVoted = endVotes.includes(latestMyPlayerId);
    const drawOneActive = publicState.stockDrawCount === 1;
    const canVoteEnd = publicState.phase === 'playing' && current;
    els.stockVotePanel.classList.remove('hidden');
    els.stockVotePanel.innerHTML = `
      <section class="side-vote-section">
        <div class="stock-vote-title">Stock Draw</div>
        <div class="stock-vote-mode">${drawOneActive ? '1 card' : '3 cards'}</div>
        <div class="stock-vote-count">${publicState.stockDrawVoteCount || 0}/${publicState.stockDrawVoteRequired || 0} voted</div>
        <button class="stock-vote-button ${voted ? 'voted' : ''}" data-vote-action="draw-one" type="button" ${drawOneActive || !current ? 'disabled' : ''}>
          ${drawOneActive ? 'Changed' : voted ? 'Voted' : 'Vote Draw 1'}
        </button>
      </section>
      <section class="side-vote-section">
        <div class="stock-vote-title">End Round</div>
        <div class="stock-vote-mode">Score now</div>
        <div class="stock-vote-count">${publicState.endRoundVoteCount || 0}/${publicState.endRoundVoteRequired || 0} voted</div>
        <button class="stock-vote-button danger-vote ${endVoted ? 'voted' : ''}" data-vote-action="end-round" type="button" ${!canVoteEnd ? 'disabled' : ''}>
          ${publicState.phase === 'playing' ? (endVoted ? 'Voted' : 'Vote End') : 'Closed'}
        </button>
      </section>
    `;
    const drawButton = els.stockVotePanel.querySelector('[data-vote-action="draw-one"]');
    if (drawButton && !drawOneActive && current) {
      drawButton.addEventListener('click', () => {
        socket.emit('stock:voteDrawOne', { vote: !voted });
      });
    }
    const endButton = els.stockVotePanel.querySelector('[data-vote-action="end-round"]');
    if (endButton && canVoteEnd) {
      endButton.addEventListener('click', () => {
        socket.emit('round:voteEndEarly', { vote: !endVoted });
      });
    }
  }

  function miniPile(label, card, count, ownerColor) {
    return `
      <div class="mini-pile">
        <span class="mini-label">${label}</span>
        ${card ? miniCard(card, ownerColor) : '<span class="mini-empty"></span>'}
        <span class="mini-count">${count}</span>
      </div>
    `;
  }

  function miniBackPile(label, count) {
    return `
      <div class="mini-pile">
        <span class="mini-label">${label}</span>
        <span class="mini-card-back"></span>
        <span class="mini-count">${count}</span>
      </div>
    `;
  }

  function miniStartPile(pile, index, ownerColor) {
    const hiddenDots = Math.min(pile.hiddenCount || 0, 3);
    return `
      <div class="mini-start-pile" title="Start pile ${index + 1}: ${pile.count} cards">
        <span class="mini-label">${index + 1}</span>
        <span class="mini-hidden-dots">${Array.from({ length: hiddenDots }).map(() => '<i></i>').join('')}</span>
        ${pile.topCard ? miniCard(pile.topCard, ownerColor) : '<span class="mini-empty"></span>'}
        <span class="mini-count">${pile.count}</span>
      </div>
    `;
  }

  function miniCard(card, ownerColor) {
    return `
      <span class="mini-card ${card.color}" style="--owner-color:${ownerColor}">
        <b>${PounceCards.rankLabel(card.rank)}</b>${PounceCards.SUIT_SYMBOLS[card.suit]}
      </span>
    `;
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

  function handleCardMoved(move) {
    PounceUI.sounds.place();
    if (move.kind !== 'foundation') return;
    pendingFoundationPulse = move;
    if (move.playerId !== latestMyPlayerId && navigator.vibrate) {
      navigator.vibrate(45);
    }
    flushFoundationPulse();
  }

  function flushFoundationPulse() {
    if (!pendingFoundationPulse || pendingFoundationPulse.kind !== 'foundation') return;
    const target = document.querySelector(`[data-foundation-id="${pendingFoundationPulse.foundationId}"]`);
    if (!target) return;
    target.classList.remove('foundation-pop', 'foundation-pop-remote');
    void target.offsetWidth;
    target.classList.add(pendingFoundationPulse.playerId === latestMyPlayerId ? 'foundation-pop' : 'foundation-pop-remote');
    const animated = target;
    setTimeout(() => animated.classList.remove('foundation-pop', 'foundation-pop-remote'), 520);
    pendingFoundationPulse = null;
  }

  function cardHtml(card) {
    const el = PounceCards.createCard(card, { ownerColor: myMarker(card) });
    return el.outerHTML;
  }

  function numericCssVar(name, fallback) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name);
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function stackGapFor(cardCount) {
    if (cardCount <= 1) return 0;
    const narrow = window.innerWidth <= 560;
    const tablet = window.innerWidth <= 1180;
    const compactHeight = window.innerHeight <= 760;
    const cardHeight = numericCssVar('--card-h', narrow ? 76 : tablet ? 88 : 108);
    const targetHeight = narrow ? 154 : tablet ? Math.max(148, Math.min(206, window.innerHeight * 0.23)) : compactHeight ? 184 : 224;
    const comfortableGap = narrow ? 11 : tablet ? 13 : 18;
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
      ${!final && publicState.tieBreaker ? '<p class="result-note">Tie at the point goal. Play another round.</p>' : ''}
      ${!final && publicState.matchGoal === null ? '<p class="result-note">No point goal is set.</p>' : ''}
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
    if (sendMove(selected, target)) clearSelection();
  }

  function clearSelection(clearPayload = true) {
    if (clearPayload) selected = null;
    document.querySelectorAll('.selected').forEach((el) => el.classList.remove('selected'));
    highlightTargets(false);
  }

  function syncSelectionVisual() {
    document.querySelectorAll('.selected').forEach((el) => el.classList.remove('selected'));
    if (!selected) {
      highlightTargets(false);
      return;
    }
    const selectedCard = Array.from(document.querySelectorAll('.card:not(.card-back)'))
      .find((card) => card.dataset.cardId === selected.cardId && isPlayableCardEl(card));
    if (!selectedCard) {
      selected = null;
      highlightTargets(false);
      return;
    }
    selectedCard.classList.add('selected');
    highlightTargets(true);
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
    card.addEventListener('pointermove', onPointerMove);
    card.addEventListener('pointerup', onPointerUp, { once: true });
  }

  function onPointerMove(event) {
    if (!drag) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (Math.abs(dx) + Math.abs(dy) > 6 && !drag.moved) {
      drag.moved = true;
      drag.card.classList.add('dragging');
      highlightTargets(true);
    }
    if (!drag.moved) return;
    drag.card.style.position = 'fixed';
    drag.card.style.left = `${event.clientX - drag.offsetX}px`;
    drag.card.style.top = `${event.clientY - drag.offsetY}px`;
    drag.card.style.zIndex = 50;
    drag.card.style.pointerEvents = 'none';
  }

  function onPointerUp(event) {
    if (!drag) return;
    const moved = drag.moved;
    const target = document.elementFromPoint(event.clientX, event.clientY);
    const drop = target && target.closest('.drop-target, .foundation-pile, .empty-foundation');
    const payload = drag.payload;
    cleanupDrag();
    if (moved && drop) sendMove(payload, drop);
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
    if (selected) {
      syncSelectionVisual();
    } else {
      highlightTargets(false);
    }
    drag = null;
  }

  function highlightTargets(active) {
    document.querySelectorAll('.drop-target, .foundation-pile, .empty-foundation').forEach((target) => {
      target.classList.toggle('target-lit', active);
    });
  }

  function sendMove(payload, target) {
    const dropType = target.dataset.dropType;
    if (!payload || !payload.source || !dropType) return false;
    if (dropType === 'foundation' || dropType === 'foundation-new') {
      const suit = target.dataset.suit || target.closest('[data-suit]')?.dataset.suit;
      socket.emit('card:foundation', {
        cardId: payload.cardId,
        source: payload.source,
        destinationPileId: target.dataset.foundationId || null,
        suit
      });
      return true;
    }
    if (dropType === 'tableau') {
      const sourceType = payload.source.type;
      const destinationColumnIndex = Number(target.dataset.columnIndex);
      if (sourceType === 'tableau' && payload.source.columnIndex === destinationColumnIndex) {
        PounceUI.toast('Pick a different start pile.', 'quiet');
        return false;
      }
      socket.emit(sourceType === 'tableau' ? 'card:tableauStack' : 'card:tableau', {
        cardId: payload.cardId,
        source: payload.source,
        destinationColumnIndex
      });
      return true;
    }
    return false;
  }

  function clearLocalSession() {
    localStorage.removeItem('pouncePlayerId');
    localStorage.removeItem('pounceReconnectToken');
    localStorage.removeItem('pounceRoomCode');
  }

  function leaveGame() {
    if (!window.confirm('Leave this Pounce game?')) return;
    socket.emit('room:leave');
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
  els.leaveGame.addEventListener('click', leaveGame);
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

  document.addEventListener('click', (event) => {
    if (!selected) return;
    if (event.target.closest('.card:not(.card-back), .drop-target, .foundation-pile, .empty-foundation')) return;
    clearSelection();
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
  socket.on('card:moved', handleCardMoved);
  socket.on('stock:updated', () => PounceUI.sounds.flip());
  socket.on('stock:drawModeChanged', () => PounceUI.toast('Stock now draws 1 card.'));
  socket.on('round:endedEarly', () => PounceUI.toast('End-round vote passed. Scoring now.'));
  socket.on('room:left', () => {
    clearLocalSession();
    window.location.href = '/';
  });
  socket.on('room:closed', ({ reason } = {}) => {
    clearLocalSession();
    showOverlay(`
      <h1>Room Closed</h1>
      <p>${escapeHtml(reason || 'Not enough players remain in this room.')}</p>
      <button class="primary" type="button" id="closedBackLobby">Back to Lobby</button>
    `);
    document.getElementById('closedBackLobby').onclick = () => { window.location.href = '/'; };
  });
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
