(function initUpdateUi() {
  const updater = window.caisseUpdater;
  const banner = document.getElementById('updateBanner');
  const versionEl = document.getElementById('updateBannerVersion');
  const messageEl = document.getElementById('updateBannerMessage');
  const progressWrap = document.getElementById('updateBannerProgress');
  const progressFill = document.getElementById('updateBannerProgressFill');
  const progressText = document.getElementById('updateBannerProgressText');
  const actionsEl = document.getElementById('updateBannerActions');
  const applyBtn = document.getElementById('updateApplyBtn');
  const laterBtn = document.getElementById('updateLaterBtn');
  const appVersionEl = document.getElementById('appVersion');

  if (!updater || !banner) return;

  let currentVersion = window.caisseApp?.version || '';
  let updateDismissed = false;
  let updateInProgress = false;
  let pendingPayload = null;

  function formatVersion(value) {
    const v = String(value || '').trim();
    return v ? (v.startsWith('v') ? v : `v${v}`) : '';
  }

  function showBanner() {
    banner.hidden = false;
    banner.removeAttribute('hidden');
    banner.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => banner.classList.add('is-visible'));
  }

  function hideBanner() {
    banner.classList.remove('is-visible');
    banner.setAttribute('aria-hidden', 'true');
    window.setTimeout(() => {
      banner.hidden = true;
    }, 280);
  }

  function setBannerMessage(text) {
    if (messageEl) messageEl.textContent = text;
  }

  function showUpdateOffer(payload) {
    if (updateDismissed || updateInProgress) return;

    pendingPayload = payload;
    const nextVersion = formatVersion(payload.latestVersion);
    if (versionEl) versionEl.textContent = nextVersion;
    setBannerMessage(
      `La version ${nextVersion} est disponible. L’application redémarrera automatiquement après la mise à jour.`,
    );

    if (progressWrap) progressWrap.hidden = true;
    if (actionsEl) actionsEl.hidden = false;
    if (applyBtn) {
      applyBtn.disabled = false;
      applyBtn.textContent = 'Mise à jour';
    }
    if (laterBtn) laterBtn.disabled = false;

    showBanner();
  }

  function showDownloading(progress) {
    updateInProgress = true;
    const percent = Math.max(0, Math.min(100, Math.round(progress?.percent || 0)));
    if (progressWrap) progressWrap.hidden = false;
    if (actionsEl) actionsEl.hidden = true;
    if (progressFill) progressFill.style.width = `${percent}%`;
    if (progressText) {
      progressText.textContent =
        percent > 0 ? `Téléchargement… ${percent}%` : 'Téléchargement…';
    }
    setBannerMessage('Téléchargement de la mise à jour en cours…');
    showBanner();
  }

  function showRestarting(version) {
    updateInProgress = true;
    if (progressWrap) progressWrap.hidden = true;
    if (actionsEl) actionsEl.hidden = true;
    const label = formatVersion(version);
    setBannerMessage(
      label
        ? `Installation de ${label}… L’application va redémarrer.`
        : 'Installation en cours… L’application va redémarrer.',
    );
    showBanner();
  }

  function handleUpdateStatus(channel, payload) {
    switch (channel) {
      case 'update-check-result':
        if (payload?.updateAvailable && !updateDismissed && !updateInProgress) {
          showUpdateOffer(payload);
        }
        break;
      case 'update-download-progress':
        showDownloading(payload);
        break;
      case 'update-downloaded':
        showRestarting(payload?.version);
        break;
      case 'update-error':
        updateInProgress = false;
        if (applyBtn) applyBtn.disabled = false;
        if (laterBtn) laterBtn.disabled = false;
        if (actionsEl) actionsEl.hidden = false;
        if (progressWrap) progressWrap.hidden = true;
        setBannerMessage(
          payload?.message || 'La mise à jour a échoué. Réessayez plus tard.',
        );
        showBanner();
        break;
      default:
        break;
    }
  }

  applyBtn?.addEventListener('click', async () => {
    if (updateInProgress) return;

    updateInProgress = true;
    applyBtn.disabled = true;
    laterBtn.disabled = true;
    showDownloading({ percent: 0 });

    try {
      await updater.download();
    } catch (error) {
      updateInProgress = false;
      applyBtn.disabled = false;
      laterBtn.disabled = false;
      if (actionsEl) actionsEl.hidden = false;
      if (progressWrap) progressWrap.hidden = true;
      setBannerMessage(
        error?.message || 'Échec du téléchargement. Réessayez plus tard.',
      );
    }
  });

  laterBtn?.addEventListener('click', () => {
    updateDismissed = true;
    pendingPayload = null;
    hideBanner();
  });

  async function boot() {
    try {
      currentVersion = (await updater.getVersion()) || currentVersion;
    } catch (error) {
      console.warn('Could not read app version:', error);
    }

    if (appVersionEl && currentVersion) {
      appVersionEl.textContent = formatVersion(currentVersion);
      appVersionEl.hidden = false;
    }

    updater.onStatus(handleUpdateStatus);

    if (updater.notifyReady) {
      try {
        const result = await updater.notifyReady();
        if (result?.updateAvailable && !updateDismissed) {
          showUpdateOffer(result);
        }
      } catch (error) {
        console.warn('Startup update check failed:', error);
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => boot());
  } else {
    boot();
  }
})();
