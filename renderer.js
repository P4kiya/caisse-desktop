const API_BASE_URL = window.caisseConfig?.apiBaseUrl || 'http://localhost:3000';
const DATA_URL = `${API_BASE_URL}/data`;
const STATS_URL = `${API_BASE_URL}/stats`;
const LOCALE = 'fr-FR';
const CURRENCY_SUFFIX = ' DH';

const PERIOD_LABELS = {
  today: "Aujourd'hui",
  week: 'Cette semaine',
  month: 'Ce mois',
  all: 'Tout',
};

let currentPeriod = 'today';
let viewDateKey = toDateKey(new Date());
let viewWeekAnchor = toDateKey(new Date());
let viewMonthAnchor = toDateKey(new Date());

const PERIOD_NAV_LABELS = {
  today: { prev: 'Jour précédent', next: 'Jour suivant' },
  week: { prev: 'Semaine précédente', next: 'Semaine suivante' },
  month: { prev: 'Mois précédent', next: 'Mois suivant' },
};
let expandedOrderId = null;
let editingLineIndex = null;
let draftLines = [];
let lastOrders = [];

const priceInput = document.getElementById('price');
const quantityInput = document.getElementById('quantity');
const addLineBtn = document.getElementById('addLineBtn');
const submitOrderBtn = document.getElementById('submitOrderBtn');
const cancelBtn = document.getElementById('cancelBtn');
const fetchBtn = document.getElementById('fetchBtn');
const formTitle = document.getElementById('formTitle');
const statusEl = document.getElementById('status');
const listEl = document.getElementById('list');
const draftBox = document.getElementById('draftBox');
const draftLinesEl = document.getElementById('draftLines');
const draftTotalEl = document.getElementById('draftTotal');
const statsHeading = document.getElementById('statsHeading');
const listHeading = document.getElementById('listHeading');
const filterButtons = document.querySelectorAll('.filter-btn');
const dayNav = document.getElementById('dayNav');
const dayPrevBtn = document.getElementById('dayPrevBtn');
const dayNextBtn = document.getElementById('dayNextBtn');
const dayNavLabel = document.getElementById('dayNavLabel');
const printAllDayBtn = document.getElementById('printAllDayBtn');

const kpiAmount = document.getElementById('kpiAmount');
const kpiEntries = document.getElementById('kpiEntries');
const kpiQuantity = document.getElementById('kpiQuantity');
const kpiSubEntries = document.getElementById('kpiSubEntries');
const toastStack = document.getElementById('toastStack');
const confirmModal = document.getElementById('confirmModal');
const confirmTitle = document.getElementById('confirmTitle');
const confirmMessage = document.getElementById('confirmMessage');
const confirmOkBtn = document.getElementById('confirmOkBtn');
const confirmCancelBtn = document.getElementById('confirmCancelBtn');
const confirmBackdrop = confirmModal?.querySelector('.confirm-backdrop');
const themeToggle = document.getElementById('themeToggle');
const numpadToggle = document.getElementById('numpadToggle');
const numpadPanel = document.getElementById('numpadPanel');
const numpadEl = document.getElementById('numpad');
const numpadClose = document.getElementById('numpadClose');
const numpadPreview = document.getElementById('numpadPreview');
const numpadTargetHint = document.getElementById('numpadTargetHint');
const numpadDecimalBtn = document.getElementById('numpadDecimal');

let numpadTarget = priceInput;

const TOAST_DURATION_MS = 4200;
const THEME_STORAGE_KEY = 'caisse-theme';
let numpadOpen = true;
let quantityReplaceOnNextInput = false;

function setStatus(message, type = '') {
  statusEl.textContent = message;
  statusEl.className = type;
}

function getTheme() {
  return document.documentElement.getAttribute('data-theme') === 'dark'
    ? 'dark'
    : 'light';
}

function updateThemeToggleUi(theme) {
  if (!themeToggle) return;

  const isDark = theme === 'dark';
  themeToggle.setAttribute(
    'aria-label',
    isDark ? 'Activer le mode clair' : 'Activer le mode sombre',
  );
  themeToggle.title = isDark ? 'Mode clair' : 'Mode sombre';
}

function setTheme(theme) {
  const next = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);

  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch (_) {
    /* ignore */
  }

  updateThemeToggleUi(next);
}

function toggleTheme() {
  setTheme(getTheme() === 'dark' ? 'light' : 'dark');
}

function dismissToast(toast) {
  if (!toast || toast.classList.contains('is-leaving')) return;

  toast.classList.remove('is-visible');
  toast.classList.add('is-leaving');

  const remove = () => toast.remove();
  toast.addEventListener('transitionend', remove, { once: true });
  setTimeout(remove, 350);
}

function showToast({ title, message, type = 'success', duration = TOAST_DURATION_MS }) {
  if (!toastStack) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="toast-icon" aria-hidden="true">✓</span>
    <div class="toast-content">
      <p class="toast-title"></p>
      <p class="toast-message"></p>
    </div>
    <button type="button" class="toast-close" aria-label="Fermer">×</button>
    <span class="toast-progress" style="animation-duration: ${duration}ms"></span>
  `;

  toast.querySelector('.toast-title').textContent = title;
  toast.querySelector('.toast-message').textContent = message;

  const closeBtn = toast.querySelector('.toast-close');
  let timerId;

  const scheduleDismiss = () => {
    timerId = window.setTimeout(() => dismissToast(toast), duration);
  };

  closeBtn.addEventListener('click', () => {
    window.clearTimeout(timerId);
    dismissToast(toast);
  });

  toastStack.appendChild(toast);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => toast.classList.add('is-visible'));
  });
  scheduleDismiss();
}

function showConfirmDialog({
  title,
  message,
  confirmLabel = 'Supprimer',
  cancelLabel = 'Annuler',
}) {
  if (!confirmModal) {
    return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  }

  return new Promise((resolve) => {
    confirmTitle.textContent = title;
    confirmMessage.textContent = message;
    confirmOkBtn.textContent = confirmLabel;
    confirmCancelBtn.textContent = cancelLabel;

    const finish = (value) => {
      confirmModal.classList.remove('is-open');
      confirmModal.setAttribute('aria-hidden', 'true');
      document.removeEventListener('keydown', onKeyDown);
      confirmOkBtn.removeEventListener('click', onConfirm);
      confirmCancelBtn.removeEventListener('click', onCancel);
      confirmBackdrop.removeEventListener('click', onCancel);

      window.setTimeout(() => {
        confirmModal.hidden = true;
        resolve(value);
      }, 260);
    };

    const onConfirm = () => finish(true);
    const onCancel = () => finish(false);
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onCancel();
    };

    confirmOkBtn.addEventListener('click', onConfirm);
    confirmCancelBtn.addEventListener('click', onCancel);
    confirmBackdrop.addEventListener('click', onCancel);
    document.addEventListener('keydown', onKeyDown);

    confirmModal.hidden = false;
    confirmModal.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => {
      requestAnimationFrame(() => confirmModal.classList.add('is-open'));
    });
    confirmCancelBtn.focus();
  });
}

function setBusy(busy) {
  addLineBtn.disabled = busy;
  submitOrderBtn.disabled = busy || draftLines.length === 0;
  cancelBtn.disabled = busy;
  fetchBtn.disabled = busy;
  if (printAllDayBtn) {
    printAllDayBtn.disabled =
      busy || (currentPeriod === 'today' && lastOrders.length === 0);
  }
  filterButtons.forEach((btn) => {
    btn.disabled = busy;
  });
  listEl.querySelectorAll('.btn-entry').forEach((btn) => {
    btn.disabled = busy;
  });
  numpadEl?.querySelectorAll('button').forEach((btn) => {
    btn.disabled = busy;
  });
  if (!busy) {
    submitOrderBtn.disabled = draftLines.length === 0;
    updateNumpadUi();
  }
}

function setNumpadTarget(input) {
  numpadTarget = input;
  priceInput.classList.toggle(
    'is-numpad-active',
    numpadOpen && input === priceInput,
  );
  quantityInput.classList.toggle(
    'is-numpad-active',
    numpadOpen && input === quantityInput,
  );
  updateNumpadUi();
  updateNumpadPreview();
}

function updateNumpadPreview() {
  if (!numpadPreview || !numpadTarget) return;
  numpadPreview.textContent = numpadTarget.value || '';
}

function updateNumpadToggleUi() {
  if (!numpadToggle) return;

  numpadToggle.setAttribute('aria-pressed', numpadOpen ? 'true' : 'false');
  numpadToggle.setAttribute(
    'aria-label',
    numpadOpen ? 'Masquer le pavé numérique' : 'Afficher le pavé numérique',
  );
  numpadToggle.title = numpadOpen ? 'Masquer le pavé' : 'Pavé numérique';
}

function setNumpadOpen(open) {
  numpadOpen = Boolean(open);
  updateNumpadToggleUi();

  if (!numpadPanel) return;

  if (!numpadOpen) {
    numpadPanel.classList.remove('is-open');
    numpadPanel.setAttribute('aria-hidden', 'true');
    priceInput.classList.remove('is-numpad-active');
    quantityInput.classList.remove('is-numpad-active');
    window.setTimeout(() => {
      if (!numpadOpen) numpadPanel.hidden = true;
    }, 220);
    return;
  }

  const active =
    document.activeElement === priceInput ||
    document.activeElement === quantityInput
      ? document.activeElement
      : numpadTarget || priceInput;
  setNumpadTarget(active);

  numpadPanel.hidden = false;
  numpadPanel.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => numpadPanel.classList.add('is-open'));
  });
}

function toggleNumpad() {
  const next = !numpadOpen;
  setNumpadOpen(next);
  if (next) {
    const active =
      document.activeElement === priceInput ||
      document.activeElement === quantityInput
        ? document.activeElement
        : priceInput;
    setNumpadTarget(active);
  }
}

function updateNumpadUi() {
  if (numpadTargetHint) {
    numpadTargetHint.textContent = numpadTarget === quantityInput ? 'Quantité' : 'Prix';
  }
  if (numpadDecimalBtn) {
    const isPrice = numpadTarget === priceInput;
    numpadDecimalBtn.disabled = !isPrice;
    numpadDecimalBtn.style.visibility = isPrice ? 'visible' : 'hidden';
  }
}

function appendNumpadDigit(digit) {
  if (!numpadOpen || !numpadTarget) return;

  let value = numpadTarget.value || '';

  if (digit === '.') {
    if (numpadTarget !== priceInput) return;
    if (value.includes('.')) return;
    value = value ? `${value}.` : '0.';
  } else if (numpadTarget === quantityInput) {
    if (quantityReplaceOnNextInput || value === '') {
      value = digit;
      quantityReplaceOnNextInput = false;
    } else if (value === '0') {
      value = digit;
    } else {
      value += digit;
    }
  } else {
    value += digit;
  }

  numpadTarget.value = value;
  numpadTarget.dispatchEvent(new Event('input', { bubbles: true }));
  updateNumpadPreview();
}

function numpadBackspace() {
  if (!numpadOpen || !numpadTarget?.value) return;
  numpadTarget.value = numpadTarget.value.slice(0, -1);
  numpadTarget.dispatchEvent(new Event('input', { bubbles: true }));
  updateNumpadPreview();
}

function numpadClear() {
  if (!numpadOpen || !numpadTarget) return;
  numpadTarget.value = '';
  numpadTarget.dispatchEvent(new Event('input', { bubbles: true }));
  updateNumpadPreview();
}

function initNumpad() {
  if (!numpadEl) return;

  [priceInput, quantityInput].forEach((input) => {
    input.addEventListener('focus', () => {
      setNumpadTarget(input);
    });
    input.addEventListener('input', () => {
      if (document.activeElement === input) {
        setNumpadTarget(input);
      }
      updateNumpadPreview();
    });
  });

  numpadToggle?.addEventListener('click', toggleNumpad);
  numpadClose?.addEventListener('click', () => setNumpadOpen(false));

  try {
    localStorage.removeItem('caisse-numpad-open');
  } catch (_) {
    /* ignore */
  }
  setNumpadOpen(true);

  numpadEl.addEventListener('click', (event) => {
    const digitBtn = event.target.closest('[data-digit]');
    if (digitBtn) {
      appendNumpadDigit(digitBtn.dataset.digit);
      return;
    }

    const action = event.target.closest('[data-numpad]')?.dataset.numpad;
    if (action === 'decimal') appendNumpadDigit('.');
    if (action === 'backspace') numpadBackspace();
    if (action === 'clear') numpadClear();
  });
}

function formatMoney(value) {
  const num = Number(value);
  if (Number.isNaN(num)) return '0,00';
  return (
    num.toLocaleString(LOCALE, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + CURRENCY_SUFFIX
  );
}

function lineTotal(price, quantity) {
  return Number(price) * Number(quantity);
}

function formatLineEquation(price, quantity) {
  const total = lineTotal(price, quantity);
  return `${formatMoney(price)} x ${quantity} = ${formatMoney(total)}`;
}

function draftTotalAmount() {
  return draftLines.reduce((sum, line) => sum + lineTotal(line.price, line.quantity), 0);
}

function toDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseDateKey(key) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function isTodayKey(key) {
  return key === toDateKey(new Date());
}

function startOfWeekMonday(key) {
  const date = parseDateKey(key);
  const weekday = date.getDay();
  const offset = weekday === 0 ? -6 : 1 - weekday;
  date.setDate(date.getDate() + offset);
  return toDateKey(date);
}

function isCurrentWeekAnchor(key) {
  return startOfWeekMonday(key) === startOfWeekMonday(toDateKey(new Date()));
}

function toMonthAnchor(key) {
  const date = parseDateKey(key);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${date.getFullYear()}-${month}-01`;
}

function isCurrentMonthAnchor(key) {
  return toMonthAnchor(key) === toMonthAnchor(toDateKey(new Date()));
}

function formatDayLabel(key) {
  if (isTodayKey(key)) {
    return PERIOD_LABELS.today;
  }
  return parseDateKey(key).toLocaleDateString(LOCALE, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function formatWeekLabel(anchorKey) {
  if (isCurrentWeekAnchor(anchorKey)) {
    return PERIOD_LABELS.week;
  }

  const monday = parseDateKey(startOfWeekMonday(anchorKey));
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);

  const mondayLabel = monday.toLocaleDateString(LOCALE, {
    day: 'numeric',
    month: 'long',
  });
  const sundayLabel = sunday.toLocaleDateString(LOCALE, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return `Semaine du ${mondayLabel} au ${sundayLabel}`;
}

function formatMonthLabel(anchorKey) {
  if (isCurrentMonthAnchor(anchorKey)) {
    return PERIOD_LABELS.month;
  }

  return parseDateKey(toMonthAnchor(anchorKey)).toLocaleDateString(LOCALE, {
    month: 'long',
    year: 'numeric',
  });
}

function getPeriodNavLabel() {
  if (currentPeriod === 'today') {
    return formatDayLabel(viewDateKey);
  }
  if (currentPeriod === 'week') {
    return formatWeekLabel(viewWeekAnchor);
  }
  if (currentPeriod === 'month') {
    return formatMonthLabel(viewMonthAnchor);
  }
  return '';
}

function isPeriodNavNextDisabled() {
  if (currentPeriod === 'today') {
    return isTodayKey(viewDateKey);
  }
  if (currentPeriod === 'week') {
    return isCurrentWeekAnchor(viewWeekAnchor);
  }
  if (currentPeriod === 'month') {
    return isCurrentMonthAnchor(viewMonthAnchor);
  }
  return true;
}

function getPeriodDisplayLabel() {
  if (currentPeriod === 'today') {
    return formatDayLabel(viewDateKey);
  }
  if (currentPeriod === 'week') {
    return formatWeekLabel(viewWeekAnchor);
  }
  if (currentPeriod === 'month') {
    return formatMonthLabel(viewMonthAnchor);
  }
  return PERIOD_LABELS[currentPeriod] || currentPeriod;
}

function periodQuery() {
  const params = new URLSearchParams({ period: currentPeriod });
  if (currentPeriod === 'today') {
    params.set('date', viewDateKey);
  } else if (currentPeriod === 'week') {
    params.set('date', viewWeekAnchor);
  } else if (currentPeriod === 'month') {
    params.set('date', toMonthAnchor(viewMonthAnchor));
  }
  return `?${params}`;
}

function updateDayNavUi() {
  const showNav =
    currentPeriod === 'today' ||
    currentPeriod === 'week' ||
    currentPeriod === 'month';
  if (dayNav) {
    dayNav.hidden = !showNav;
  }
  if (!showNav) {
    return;
  }

  const navLabels = PERIOD_NAV_LABELS[currentPeriod] || PERIOD_NAV_LABELS.today;

  if (dayPrevBtn) {
    dayPrevBtn.title = navLabels.prev;
    dayPrevBtn.setAttribute('aria-label', navLabels.prev);
  }
  if (dayNextBtn) {
    dayNextBtn.title = navLabels.next;
    dayNextBtn.setAttribute('aria-label', navLabels.next);
    dayNextBtn.disabled = isPeriodNavNextDisabled();
  }
  if (dayNavLabel) {
    dayNavLabel.textContent = getPeriodNavLabel();
  }
  if (printAllDayBtn) {
    const showPrintAll = currentPeriod === 'today';
    printAllDayBtn.hidden = !showPrintAll;
    printAllDayBtn.disabled = showPrintAll && lastOrders.length === 0;
  }
}

function updatePeriodUi() {
  const label = getPeriodDisplayLabel();
  const listLabel = label.toLowerCase();

  filterButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.period === currentPeriod);
  });

  updateDayNavUi();
  statsHeading.innerHTML = `Statistiques pour <strong>${label}</strong>`;
  listHeading.textContent = `Ventes (${listLabel})`;
}

function shiftViewDay(delta) {
  if (currentPeriod !== 'today' || delta === 0) {
    return;
  }

  if (delta > 0 && isTodayKey(viewDateKey)) {
    return;
  }

  const next = parseDateKey(viewDateKey);
  next.setDate(next.getDate() + delta);
  const nextKey = toDateKey(next);

  if (delta > 0 && nextKey > toDateKey(new Date())) {
    return;
  }

  viewDateKey = nextKey;
  fetchData();
}

function shiftViewWeek(delta) {
  if (currentPeriod !== 'week' || delta === 0) {
    return;
  }

  if (delta > 0 && isCurrentWeekAnchor(viewWeekAnchor)) {
    return;
  }

  const next = parseDateKey(viewWeekAnchor);
  next.setDate(next.getDate() + delta * 7);
  const nextKey = toDateKey(next);

  if (
    delta > 0 &&
    startOfWeekMonday(nextKey) > startOfWeekMonday(toDateKey(new Date()))
  ) {
    return;
  }

  viewWeekAnchor = nextKey;
  fetchData();
}

function shiftViewMonth(delta) {
  if (currentPeriod !== 'month' || delta === 0) {
    return;
  }

  if (delta > 0 && isCurrentMonthAnchor(viewMonthAnchor)) {
    return;
  }

  const next = parseDateKey(toMonthAnchor(viewMonthAnchor));
  next.setMonth(next.getMonth() + delta);
  const nextKey = toDateKey(next);

  if (
    delta > 0 &&
    toMonthAnchor(nextKey) > toMonthAnchor(toDateKey(new Date()))
  ) {
    return;
  }

  viewMonthAnchor = nextKey;
  fetchData();
}

function shiftPeriodNav(delta) {
  if (currentPeriod === 'today') {
    shiftViewDay(delta);
  } else if (currentPeriod === 'week') {
    shiftViewWeek(delta);
  } else if (currentPeriod === 'month') {
    shiftViewMonth(delta);
  }
}

function showTodayAfterNewSale() {
  const todayKey = toDateKey(new Date());
  currentPeriod = 'today';
  viewDateKey = todayKey;
  viewWeekAnchor = todayKey;
  viewMonthAnchor = todayKey;
}

function resetPeriodToCurrent() {
  const todayKey = toDateKey(new Date());
  if (currentPeriod === 'today') {
    viewDateKey = todayKey;
  } else if (currentPeriod === 'week') {
    viewWeekAnchor = todayKey;
  } else if (currentPeriod === 'month') {
    viewMonthAnchor = todayKey;
  }
}

function refreshData() {
  resetPeriodToCurrent();
  fetchData();
}

function clearLineEdit() {
  editingLineIndex = null;
  priceInput.value = '';
  quantityInput.value = '';
  quantityReplaceOnNextInput = false;
  updateAddLineButton();
}

function selectDraftLine(index) {
  const line = draftLines[index];
  if (!line) return;

  editingLineIndex = index;
  priceInput.value = String(line.price);
  quantityInput.value = String(line.quantity);
  quantityReplaceOnNextInput = false;
  updateAddLineButton();
  renderDraft();
  priceInput.focus();
}

function updateAddLineButton() {
  addLineBtn.textContent =
    editingLineIndex != null ? "Mettre à jour l'article" : 'Ajouter';
}

function renderDraft() {
  draftLinesEl.innerHTML = '';
  draftBox.classList.toggle('is-empty', draftLines.length === 0);
  submitOrderBtn.disabled = draftLines.length === 0;

  draftLines.forEach((line, index) => {
    const li = document.createElement('li');
    li.className = 'draft-line';
    if (editingLineIndex === index) {
      li.classList.add('is-selected');
    }
    li.dataset.index = String(index);
    li.innerHTML = `
      <button type="button" class="draft-line-body" data-index="${index}">
        ${formatLineEquation(line.price, line.quantity)}
      </button>
      <button type="button" class="btn-remove-draft" data-index="${index}" aria-label="Retirer">×</button>
    `;
    draftLinesEl.appendChild(li);
  });

  draftTotalEl.innerHTML = `Total = <strong>${formatMoney(draftTotalAmount())}</strong>`;
}

function updateFormMode() {
  formTitle.textContent = 'Nouvelle vente';
  submitOrderBtn.textContent = 'Enregistrer la vente';
  if (cancelBtn) {
    cancelBtn.hidden = true;
  }
  renderDraft();
}

function resetForm() {
  expandedOrderId = null;
  editingLineIndex = null;
  draftLines = [];
  priceInput.value = '';
  quantityInput.value = '';
  quantityReplaceOnNextInput = false;
  updateAddLineButton();
  updateFormMode();
}

function syncDefaultQuantityFromPrice() {
  const price = priceInput.value.trim().replace(',', '.');
  if (price === '' || price === '.') {
    if (quantityReplaceOnNextInput) {
      quantityInput.value = '';
      quantityReplaceOnNextInput = false;
    }
    return;
  }
  if (editingLineIndex != null) return;

  const qty = quantityInput.value.trim();
  if (qty === '' || quantityReplaceOnNextInput) {
    quantityInput.value = '1';
    quantityReplaceOnNextInput = true;
  }
}

function prepareQuantityForEntry() {
  if (!quantityReplaceOnNextInput) return;
  quantityInput.value = '';
  quantityInput.select();
}

function restoreDefaultQuantityIfEmpty() {
  if (!quantityReplaceOnNextInput) return;
  if (quantityInput.value.trim() !== '') return;

  const price = priceInput.value.trim().replace(',', '.');
  if (price && price !== '.') {
    quantityInput.value = '1';
  }
}

function initSaleEntryInputs() {
  priceInput?.addEventListener('input', () => {
    syncDefaultQuantityFromPrice();
    updateNumpadPreview();
  });

  quantityInput?.addEventListener('focus', () => {
    prepareQuantityForEntry();
  });

  quantityInput?.addEventListener('blur', () => {
    restoreDefaultQuantityIfEmpty();
  });

  quantityInput?.addEventListener('input', () => {
    if (quantityInput.value.trim() !== '') {
      quantityReplaceOnNextInput = false;
    }
    updateNumpadPreview();
  });

  quantityInput?.addEventListener('keydown', (event) => {
    if (!quantityReplaceOnNextInput) return;
    if (event.key.length !== 1 || !/^\d$/.test(event.key)) return;
    event.preventDefault();
    quantityInput.value = event.key;
    quantityReplaceOnNextInput = false;
    quantityInput.dispatchEvent(new Event('input', { bubbles: true }));
    updateNumpadPreview();
  });
}

function toggleOrderDetails(id) {
  expandedOrderId = expandedOrderId === id ? null : id;
  listEl.querySelectorAll('li[data-id]').forEach((li) => {
    li.classList.toggle('is-expanded', Number(li.dataset.id) === expandedOrderId);
  });
}

function formatSavedAt(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(LOCALE);
}

async function printAllDaySales() {
  if (currentPeriod !== 'today') {
    return;
  }
  if (!lastOrders.length) {
    showToast({
      title: 'Aucune vente',
      message: 'Aucune vente a imprimer pour cette journee.',
      type: 'error',
    });
    return;
  }
  if (!window.caissePrint?.printDaySummary) {
    setStatus('Impression non disponible.', 'error');
    return;
  }

  setBusy(true);
  setStatus('Impression du recap…');

  try {
    await window.caissePrint.printDaySummary(lastOrders, {
      periodLabel: getPeriodDisplayLabel(),
      deviceName: window.caissePrint.deviceName || undefined,
    });
    setStatus('');
    showToast({
      title: 'Impression',
      message: `Recap de ${lastOrders.length} vente(s) envoye a l'imprimante.`,
    });
  } catch (err) {
    setStatus(`Impression : ${err.message}`, 'error');
  } finally {
    setBusy(false);
  }
}

async function printSaleReceipt(order, { quiet = false } = {}) {
  if (!order?.id) return;

  if (!window.caissePrint?.printReceipt) {
    if (!quiet) {
      setStatus('Impression non disponible.', 'error');
    }
    return;
  }

  try {
    await window.caissePrint.printReceipt(order, {
      deviceName: window.caissePrint.deviceName || undefined,
    });
    if (!quiet) {
      showToast({
        title: 'Impression',
        message: `Ticket de la vente #${order.id} envoyé à l'imprimante.`,
      });
    }
  } catch (err) {
    if (!quiet) {
      setStatus(`Impression : ${err.message}`, 'error');
    }
  }
}

function renderKpis(stats) {
  if (!stats) return;

  const label = stats.periodLabel || PERIOD_LABELS[stats.period] || '';
  const entries = Number(stats.entries) || 0;

  kpiAmount.textContent = formatMoney(stats.amount);
  kpiEntries.textContent = String(entries);
  kpiQuantity.textContent = String(stats.quantity ?? 0);
  kpiSubEntries.textContent = `ventes sur ${label.toLowerCase()}`;
}

function renderList(orders) {
  lastOrders = orders;
  listEl.innerHTML = '';

  if (!orders.length) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = `Aucune commande pour ${PERIOD_LABELS[currentPeriod].toLowerCase()}.`;
    listEl.appendChild(empty);
    updateDayNavUi();
    return;
  }

  for (const order of orders) {
    const li = document.createElement('li');
    li.dataset.id = String(order.id);
    if (expandedOrderId === order.id) {
      li.classList.add('is-expanded');
    }

    const linesHtml = (order.items || [])
      .map(
        (item) =>
          `<li class="order-line">${formatLineEquation(item.price, item.quantity)}</li>`,
      )
      .join('');

    const total =
      order.total != null
        ? Number(order.total)
        : (order.items || []).reduce(
            (sum, item) => sum + lineTotal(item.price, item.quantity),
            0,
          );

    const isExpanded = expandedOrderId === order.id;

    li.innerHTML = `
      <div class="entry-summary" data-action="toggle" role="button" tabindex="0" aria-expanded="${isExpanded}">
        <div class="summary-main">
          <strong>#${order.id}</strong>
          <span class="summary-date">${formatSavedAt(order.savedAt)}</span>
        </div>
        <div class="summary-end">
          <span class="summary-total">${formatMoney(total)}</span>
          <button type="button" class="btn-entry btn-print summary-print" data-action="print">Imprimer</button>
          <span class="summary-chevron" aria-hidden="true">▼</span>
        </div>
      </div>
      <div class="entry-details">
        <ul class="order-lines">${linesHtml}</ul>
      </div>
    `;
    listEl.appendChild(li);
  }

  updateDayNavUi();
}

function addLineToDraft() {
  const price = priceInput.value.trim().replace(',', '.');
  const quantity = quantityInput.value.trim();

  if (price === '' || quantity === '') {
    setStatus('Veuillez saisir le prix et la quantité.', 'error');
    return;
  }

  const parsedPrice = Number(price);
  if (Number.isNaN(parsedPrice) || parsedPrice < 0) {
    setStatus('Prix invalide.', 'error');
    return;
  }

  const parsedQty = Number(quantity);
  if (!Number.isInteger(parsedQty) || parsedQty <= 0) {
    setStatus('La quantité doit être un entier supérieur à 0.', 'error');
    return;
  }

  const line = {
    price: parsedPrice,
    quantity: parsedQty,
  };

  if (editingLineIndex != null) {
    draftLines[editingLineIndex] = line;
    editingLineIndex = null;
  } else {
    draftLines.push(line);
  }

  priceInput.value = '';
  quantityInput.value = '';
  quantityReplaceOnNextInput = false;
  updateAddLineButton();
  renderDraft();
  setStatus('');
}

async function submitOrder() {
  if (!draftLines.length) {
    setStatus('Ajoutez au moins un article à la commande.', 'error');
    return;
  }

  setBusy(true);
  setStatus('Enregistrement…');

  try {
    const response = await fetch(DATA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: draftLines.map((line) => ({
          price: line.price,
          quantity: line.quantity,
        })),
      }),
    });

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        body.error || `Le serveur a répondu avec le code ${response.status}`,
      );
    }

    const savedOrder = body?.id ? body : null;

    resetForm();
    showTodayAfterNewSale();
    await fetchData();
    setStatus('');
    showToast({
      title: 'Vente enregistrée',
      message: 'La vente a été ajoutée avec succès.',
    });

    if (savedOrder && window.caissePrint?.autoPrint) {
      await printSaleReceipt(savedOrder, { quiet: true });
    }
  } catch (err) {
    setStatus(`Échec de l'enregistrement : ${err.message}`, 'error');
  } finally {
    setBusy(false);
  }
}

async function fetchData() {
  setBusy(true);
  updatePeriodUi();

  const query = periodQuery();

  try {
    const [dataResponse, statsResponse] = await Promise.all([
      fetch(`${DATA_URL}${query}`),
      fetch(`${STATS_URL}${query}`),
    ]);

    if (!dataResponse.ok) {
      const errBody = await dataResponse.json().catch(() => ({}));
      throw new Error(
        errBody.error || `Le serveur a répondu avec le code ${dataResponse.status}`,
      );
    }

    const dataPayload = await dataResponse.json();
    const orders = Array.isArray(dataPayload)
      ? dataPayload
      : Array.isArray(dataPayload.items)
        ? dataPayload.items
        : [];

    renderList(orders);

    if (statsResponse.ok) {
      renderKpis(await statsResponse.json());
    }

    setStatus('');
  } catch (err) {
    renderList([]);
    listEl.innerHTML = '';
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = `Impossible de charger les données. L'API est-elle démarrée sur ${API_BASE_URL} ?`;
    listEl.appendChild(empty);
    setStatus(`Échec du chargement : ${err.message}`, 'error');
  } finally {
    setBusy(false);
  }
}

function setPeriod(period) {
  if (!PERIOD_LABELS[period]) {
    return;
  }

  if (period === 'today') {
    if (currentPeriod === 'today' && isTodayKey(viewDateKey)) {
      return;
    }
    currentPeriod = 'today';
    viewDateKey = toDateKey(new Date());
    fetchData();
    return;
  }

  if (period === 'week') {
    if (currentPeriod === 'week' && isCurrentWeekAnchor(viewWeekAnchor)) {
      return;
    }
    currentPeriod = 'week';
    viewWeekAnchor = toDateKey(new Date());
    fetchData();
    return;
  }

  if (period === 'month') {
    if (currentPeriod === 'month' && isCurrentMonthAnchor(viewMonthAnchor)) {
      return;
    }
    currentPeriod = 'month';
    viewMonthAnchor = toDateKey(new Date());
    fetchData();
    return;
  }

  if (period === currentPeriod) {
    return;
  }

  currentPeriod = period;
  fetchData();
}

draftLinesEl.addEventListener('click', (event) => {
  const removeBtn = event.target.closest('.btn-remove-draft');
  if (removeBtn) {
    const index = Number(removeBtn.dataset.index);
    if (Number.isNaN(index)) return;
    draftLines.splice(index, 1);
    if (editingLineIndex === index) {
      clearLineEdit();
    } else if (editingLineIndex != null && index < editingLineIndex) {
      editingLineIndex -= 1;
    }
    renderDraft();
    return;
  }

  const lineBtn = event.target.closest('.draft-line-body');
  if (!lineBtn) return;
  const index = Number(lineBtn.dataset.index);
  if (Number.isNaN(index)) return;
  selectDraftLine(index);
});

listEl.addEventListener('click', (event) => {
  const actionEl = event.target.closest('[data-action]');
  if (!actionEl) return;

  const li = actionEl.closest('li[data-id]');
  if (!li) return;

  const id = Number(li.dataset.id);

  if (actionEl.dataset.action === 'toggle') {
    toggleOrderDetails(id);
    const summary = li.querySelector('.entry-summary');
    if (summary) {
      summary.setAttribute('aria-expanded', String(expandedOrderId === id));
    }
    return;
  }

  if (actionEl.disabled) return;

  if (actionEl.dataset.action === 'print') {
    event.stopPropagation();
    const order = lastOrders.find((row) => row.id === id);
    if (order) {
      printSaleReceipt(order);
    }
    return;
  }

});

listEl.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;

  const summary = event.target.closest('.entry-summary[data-action="toggle"]');
  if (!summary) return;

  event.preventDefault();
  const li = summary.closest('li[data-id]');
  if (!li) return;

  const id = Number(li.dataset.id);
  toggleOrderDetails(id);
  summary.setAttribute('aria-expanded', String(expandedOrderId === id));
});

filterButtons.forEach((btn) => {
  btn.addEventListener('click', () => setPeriod(btn.dataset.period));
});

dayPrevBtn?.addEventListener('click', () => shiftPeriodNav(-1));
dayNextBtn?.addEventListener('click', () => shiftPeriodNav(1));
printAllDayBtn?.addEventListener('click', printAllDaySales);

addLineBtn.addEventListener('click', addLineToDraft);
submitOrderBtn.addEventListener('click', submitOrder);
cancelBtn.addEventListener('click', resetForm);
fetchBtn.addEventListener('click', refreshData);
themeToggle?.addEventListener('click', toggleTheme);

window.caisseShowToast = showToast;
window.caisseSetStatus = setStatus;

function formatAppVersionLabel(version) {
  const value = String(version || '').trim();
  return value ? `v${value.replace(/^v/i, '')}` : '';
}

function setAppVersionLabel(version) {
  const appVersionEl = document.getElementById('appVersion');
  if (!appVersionEl) return;
  const label = formatAppVersionLabel(version);
  if (!label) return;
  appVersionEl.textContent = label;
  appVersionEl.hidden = false;
  appVersionEl.removeAttribute('hidden');
}

async function initAppVersion() {
  setAppVersionLabel(window.caisseApp?.version);

  if (!window.caisseUpdater?.getVersion) return;

  try {
    const version = await window.caisseUpdater.getVersion();
    setAppVersionLabel(version);
  } catch (error) {
    console.warn('Could not read app version from main process:', error);
  }
}

initAppVersion();

initSaleEntryInputs();
initNumpad();
updateThemeToggleUi(getTheme());
updatePeriodUi();
fetchData();
