const ACCESS_CODE = '0402';
const CODE_LENGTH = ACCESS_CODE.length;

const dotsEl = document.getElementById('authDots');
const messageEl = document.getElementById('authMessage');
const numpadEl = document.getElementById('authNumpad');

let digits = '';

function renderDots() {
  dotsEl.innerHTML = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    const dot = document.createElement('span');
    dot.className = 'auth-dot';
    if (i < digits.length) dot.classList.add('is-filled');
    dotsEl.appendChild(dot);
  }
}

function setMessage(text, type = '') {
  messageEl.textContent = text;
  messageEl.className = type ? `auth-message ${type}` : 'auth-message';
}

function shake() {
  const card = document.getElementById('authCard');
  card.classList.remove('is-shake');
  void card.offsetWidth;
  card.classList.add('is-shake');
}

function tryUnlock() {
  if (digits.length < CODE_LENGTH) return;

  if (digits === ACCESS_CODE) {
    setMessage('Acces autorise…', 'success');
    numpadEl.querySelectorAll('button').forEach((btn) => {
      btn.disabled = true;
    });
    window.caisseAuth.unlock().catch(() => {
      setMessage('Erreur de demarrage.', 'error');
    });
    return;
  }

  setMessage('Code incorrect', 'error');
  shake();
  digits = '';
  renderDots();
}

function appendDigit(d) {
  if (digits.length >= CODE_LENGTH) return;
  digits += d;
  renderDots();
  setMessage('');
  if (digits.length === CODE_LENGTH) {
    tryUnlock();
  }
}

function backspace() {
  digits = digits.slice(0, -1);
  renderDots();
  setMessage('');
}

function clearAll() {
  digits = '';
  renderDots();
  setMessage('');
}

numpadEl.addEventListener('click', (event) => {
  const btn = event.target.closest('[data-key]');
  if (!btn || btn.disabled) return;

  const key = btn.dataset.key;
  if (key === 'backspace') {
    backspace();
    return;
  }
  if (key === 'clear') {
    clearAll();
    return;
  }
  if (/^\d$/.test(key)) {
    appendDigit(key);
  }
});

renderDots();
