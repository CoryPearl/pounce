const { createId } = require('./utils');

const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const PLAYER_COLORS = ['#3b82f6', '#f97316', '#22c55e', '#a855f7'];
const DEFAULT_POUNCE_SIZE = 7;
const RANK_LABELS = {
  1: 'A',
  11: 'J',
  12: 'Q',
  13: 'K'
};

function cardColor(suit) {
  return suit === 'hearts' || suit === 'diamonds' ? 'red' : 'black';
}

function rankLabel(rank) {
  return RANK_LABELS[rank] || String(rank);
}

function createDeck(playerId) {
  const deck = [];
  SUITS.forEach((suit) => {
    for (let rank = 1; rank <= 13; rank += 1) {
      deck.push({
        id: `${playerId}-${suit}-${rank}-${createId('card')}`,
        ownerPlayerId: playerId,
        suit,
        rank,
        color: cardColor(suit)
      });
    }
  });
  return deck;
}

function shuffleDeck(deck, random = Math.random) {
  const cards = deck.slice();
  for (let i = cards.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

function exposedPounceCard(player) {
  return player.roundState.pouncePile[player.roundState.pouncePile.length - 1] || null;
}

function exposedWasteCard(player) {
  return player.roundState.waste[player.roundState.waste.length - 1] || null;
}

function tableauCard(entry) {
  return entry && entry.card ? entry.card : entry;
}

function isTableauFaceUp(entry) {
  return Boolean(entry && (entry.faceUp === true || !entry.card));
}

function createTableauEntry(card, faceUp = true) {
  return { card, faceUp };
}

function revealTableauTop(player, columnIndex) {
  const column = player.roundState.tableau[columnIndex];
  if (!column || column.length === 0) return null;
  const top = column[column.length - 1];
  if (top && top.card && !top.faceUp) top.faceUp = true;
  return tableauCard(top);
}

function cloneCardPublic(card) {
  if (!card) return null;
  return {
    id: card.id,
    ownerPlayerId: card.ownerPlayerId,
    suit: card.suit,
    rank: card.rank,
    color: card.color,
    label: rankLabel(card.rank)
  };
}

function initializePlayerRound(player, options = {}) {
  const deck = options.deck ? options.deck.slice() : shuffleDeck(createDeck(player.id), options.random);
  const pounceSize = Math.max(0, Math.min(options.pounceSize || DEFAULT_POUNCE_SIZE, deck.length));
  const pouncePile = deck.splice(0, pounceSize);
  const tableau = [[], [], [], [], []];
  for (let columnIndex = 0; columnIndex < 5; columnIndex += 1) {
    const pileSize = columnIndex + 1;
    for (let cardIndex = 0; cardIndex < pileSize; cardIndex += 1) {
      const card = deck.shift();
      if (card) tableau[columnIndex].push(createTableauEntry(card, cardIndex === pileSize - 1));
    }
  }

  player.roundState = {
    pouncePile,
    initialPounceCount: pouncePile.length,
    tableau,
    stock: deck,
    waste: [],
    stockPosition: 0,
    centerPlayed: 0
  };
}

function isOppositeColor(cardA, cardB) {
  return Boolean(cardA && cardB && cardA.color !== cardB.color);
}

function canPlayFoundation(card, foundation) {
  if (!card) return false;
  if (!foundation) return card.rank === 1;
  if (foundation.suit !== card.suit) return false;
  const top = foundation.cards[foundation.cards.length - 1];
  return top && card.rank === top.rank + 1;
}

function canPlayTableau(card, destinationCard) {
  card = tableauCard(card);
  destinationCard = tableauCard(destinationCard);
  if (!card || !destinationCard) return false;
  return card.rank === destinationCard.rank - 1 && card.color !== destinationCard.color;
}

function canPlayEmptyTableau(locator) {
  if (!locator || !locator.card) return false;
  return locator.sourceType === 'pounce' || locator.card.rank === 13;
}

function validateTableauStack(cards) {
  if (!Array.isArray(cards) || cards.length === 0) return false;
  if (cards.some((entry) => !isTableauFaceUp(entry))) return false;
  for (let i = 0; i < cards.length - 1; i += 1) {
    if (!canPlayTableau(tableauCard(cards[i + 1]), tableauCard(cards[i]))) return false;
  }
  return true;
}

function getPlayer(room, playerId) {
  return room.players.find((player) => player.id === playerId) || null;
}

function requireActiveRound(room) {
  if (!room || room.phase !== 'playing') {
    return { ok: false, reason: 'The round is not active.' };
  }
  return { ok: true };
}

function locateMovableCard(player, source) {
  const state = player.roundState;
  if (!state) return { ok: false, reason: 'Round has not started.' };
  if (!source || !source.type) return { ok: false, reason: 'Missing source.' };

  if (source.type === 'pounce') {
    const card = exposedPounceCard(player);
    if (!card) return { ok: false, reason: 'No exposed Pounce card.' };
    return { ok: true, card, cards: [card], sourceType: 'pounce' };
  }

  if (source.type === 'waste') {
    const card = exposedWasteCard(player);
    if (!card) return { ok: false, reason: 'No exposed waste card.' };
    return { ok: true, card, cards: [card], sourceType: 'waste' };
  }

  if (source.type === 'tableau') {
    const columnIndex = Number(source.columnIndex);
    const cardIndex = Number(source.cardIndex);
    const column = state.tableau[columnIndex];
    if (!Array.isArray(column)) return { ok: false, reason: 'Invalid start pile.' };
    if (!Number.isInteger(cardIndex) || cardIndex < 0 || cardIndex >= column.length) {
      return { ok: false, reason: 'Invalid start-pile card.' };
    }
    const entries = column.slice(cardIndex);
    if (!isTableauFaceUp(entries[0])) return { ok: false, reason: 'That start-pile card is face down.' };
    if (!validateTableauStack(entries)) return { ok: false, reason: 'Start-pile sequence is invalid.' };
    const cards = entries.map(tableauCard);
    return { ok: true, card: cards[0], cards, entries, sourceType: 'tableau', columnIndex, cardIndex };
  }

  return { ok: false, reason: 'Unknown source.' };
}

function assertRequestedCard(locator, cardId) {
  if (!cardId || locator.card.id === cardId) return { ok: true };
  return { ok: false, reason: 'That card is not exposed at the requested source.' };
}

function removeLocatedCards(player, locator) {
  const state = player.roundState;
  if (locator.sourceType === 'pounce') {
    state.pouncePile.pop();
    return;
  }
  if (locator.sourceType === 'waste') {
    state.waste.pop();
    return;
  }
  if (locator.sourceType === 'tableau') {
    state.tableau[locator.columnIndex].splice(locator.cardIndex);
    revealTableauTop(player, locator.columnIndex);
  }
}

function revealPounce(player) {
  return exposedPounceCard(player);
}

function refillEmptyTableau(player) {
  const state = player.roundState;
  for (let i = 0; i < state.tableau.length; i += 1) {
    if (state.tableau[i].length === 0 && state.pouncePile.length > 0) {
      state.tableau[i].push(createTableauEntry(state.pouncePile.pop(), true));
    }
  }
}

function findFoundation(room, foundationId) {
  return room.foundations.find((pile) => pile.id === foundationId) || null;
}

function playToFoundation(room, playerId, action) {
  const active = requireActiveRound(room);
  if (!active.ok) return active;
  const player = getPlayer(room, playerId);
  if (!player) return { ok: false, reason: 'Player not found.' };

  const locator = locateMovableCard(player, action.source);
  if (!locator.ok) return locator;
  const requested = assertRequestedCard(locator, action.cardId);
  if (!requested.ok) return requested;
  if (locator.cards.length !== 1) return { ok: false, reason: 'Only one card can go to the center.' };

  let foundation = action.destinationPileId ? findFoundation(room, action.destinationPileId) : null;
  if (action.destinationPileId && !foundation) return { ok: false, reason: 'Center pile no longer exists.' };
  if (!canPlayFoundation(locator.card, foundation)) {
    return { ok: false, reason: foundation ? 'Pile changed before your move was processed.' : 'Only an Ace can start a center pile.' };
  }

  removeLocatedCards(player, locator);
  if (!foundation) {
    foundation = { id: createId('foundation'), suit: locator.card.suit, cards: [] };
    room.foundations.push(foundation);
  }
  foundation.cards.push(locator.card);
  player.roundState.centerPlayed += 1;
  return { ok: true, card: locator.card, foundationId: foundation.id, source: action.source };
}

function playToTableau(room, playerId, action) {
  const active = requireActiveRound(room);
  if (!active.ok) return active;
  const player = getPlayer(room, playerId);
  if (!player) return { ok: false, reason: 'Player not found.' };
  const destinationColumn = Number(action.destinationColumnIndex);
  const tableau = player.roundState.tableau[destinationColumn];
  if (!Array.isArray(tableau)) return { ok: false, reason: 'Invalid start-pile destination.' };

  const locator = locateMovableCard(player, action.source);
  if (!locator.ok) return locator;
  const requested = assertRequestedCard(locator, action.cardId);
  if (!requested.ok) return requested;
  if (locator.cards.length !== 1) return { ok: false, reason: 'Use start-pile stack moves for multiple cards.' };

  if (tableau.length === 0) {
    if (!canPlayEmptyTableau(locator)) {
      return { ok: false, reason: 'An empty start pile needs a Pounce card or a King.' };
    }
    removeLocatedCards(player, locator);
    tableau.push(createTableauEntry(locator.card, true));
    return { ok: true, card: locator.card, destinationColumnIndex: destinationColumn, source: action.source };
  }

  const destination = tableauCard(tableau[tableau.length - 1]);
  if (!canPlayTableau(locator.card, destination)) {
    return { ok: false, reason: 'That card cannot be played on the selected start pile.' };
  }
  removeLocatedCards(player, locator);
  tableau.push(createTableauEntry(locator.card, true));
  return { ok: true, card: locator.card, destinationColumnIndex: destinationColumn, source: action.source };
}

function moveTableauStack(room, playerId, action) {
  const active = requireActiveRound(room);
  if (!active.ok) return active;
  const player = getPlayer(room, playerId);
  if (!player) return { ok: false, reason: 'Player not found.' };
  const destinationColumn = Number(action.destinationColumnIndex);
  const tableau = player.roundState.tableau[destinationColumn];
  if (!Array.isArray(tableau)) return { ok: false, reason: 'Invalid start-pile destination.' };

  const locator = locateMovableCard(player, action.source);
  if (!locator.ok) return locator;
  if (locator.sourceType !== 'tableau') return { ok: false, reason: 'Only start-pile stacks can move as groups.' };
  if (locator.columnIndex === destinationColumn) return { ok: false, reason: 'Choose a different start pile.' };
  const requested = assertRequestedCard(locator, action.cardId);
  if (!requested.ok) return requested;
  if (tableau.length === 0) {
    if (!canPlayEmptyTableau(locator)) {
      return { ok: false, reason: 'A stack moved to an empty start pile must start with a King.' };
    }
    removeLocatedCards(player, locator);
    tableau.push(...locator.entries);
    return { ok: true, cards: locator.cards, destinationColumnIndex: destinationColumn, source: action.source };
  }
  const destination = tableauCard(tableau[tableau.length - 1]);
  if (!canPlayTableau(locator.card, destination)) {
    return { ok: false, reason: 'That stack cannot be played on the selected start pile.' };
  }

  removeLocatedCards(player, locator);
  tableau.push(...locator.entries);
  return { ok: true, cards: locator.cards, destinationColumnIndex: destinationColumn, source: action.source };
}

function drawStock(room, playerId) {
  const active = requireActiveRound(room);
  if (!active.ok) return active;
  const player = getPlayer(room, playerId);
  if (!player) return { ok: false, reason: 'Player not found.' };
  const state = player.roundState;
  if (state.stock.length === 0 && state.waste.length === 0) {
    return { ok: false, reason: 'No stock cards remain.' };
  }

  if (state.stock.length === 0) {
    state.stock = state.waste.reverse();
    state.waste = [];
    state.stockPosition = 0;
  }

  const drawCount = Math.min(3, state.stock.length);
  for (let i = 0; i < drawCount; i += 1) {
    state.waste.push(state.stock.shift());
  }
  state.stockPosition += drawCount;
  return { ok: true, wasteTop: exposedWasteCard(player), stockCount: state.stock.length, wasteCount: state.waste.length };
}

function canCallPounce(player) {
  return Boolean(player && player.roundState && player.roundState.pouncePile.length === 0);
}

function calculateRoundScore(room) {
  const centerCounts = new Map(room.players.map((player) => [player.id, 0]));
  room.foundations.forEach((foundation) => {
    foundation.cards.forEach((card) => {
      centerCounts.set(card.ownerPlayerId, (centerCounts.get(card.ownerPlayerId) || 0) + 1);
    });
  });

  return room.players.map((player) => {
    const center = centerCounts.get(player.id) || 0;
    const pounceLeft = player.roundState ? player.roundState.pouncePile.length : 0;
    const roundScore = center - pounceLeft;
    player.score += roundScore;
    return {
      playerId: player.id,
      name: player.name,
      center,
      pounceLeft,
      roundScore,
      total: player.score,
      called: room.lastPouncePlayerId === player.id
    };
  });
}

function startRound(room, options = {}) {
  room.phase = 'playing';
  room.round = room.round || 1;
  room.foundations = [];
  room.lastPouncePlayerId = null;
  room.lastRoundResults = null;
  room.winner = null;
  room.players.forEach((player, index) => {
    player.ready = false;
    player.seat = index;
    player.markerColor = PLAYER_COLORS[index % PLAYER_COLORS.length];
    initializePlayerRound(player, options);
  });
  return room;
}

function finishRound(room, pouncingPlayerId) {
  const active = requireActiveRound(room);
  if (!active.ok) return active;
  const player = getPlayer(room, pouncingPlayerId);
  if (!canCallPounce(player)) return { ok: false, reason: 'Your Pounce pile is not empty yet.' };
  room.phase = 'roundResults';
  room.lastPouncePlayerId = pouncingPlayerId;
  const results = calculateRoundScore(room);
  const maxScore = Math.max(...results.map((row) => row.total));
  const roundHigh = Math.max(...results.map((row) => row.roundScore));
  const leaderHigh = maxScore;
  results.forEach((row) => {
    row.roundWinner = row.roundScore === roundHigh;
    row.overallLeader = row.total === leaderHigh;
  });
  room.lastRoundResults = results;
  if (maxScore >= 100) {
    room.phase = 'finished';
    const winners = results.filter((row) => row.total === maxScore);
    room.winner = winners[0];
  }
  return { ok: true, results, winner: room.winner };
}

function foundationPublicState(room) {
  return room.foundations.map((foundation) => ({
    id: foundation.id,
    suit: foundation.suit,
    count: foundation.cards.length,
    topCard: cloneCardPublic(foundation.cards[foundation.cards.length - 1])
  }));
}

function playerPublicHandPreview(player) {
  const state = player.roundState;
  if (!state) return null;
  return {
    pounceCount: state.pouncePile.length,
    pounceTotal: state.initialPounceCount,
    pounceTop: cloneCardPublic(exposedPounceCard(player)),
    stockCount: state.stock.length,
    wasteCount: state.waste.length,
    wasteTop: cloneCardPublic(exposedWasteCard(player)),
    tableau: state.tableau.map((column) => {
      const top = column[column.length - 1] || null;
      return {
        count: column.length,
        hiddenCount: column.filter((entry) => !isTableauFaceUp(entry)).length,
        topCard: top && isTableauFaceUp(top) ? cloneCardPublic(tableauCard(top)) : null
      };
    })
  };
}

function publicState(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    round: room.round,
    winner: room.winner,
    debug: Boolean(room.debug),
    players: room.players.map((player) => ({
      id: player.id,
      name: player.name,
      score: player.score,
      connected: player.connected,
      ready: Boolean(player.ready),
      isHost: room.hostId === player.id,
      markerColor: player.markerColor,
      pounceCount: player.roundState ? player.roundState.pouncePile.length : null,
      pounceTotal: player.roundState ? player.roundState.initialPounceCount : null,
      handPreview: playerPublicHandPreview(player)
    })),
    foundations: foundationPublicState(room),
    lastRoundResults: room.lastRoundResults
  };
}

function privateState(player) {
  const state = player.roundState;
  if (!state) return { playerId: player.id, token: player.reconnectToken, roundState: null };
  return {
    playerId: player.id,
    token: player.reconnectToken,
    roundState: {
      pounceCount: state.pouncePile.length,
      pounceTotal: state.initialPounceCount,
      pounceTop: cloneCardPublic(exposedPounceCard(player)),
      tableau: state.tableau.map((column) => column.map((entry) => {
        if (!isTableauFaceUp(entry)) return { faceUp: false };
        return { faceUp: true, card: cloneCardPublic(tableauCard(entry)) };
      })),
      stockCount: state.stock.length,
      wasteCount: state.waste.length,
      wasteTop: cloneCardPublic(exposedWasteCard(player)),
      canPounce: canCallPounce(player)
    }
  };
}

module.exports = {
  SUITS,
  PLAYER_COLORS,
  DEFAULT_POUNCE_SIZE,
  createDeck,
  shuffleDeck,
  initializePlayerRound,
  isOppositeColor,
  canPlayFoundation,
  canPlayTableau,
  canPlayEmptyTableau,
  validateTableauStack,
  playToFoundation,
  playToTableau,
  moveTableauStack,
  drawStock,
  refillEmptyTableau,
  revealPounce,
  canCallPounce,
  calculateRoundScore,
  startRound,
  finishRound,
  publicState,
  privateState,
  playerPublicHandPreview,
  cloneCardPublic,
  createTableauEntry,
  tableauCard,
  rankLabel
};
