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
  const updateTitleEl = document.getElementById('updateTitle');
  const appVersionEl = document.getElementById('appVersion');
  const backdrop = modal?.querySelector('.update-backdrop');

  if (!modal) return;

  let currentVersion = '';
  let manualCheck = false;

  function parseVersionParts(value) {
    return String(value || '')
      .trim()
      .replace(/^v/i, '')
      .split('.')
      .map((part) => Number.parseInt(part, 10) || 0);
  }

  function isNewerVersion(nextVersion) {
    if (!nextVersion) return false;
    if (!currentVersion) return true;

    const next = parseVersionParts(nextVersion);
    const current = parseVersionParts(currentVersion);
    const length = Math.max(next.length, current.length);

    for (let i = 0; i < length; i += 1) {
      const nextPart = next[i] || 0;
      const currentPart = current[i] || 0;
      if (nextPart > currentPart) return true;
      if (nextPart < currentPart) return false;
    }

    return false;
  }

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
    laterBtn.hidden = false;
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
    if (updateTitleEl) {
      updateTitleEl.textContent = 'Mise à jour disponible';
    }

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
    laterBtn.hidden = false;
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

  function showInfoDialog(message, { title = 'Mises à jour' } = {}) {
    if (updateTitleEl) {
      updateTitleEl.textContent = title;
    }

    versionEl.textContent = currentVersion ? `v${currentVersion}` : '';
    messageEl.textContent = message;
    setView('available');
    downloadBtn.textContent = 'Fermer';
    downloadBtn.disabled = false;
    laterBtn.hidden = true;
    openModal();

    const closeInfo = () => {
      laterBtn.hidden = false;
      downloadBtn.textContent = 'Télécharger';
      downloadBtn.removeEventListener('click', closeInfo);
      closeModal();
    };
    downloadBtn.addEventListener('click', closeInfo);
  }

  function handleUpdateStatus(channel, payload) {
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
          showInfoDialog('Vous utilisez déjà la dernière version disponible.');
        }
        break;
      case 'update-error': {
        const msg =
          payload?.message ||
          'Impossible de vérifier les mises à jour pour le moment.';
        if (!manualCheck) return;
        manualCheck = false;
        if (msg.includes('404') || msg.toLowerCase().includes('latest')) {
          showInfoDialog(
            'Aucune release trouvée sur GitHub. Vérifiez que npm run dist:publish a bien été exécuté.',
          );
        } else {
          showInfoDialog(msg);
        }
        break;
      }
      default:
        break;
    }
  }

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

  function handleManualCheckResult(result) {
    if (!manualCheck) return;

    manualCheck = false;

    if (result?.updateAvailable) {
      showAvailable({
        version: result.latestVersion,
        releaseNotes: result.releaseNotes,
        releaseDate: result.releaseDate,
      });
      return;
    }

    const latest = result?.latestVersion || currentVersion;
    showInfoDialog(
      latest && latest !== currentVersion
        ? `Vous utilisez la v${currentVersion}. La dernière version publiée est la v${latest}.`
        : 'Vous utilisez déjà la dernière version disponible.',
      { title: 'À jour' },
    );
  }

  checkUpdatesBtn?.addEventListener('click', async () => {
    manualCheck = true;
    checkUpdatesBtn.disabled = true;

    try {
      const result = await updater.check();
      handleManualCheckResult(result);
    } catch (error) {
      if (manualCheck) {
        manualCheck = false;
        const msg =
          error?.message ||
          'Impossible de vérifier les mises à jour pour le moment.';
        showInfoDialog(msg, { title: 'Erreur' });
      }
    } finally {
      checkUpdatesBtn.disabled = false;
    }
  });

  async function boot() {
    currentVersion = (await updater.getVersion()) || '';
    if (appVersionEl) {
      appVersionEl.textContent = currentVersion ? `v${currentVersion}` : '';
    }

    updater.onStatus(handleUpdateStatus);

    const packaged = await updater.isPackaged();
    if (packaged && checkUpdatesBtn) {
      checkUpdatesBtn.hidden = false;
    }

    if (packaged && updater.notifyReady) {
      await updater.notifyReady();
    }
  }

  boot();
})();
