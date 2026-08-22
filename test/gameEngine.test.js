const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../server/gameEngine');

function card(ownerPlayerId, suit, rank, suffix = '') {
  return {
    id: `${ownerPlayerId}-${suit}-${rank}${suffix}`,
    ownerPlayerId,
    suit,
    rank,
    color: suit === 'hearts' || suit === 'diamonds' ? 'red' : 'black'
  };
}

function up(card) {
  return { card, faceUp: true };
}

function down(card) {
  return { card, faceUp: false };
}

function unwrap(entry) {
  return entry.card || entry;
}

function player(id, name = id) {
  return {
    id,
    name,
    score: 0,
    connected: true,
    roundState: {
      pouncePile: [],
      tableau: [[], [], [], [], []],
      stock: [],
      waste: [],
      stockPosition: 0,
      centerPlayed: 0
    }
  };
}

function room(players = [player('p1'), player('p2')]) {
  return {
    code: 'TEST',
    hostId: players[0].id,
    phase: 'playing',
    round: 1,
    players,
    foundations: []
  };
}

test('foundation rules', () => {
  const aceHearts = card('p1', 'hearts', 1);
  const twoHearts = card('p1', 'hearts', 2);
  const twoDiamonds = card('p1', 'diamonds', 2);
  const threeHearts = card('p1', 'hearts', 3);
  const foundation = { id: 'f1', suit: 'hearts', cards: [aceHearts] };

  assert.equal(engine.canPlayFoundation(aceHearts, null), true);
  assert.equal(engine.canPlayFoundation(twoHearts, foundation), true);
  assert.equal(engine.canPlayFoundation(twoDiamonds, foundation), false);
  assert.equal(engine.canPlayFoundation(threeHearts, foundation), false);
});

test('tableau card rules', () => {
  assert.equal(engine.canPlayTableau(card('p1', 'hearts', 9), card('p1', 'clubs', 10)), true);
  assert.equal(engine.canPlayTableau(card('p1', 'spades', 9), card('p1', 'clubs', 10)), false);
  assert.equal(engine.canPlayTableau(card('p1', 'hearts', 8), card('p1', 'clubs', 10)), false);
});

test('valid tableau sequences move together', () => {
  const moving = [
    up(card('p1', 'hearts', 8)),
    up(card('p1', 'clubs', 7)),
    up(card('p1', 'diamonds', 6))
  ];
  assert.equal(engine.validateTableauStack(moving), true);

  const p1 = player('p1');
  p1.roundState.tableau[0] = [up(card('p1', 'clubs', 9)), ...moving];
  p1.roundState.tableau[1] = [up(card('p1', 'clubs', 9, 'dest'))];
  const r = room([p1, player('p2')]);

  const result = engine.moveTableauStack(r, 'p1', {
    cardId: moving[0].card.id,
    source: { type: 'tableau', columnIndex: 0, cardIndex: 1 },
    destinationColumnIndex: 1
  });

  assert.equal(result.ok, true);
  assert.equal(p1.roundState.tableau[0].length, 1);
  assert.deepEqual(p1.roundState.tableau[1].map((entry) => unwrap(entry).rank), [9, 8, 7, 6]);
});

test('round setup deals five start piles of 1 through 5 with only tops face up', () => {
  const p1 = player('p1');
  const deck = engine.createDeck('p1');
  engine.initializePlayerRound(p1, { deck });
  assert.deepEqual(p1.roundState.tableau.map((column) => column.length), [1, 2, 3, 4, 5]);
  p1.roundState.tableau.forEach((column) => {
    assert.equal(column.at(-1).faceUp, true);
    column.slice(0, -1).forEach((entry) => assert.equal(entry.faceUp, false));
  });
  assert.equal(p1.roundState.pouncePile.length, 7);
  assert.equal(p1.roundState.initialPounceCount, 7);
  assert.equal(p1.roundState.stock.length, 30);
});

test('starting a new round resets stock draw votes back to draw three', () => {
  const p1 = player('p1');
  const p2 = player('p2');
  const r = room([p1, p2]);
  r.stockDrawCount = 1;
  r.stockDrawVotes = new Set(['p1', 'p2']);

  engine.startRound(r);

  assert.equal(r.stockDrawCount, 3);
  assert.equal(r.stockDrawVotes.size, 0);
});

test('Pounce card reveals and empty start piles accept Pounce cards', () => {
  const p1 = player('p1');
  const top = card('p1', 'hearts', 8);
  const next = card('p1', 'clubs', 12);
  p1.roundState.pouncePile = [next, top];
  p1.roundState.tableau[0] = [up(card('p1', 'clubs', 9))];
  p1.roundState.tableau[1] = [up(card('p1', 'diamonds', 4))];
  p1.roundState.tableau[2] = [up(card('p1', 'spades', 4))];
  p1.roundState.tableau[3] = [up(card('p1', 'hearts', 4))];
  p1.roundState.tableau[4] = [up(card('p1', 'clubs', 4))];
  const r = room([p1, player('p2')]);

  const played = engine.playToTableau(r, 'p1', {
    cardId: top.id,
    source: { type: 'pounce' },
    destinationColumnIndex: 0
  });
  assert.equal(played.ok, true);
  assert.equal(engine.revealPounce(p1).id, next.id);

  p1.roundState.tableau[1] = [];
  p1.roundState.pouncePile = [card('p1', 'diamonds', 4)];
  const moved = engine.playToTableau(r, 'p1', {
    cardId: p1.roundState.pouncePile[0].id,
    source: { type: 'pounce' },
    destinationColumnIndex: 1
  });
  assert.equal(moved.ok, true);
  assert.equal(p1.roundState.tableau[1][0].card.rank, 4);
  assert.equal(p1.roundState.pouncePile.length, 0);
});

test('empty start piles accept Kings and King-led stacks only', () => {
  const p1 = player('p1');
  const king = up(card('p1', 'spades', 13));
  const queen = up(card('p1', 'hearts', 12));
  const jack = up(card('p1', 'clubs', 11));
  p1.roundState.tableau[0] = [king, queen, jack];
  p1.roundState.tableau[1] = [];
  p1.roundState.tableau[2] = [up(card('p1', 'diamonds', 8))];
  p1.roundState.tableau[3] = [];
  p1.roundState.waste = [card('p1', 'clubs', 5)];
  const r = room([p1, player('p2')]);

  const badWaste = engine.playToTableau(r, 'p1', {
    cardId: p1.roundState.waste[0].id,
    source: { type: 'waste' },
    destinationColumnIndex: 1
  });
  assert.equal(badWaste.ok, false);

  const badStack = engine.moveTableauStack(r, 'p1', {
    cardId: queen.card.id,
    source: { type: 'tableau', columnIndex: 0, cardIndex: 1 },
    destinationColumnIndex: 1
  });
  assert.equal(badStack.ok, false);

  const goodStack = engine.moveTableauStack(r, 'p1', {
    cardId: king.card.id,
    source: { type: 'tableau', columnIndex: 0, cardIndex: 0 },
    destinationColumnIndex: 1
  });
  assert.equal(goodStack.ok, true);
  assert.deepEqual(p1.roundState.tableau[1].map((entry) => entry.card.rank), [13, 12, 11]);
});

test('removing a start-pile top card flips the next card face up', () => {
  const p1 = player('p1');
  const hidden = down(card('p1', 'clubs', 8));
  const visible = up(card('p1', 'hearts', 7));
  p1.roundState.tableau[0] = [hidden, visible];
  const r = room([p1, player('p2')]);
  r.foundations = [{ id: 'f1', suit: 'hearts', cards: [card('p1', 'hearts', 6)] }];

  const moved = engine.playToFoundation(r, 'p1', {
    cardId: visible.card.id,
    source: { type: 'tableau', columnIndex: 0, cardIndex: 1 },
    destinationPileId: 'f1'
  });

  assert.equal(moved.ok, true);
  assert.equal(p1.roundState.tableau[0][0].faceUp, true);
  assert.equal(p1.roundState.tableau[0][0].card.id, hidden.card.id);
});

test('stock advances and cycles deterministically', () => {
  const p1 = player('p1');
  p1.roundState.stock = [1, 2, 3, 4].map((rank) => card('p1', 'hearts', rank));
  const r = room([p1, player('p2')]);

  assert.equal(engine.drawStock(r, 'p1').ok, true);
  assert.equal(p1.roundState.stock.length, 1);
  assert.equal(p1.roundState.waste.length, 3);
  assert.equal(p1.roundState.waste.at(-1).rank, 3);

  assert.equal(engine.drawStock(r, 'p1').ok, true);
  assert.equal(p1.roundState.stock.length, 0);
  assert.equal(p1.roundState.waste.at(-1).rank, 4);

  assert.equal(engine.drawStock(r, 'p1').ok, true);
  assert.deepEqual(p1.roundState.waste.map((c) => c.rank), [1, 2, 3]);
  assert.deepEqual(p1.roundState.stock.map((c) => c.rank), [4]);
});

test('stock can draw one card when room draw mode changes', () => {
  const p1 = player('p1');
  p1.roundState.stock = [1, 2, 3].map((rank) => card('p1', 'hearts', rank));
  const r = room([p1, player('p2')]);
  r.stockDrawCount = 1;

  assert.equal(engine.drawStock(r, 'p1').ok, true);
  assert.equal(p1.roundState.stock.length, 2);
  assert.equal(p1.roundState.waste.length, 1);
  assert.equal(p1.roundState.waste.at(-1).rank, 1);
});

test('scoring counts center ownership and Pounce penalties', () => {
  const p1 = player('p1', 'B-Bippy');
  const p2 = player('p2', 'Gassy');
  p1.roundState.pouncePile = [];
  p2.roundState.pouncePile = [card('p2', 'clubs', 4), card('p2', 'spades', 9)];
  const r = room([p1, p2]);
  r.lastPouncePlayerId = 'p1';
  r.foundations = [
    { id: 'f1', suit: 'hearts', cards: [card('p1', 'hearts', 1), card('p2', 'hearts', 2), card('p1', 'hearts', 3)] }
  ];

  const results = engine.calculateRoundScore(r);
  assert.equal(results.find((row) => row.playerId === 'p1').roundScore, 2);
  assert.equal(results.find((row) => row.playerId === 'p2').roundScore, -1);
});

test('Pounce call requires zero Pounce cards and moves fail after call', () => {
  const p1 = player('p1');
  const p2 = player('p2');
  p1.roundState.pouncePile = [card('p1', 'hearts', 1)];
  const r = room([p1, p2]);
  assert.equal(engine.finishRound(r, 'p1').ok, false);

  p1.roundState.pouncePile = [];
  const finish = engine.finishRound(r, 'p1');
  assert.equal(finish.ok, true);
  assert.equal(r.phase, 'roundResults');
  p2.roundState.pouncePile = [card('p2', 'hearts', 1)];
  const move = engine.playToFoundation(r, 'p2', {
    cardId: p2.roundState.pouncePile[0].id,
    source: { type: 'pounce' }
  });
  assert.equal(move.ok, false);
});

test('early round finish scores without requiring empty Pounce piles', () => {
  const p1 = player('p1', 'B-Bippy');
  const p2 = player('p2', 'Gassy');
  p1.roundState.pouncePile = [card('p1', 'hearts', 4)];
  p2.roundState.pouncePile = [card('p2', 'clubs', 4), card('p2', 'spades', 9)];
  const r = room([p1, p2]);
  r.foundations = [
    { id: 'f1', suit: 'hearts', cards: [card('p1', 'hearts', 1), card('p2', 'hearts', 2)] }
  ];

  const result = engine.finishRoundEarly(r);
  assert.equal(result.ok, true);
  assert.equal(result.reason, 'vote');
  assert.equal(r.phase, 'roundResults');
  assert.equal(r.roundEndReason, 'vote');
  assert.equal(result.results.find((row) => row.playerId === 'p1').roundScore, 0);
  assert.equal(result.results.find((row) => row.playerId === 'p2').roundScore, -1);
  assert.equal(result.results.some((row) => row.called), false);
});

test('simultaneous center moves cannot both succeed', () => {
  const p1 = player('p1');
  const p2 = player('p2');
  const six1 = card('p1', 'hearts', 6);
  const six2 = card('p2', 'hearts', 6);
  p1.roundState.pouncePile = [six1];
  p2.roundState.pouncePile = [six2];
  const r = room([p1, p2]);
  r.foundations = [{ id: 'f1', suit: 'hearts', cards: [card('p1', 'hearts', 5)] }];

  const first = engine.playToFoundation(r, 'p1', {
    cardId: six1.id,
    source: { type: 'pounce' },
    destinationPileId: 'f1'
  });
  const second = engine.playToFoundation(r, 'p2', {
    cardId: six2.id,
    source: { type: 'pounce' },
    destinationPileId: 'f1'
  });

  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.equal(p2.roundState.pouncePile[0].id, six2.id);
  assert.equal(r.foundations[0].cards.filter((c) => c.rank === 6).length, 1);
});
