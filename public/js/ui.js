(function () {
  const audio = {
    muted: localStorage.getItem('pounceMuted') === 'true',
    ctx: null
  };

  function tone(freq, duration, type) {
    if (audio.muted) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    if (!audio.ctx) audio.ctx = new AudioContext();
    const osc = audio.ctx.createOscillator();
    const gain = audio.ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, audio.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, audio.ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.ctx.currentTime + duration);
    osc.connect(gain).connect(audio.ctx.destination);
    osc.start();
    osc.stop(audio.ctx.currentTime + duration);
  }

  const sounds = {
    place: () => tone(620, 0.08, 'triangle'),
    invalid: () => tone(140, 0.12, 'sawtooth'),
    flip: () => tone(360, 0.06, 'square'),
    pounce: () => {
      tone(220, 0.12, 'square');
      setTimeout(() => tone(880, 0.18, 'triangle'), 90);
    },
    win: () => {
      [440, 554, 659, 880].forEach((note, i) => setTimeout(() => tone(note, 0.12, 'triangle'), i * 80));
    }
  };

  function setMuted(value) {
    audio.muted = value;
    localStorage.setItem('pounceMuted', String(value));
  }

  function toast(message, kind) {
    const el = document.createElement('div');
    el.className = `toast ${kind || ''}`;
    el.textContent = message;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 250);
    }, 2200);
  }

  function modal(title, bodyHtml) {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop active';
    backdrop.innerHTML = `
      <div class="modal">
        <button class="icon-button modal-close" type="button" aria-label="Close">×</button>
        <h2>${title}</h2>
        <div class="modal-body">${bodyHtml}</div>
      </div>
    `;
    document.body.appendChild(backdrop);
    const close = () => backdrop.remove();
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop || event.target.classList.contains('modal-close')) close();
    });
    document.addEventListener('keydown', function onKey(event) {
      if (event.key === 'Escape') {
        close();
        document.removeEventListener('keydown', onKey);
      }
    });
    return close;
  }

  function howToPlay() {
    modal('How to Play', `
      <ol class="rules-list">
        <li>Each player has their own deck.</li>
        <li>Your Pounce Pile begins with 7 cards.</li>
        <li>Try to empty your Pounce Pile before everyone else.</li>
        <li>Center piles begin with an Ace and build upward by suit.</li>
        <li>Your five start piles are dealt 1, 2, 3, 4, and 5 cards, with only the top card face up.</li>
        <li>Start piles build downward while alternating red and black.</li>
        <li>An empty start pile can begin with your exposed Pounce card or with a King.</li>
        <li>Use cards from your Pounce Pile, start piles, and stock.</li>
        <li>Everyone plays at the same time.</li>
        <li>When your Pounce Pile reaches zero, call POUNCE.</li>
        <li>Every center card you own scores +1.</li>
        <li>Every card left in your Pounce Pile scores -1.</li>
        <li>First player to reach 100 points wins.</li>
      </ol>
      <div class="card-examples">
        <div class="mini-stack"><span class="mini-card red">A♥</span><span class="mini-card red">2♥</span><span class="mini-card red">3♥</span></div>
        <div class="mini-stack"><span class="mini-card red">10♦</span><span class="mini-card black">9♣</span><span class="mini-card red">8♥</span></div>
      </div>
    `);
  }

  window.PounceUI = {
    sounds,
    toast,
    modal,
    howToPlay,
    setMuted,
    isMuted: () => audio.muted
  };
})();
