(function initUpdateUi() {
  const updater = window.caisseUpdater;
  if (!updater) return;

  const modal = document.getElementById('updateModal');
  const messageEl = document.getElementById('updateMessage');
  const versionEl = document.getElementById('updateVersion');
  const progressWrap = document.getElementById('updateProgressWrap');
  const progressFill = document.getElementById('updateProgressFill');
  const progressText = document.getElementById('updateProgressText');
  const actionsAvailable = document.getElementById('updateActionsAvailable');
  const actionsReady = document.getElementById('updateActionsReady');
  const downloadBtn = document.getElementById('updateDownloadBtn');
  const laterBtn = document.getElementById('updateLaterBtn');
  const laterReadyBtn = document.getElementById('updateLaterReadyBtn');
  const installBtn = document.getElementById('updateInstallBtn');
  const checkUpdatesBtn = document.getElementById('checkUpdatesBtn');
  const backdrop = modal?.querySelector('.update-backdrop');

  if (!modal) return;

  let currentVersion = '';
  let manualCheck = false;

  function openModal() {
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => {
      requestAnimationFrame(() => modal.classList.add('is-open'));
    });
  }

  function closeModal() {
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    window.setTimeout(() => {
      modal.hidden = true;
    }, 260);
  }

  function setView(view) {
    progressWrap.hidden = view !== 'downloading';
    actionsAvailable.hidden = view !== 'available';
    actionsReady.hidden = view !== 'ready';
  }

  function formatReleaseNotes(notes) {
    if (!notes) return '';
    if (typeof notes === 'string') return notes.trim();
    if (Array.isArray(notes)) {
      return notes
        .map((entry) => (typeof entry === 'string' ? entry : entry?.note || ''))
        .filter(Boolean)
        .join('\n')
        .trim();
    }
    return '';
  }

  function showAvailable(info) {
    const nextVersion = info?.version || '';
    versionEl.textContent = nextVersion ? `v${nextVersion}` : '';
    messageEl.textContent =
      'Une nouvelle version est disponible. Téléchargez-la pour profiter des dernières améliorations.';

    const notes = formatReleaseNotes(info?.releaseNotes);
    if (notes) {
      messageEl.textContent += `\n\n${notes}`;
    }

    setView('available');
    downloadBtn.textContent = 'Télécharger';
    downloadBtn.disabled = false;
    laterBtn.disabled = false;
    openModal();
  }

  function showDownloading(progress) {
    const percent = Math.max(0, Math.min(100, Math.round(progress?.percent || 0)));
    progressFill.style.width = `${percent}%`;
    progressText.textContent = `Téléchargement… ${percent}%`;
    setView('downloading');
    openModal();
  }

  function showReady(info) {
    const nextVersion = info?.version || '';
    versionEl.textContent = nextVersion ? `v${nextVersion}` : '';
    messageEl.textContent =
      'La mise à jour est prête. Redémarrez l’application pour l’installer.';
    setView('ready');
    openModal();
  }

  function showManualResult(title, message) {
    versionEl.textContent = currentVersion ? `v${currentVersion}` : '';
    messageEl.textContent = message;
    setView('available');
    downloadBtn.textContent = 'Fermer';
    downloadBtn.disabled = false;
    laterBtn.hidden = true;
    openModal();

    const closeManual = () => {
      laterBtn.hidden = false;
      downloadBtn.textContent = 'Télécharger';
      downloadBtn.removeEventListener('click', closeManual);
      closeModal();
    };
    downloadBtn.addEventListener('click', closeManual);
  }

  function isNewerVersion(nextVersion) {
    if (!nextVersion || !currentVersion) return Boolean(nextVersion);
    return nextVersion !== currentVersion;
  }

  updater.onStatus((channel, payload) => {
    switch (channel) {
      case 'update-available':
        if (!isNewerVersion(payload?.version)) return;
        manualCheck = false;
        showAvailable(payload);
        break;
      case 'update-download-progress':
        showDownloading(payload);
        break;
      case 'update-downloaded':
        manualCheck = false;
        showReady(payload);
        break;
      case 'update-not-available':
        if (manualCheck) {
          manualCheck = false;
          showManualResult(
            'À jour',
            'Vous utilisez déjà la dernière version disponible.',
          );
        }
        break;
      case 'update-error':
        if (manualCheck || modal.classList.contains('is-open')) {
          manualCheck = false;
          const msg =
            payload?.message ||
            'Impossible de vérifier les mises à jour pour le moment.';
          if (modal.classList.contains('is-open') && !actionsReady.hidden) {
            break;
          }
          if (msg.includes('404') || msg.toLowerCase().includes('latest')) {
            showManualResult(
              'Mise à jour',
              'Aucune release publiée sur GitHub pour le moment. L’administrateur doit exécuter npm run dist:publish.',
            );
          } else {
            showManualResult('Mise à jour', msg);
          }
          if (modal.classList.contains('is-open')) {
            setView('available');
            downloadBtn.textContent = 'Réessayer';
          }
        }
        break;
      default:
        break;
    }
  });

  downloadBtn.addEventListener('click', async () => {
    if (downloadBtn.textContent === 'Fermer') return;

    downloadBtn.disabled = true;
    laterBtn.disabled = true;
    try {
      if (downloadBtn.textContent === 'Réessayer') {
        manualCheck = true;
        await updater.check();
      } else {
        setView('downloading');
        progressFill.style.width = '0%';
        progressText.textContent = 'Téléchargement… 0%';
        await updater.download();
      }
    } catch (_) {
      downloadBtn.disabled = false;
      laterBtn.disabled = false;
    }
  });

  laterBtn.addEventListener('click', closeModal);
  laterReadyBtn.addEventListener('click', closeModal);
  backdrop?.addEventListener('click', () => {
    if (!actionsReady.hidden) return;
    if (!progressWrap.hidden) return;
    closeModal();
  });

  installBtn.addEventListener('click', () => {
    installBtn.disabled = true;
    installBtn.textContent = 'Redémarrage…';
    updater.install();
  });

  checkUpdatesBtn?.addEventListener('click', async () => {
    manualCheck = true;
    checkUpdatesBtn.disabled = true;
    try {
      await updater.check();
    } catch (_) {
      /* error channel handles UI */
    } finally {
      checkUpdatesBtn.disabled = false;
    }
  });

  updater.isPackaged().then((packaged) => {
    if (packaged && checkUpdatesBtn) {
      checkUpdatesBtn.hidden = false;
    }
  });

  updater.getVersion().then((version) => {
    currentVersion = version || '';
  });
})();
