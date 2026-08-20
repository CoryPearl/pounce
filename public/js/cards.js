(function () {
  const SUIT_SYMBOLS = {
    hearts: '♥',
    diamonds: '♦',
    clubs: '♣',
    spades: '♠'
  };

  const SUIT_NAMES = {
    hearts: 'Hearts',
    diamonds: 'Diamonds',
    clubs: 'Clubs',
    spades: 'Spades'
  };

  function rankLabel(rank) {
    if (rank === 1) return 'A';
    if (rank === 11) return 'J';
    if (rank === 12) return 'Q';
    if (rank === 13) return 'K';
    return String(rank);
  }

  function createCard(card, options) {
    const opts = options || {};
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `card ${card.color || ''}`;
    el.dataset.cardId = card.id;
    el.dataset.sourceType = opts.sourceType || '';
    if (opts.columnIndex !== undefined) el.dataset.columnIndex = opts.columnIndex;
    if (opts.cardIndex !== undefined) el.dataset.cardIndex = opts.cardIndex;
    el.style.setProperty('--owner-color', opts.ownerColor || '#f6d34a');
    el.innerHTML = `
      <span class="owner-dot"></span>
      <span class="corner top">${rankLabel(card.rank)}${SUIT_SYMBOLS[card.suit]}</span>
      <span class="pip">${SUIT_SYMBOLS[card.suit]}</span>
      <span class="corner bottom">${rankLabel(card.rank)}${SUIT_SYMBOLS[card.suit]}</span>
    `;
    return el;
  }

  function createBack(count, label) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'card card-back';
    el.innerHTML = `<span class="back-pattern">POUNCE</span><span class="pile-count">${count}</span>`;
    el.setAttribute('aria-label', label || `${count} cards`);
    return el;
  }

  window.PounceCards = {
    SUIT_SYMBOLS,
    SUIT_NAMES,
    rankLabel,
    createCard,
    createBack
  };
})();
