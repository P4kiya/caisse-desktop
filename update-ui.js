(function initUpdateUi() {
  const updater = window.caisseUpdater;
  const banner = document.getElementById('updateBanner');
  const versionEl = document.getElementById('updateBannerVersion');
  const messageEl = document.getElementById('updateBannerMessage');
  const progressWrap = document.getElementById('updateBannerProgress');
  const progressFill = document.getElementById('updateBannerProgressFill');
  const progressText = document.getElementById('updateBannerProgressText');
  const actionsEl = document.getElementById('updateBannerActions');
  const appVersionEl = document.getElementById('appVersion');

  if (!updater || !banner) return;

  let currentVersion = window.caisseApp?.version || '';
  let updateInProgress = false;

  if (actionsEl) actionsEl.hidden = true;

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

  function setBannerMessage(text) {
    if (messageEl) messageEl.textContent = text;
  }

  function showDownloading(progress, version) {
    updateInProgress = true;
    const percent = Math.max(0, Math.min(100, Math.round(progress?.percent || 0)));
    if (versionEl && version) versionEl.textContent = formatVersion(version);
    if (progressWrap) progressWrap.hidden = false;
    if (progressFill) progressFill.style.width = `${percent}%`;
    if (progressText) {
      progressText.textContent =
        percent > 0 ? `Téléchargement… ${percent}%` : 'Téléchargement…';
    }
    setBannerMessage('Mise à jour en cours. L’application redémarrera automatiquement.');
    showBanner();
  }

  function showRestarting(version) {
    updateInProgress = true;
    if (progressWrap) progressWrap.hidden = true;
    const label = formatVersion(version);
    if (versionEl && label) versionEl.textContent = label;
    setBannerMessage(
      label
        ? `Installation de ${label}… Redémarrage en cours.`
        : 'Installation en cours… Redémarrage automatique.',
    );
    showBanner();
  }

  function onUpdateFound(payload) {
    if (updateInProgress) return;
    const version = payload?.latestVersion || payload?.version;
    if (!version && payload?.updateAvailable !== true) return;

    updateInProgress = true;
    showDownloading({ percent: 0 }, version);
  }

  function handleUpdateStatus(channel, payload) {
    switch (channel) {
      case 'update-check-result':
        if (payload?.updateAvailable) onUpdateFound(payload);
        break;
      case 'update-available':
        onUpdateFound({ updateAvailable: true, latestVersion: payload?.version });
        break;
      case 'update-download-progress':
        showDownloading(payload, payload?.version);
        break;
      case 'update-downloaded':
        showRestarting(payload?.version);
        break;
      case 'update-error':
        updateInProgress = false;
        if (progressWrap) progressWrap.hidden = true;
        setBannerMessage(
          payload?.message || 'La mise à jour a échoué. Réessayez au prochain démarrage.',
        );
        showBanner();
        break;
      default:
        break;
    }
  }

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
        if (result?.updateAvailable) {
          onUpdateFound(result);
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
