# caisse-desktop

Electron desktop UI for the caisse API. This app only talks to the backend over HTTP; it does not store business data locally.

## Prerequisites

- Node.js 18+
- The API running (see `../caisse-api`) at `http://localhost:3000` for local development

## Setup

```bash
cd caisse-desktop
npm install
```

## Run in development

1. Start the API in another terminal:

   ```bash
   cd ../caisse-api
   npm start
   ```

2. Start the desktop app:

   ```bash
   npm start
   ```

## Point to production (VPS)

Edit the first line in `renderer.js`:

```javascript
const API_BASE_URL = 'https://your-vps-domain.com';
```

Use your real API origin (scheme + host + port if not 443). Do not add a trailing slash.

## Package as Windows `.exe`

`electron-builder` is configured in `package.json`.

```bash
npm run dist
```

Output:

- **Installer:** `dist/Caisse Setup x.x.x.exe` (NSIS installer, x64)
- Unpacked app (for testing without installer): `npm run dist:dir` → `dist/win-unpacked/`

First build downloads Electron binaries; it can take a few minutes.

### Optional: app icon

Add `build/icon.ico` (256×256 recommended) and set in `package.json` under `build.win.icon` if you want a custom icon on the `.exe`.

### Code signing

Unsigned builds work locally; Windows SmartScreen may warn on first run. For distribution, sign the installer with a code-signing certificate.

## Automatic updates (GitHub Releases)

The installed app checks for updates on startup and every 4 hours. When a newer version exists, users see a **centered popup** to download and restart.

Updates work only in the **packaged installer** (`npm run dist`), not when running `npm run dev`.

### 1. Configure GitHub

In `package.json`, under `build.publish`, set your GitHub username and repository name:

```json
"publish": [
  {
    "provider": "github",
    "owner": "your-github-username",
    "repo": "caisse-desktop"
  }
]
```

Create the repository on GitHub and push this project.

### 2. Publish a release

1. Bump the version in `package.json` (e.g. `1.0.0` → `1.0.1`).
2. Create a [GitHub personal access token](https://github.com/settings/tokens) with `repo` scope.
3. Build and upload to GitHub Releases:

   ```bash
   set GH_TOKEN=ghp_your_token_here
   npm run dist:publish
   ```

   On PowerShell:

   ```powershell
   $env:GH_TOKEN="ghp_your_token_here"
   npm run dist:publish
   ```

This uploads the installer and `latest.yml` (required for auto-update).

### 3. User experience

1. User runs an older installed version.
2. App detects `1.0.1` on GitHub.
3. Popup: **Mise à jour disponible** → **Télécharger** → progress bar → **Redémarrer**.

### Notes

- Each release must have a **higher** `version` in `package.json` than the one users have installed.
- Optional: add release notes on GitHub; they can appear in the update popup.
- Logs: `%USERPROFILE%\AppData\Roaming\Caisse\logs\main.log`

## Project layout

| File          | Role                                      |
|---------------|-------------------------------------------|
| `main.js`     | Electron main process, window lifecycle   |
| `updater.js`  | Auto-update checks (`electron-updater`)   |
| `update-ui.js`| Update popup in the renderer                |
| `index.html`  | UI (inputs, buttons, list)                |
| `renderer.js` | `fetch()` calls to the API                |
