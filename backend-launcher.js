const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { app } = require('electron');

function readApiPort(caisseHome) {
  try {
    const cfgPath = path.join(caisseHome, 'setup', 'config.env');
    if (fs.existsSync(cfgPath)) {
      const cfg = fs.readFileSync(cfgPath, 'utf8');
      const m = cfg.match(/^\s*PORT\s*=\s*(\d+)/m);
      if (m) return Number(m[1]);
    }
    const envPath = path.join(caisseHome, 'caisse_api', '.env');
    if (fs.existsSync(envPath)) {
      const env = fs.readFileSync(envPath, 'utf8');
      const m = env.match(/^\s*PORT\s*=\s*(\d+)/m);
      if (m) return Number(m[1]);
    }
  } catch (_) {
    /* ignore */
  }
  return 3000;
}

function getHomePathCandidates() {
  const list = [];
  if (process.env.CAISSE_HOME) list.push(process.env.CAISSE_HOME);

  const programData = process.env.PROGRAMDATA || 'C:\\ProgramData';
  const localApp = process.env.LOCALAPPDATA || '';

  list.push(path.join(programData, 'Caisse', 'home.path'));
  list.push(path.join(localApp, 'Caisse', 'home.path'));
  list.push(path.join(localApp, 'Programs', 'Caisse', 'home.path'));

  if (app.isPackaged) {
    list.push(path.join(path.dirname(process.execPath), 'home.path'));
    list.push(path.join(process.resourcesPath, 'home.path'));
  }

  list.push(path.join(__dirname, '..', 'home.path'));
  return list;
}

function readCaisseHome() {
  for (const file of getHomePathCandidates()) {
    try {
      if (!file.endsWith('home.path')) continue;
      if (!fs.existsSync(file)) continue;
      const root = fs.readFileSync(file, 'utf8').trim();
      if (root && fs.existsSync(path.join(root, 'caisse_api', 'server.js'))) {
        return root;
      }
    } catch (_) {
      /* ignore */
    }
  }

  let dir = app.isPackaged ? path.dirname(process.execPath) : path.join(__dirname, '..');
  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(dir, 'caisse_api', 'server.js'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return null;
}

function isApiUp(port = API_PORT) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/`, { timeout: 2000 }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

function resolveNodeExecutable() {
  const fromPath = process.env.PATH?.split(';')
    .map((p) => path.join(p.trim(), 'node.exe'))
    .find((p) => p && fs.existsSync(p));
  if (fromPath) return fromPath;

  const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
  const candidates = [
    path.join(programFiles, 'nodejs', 'node.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'nodejs', 'node.exe'),
  ];
  return candidates.find((p) => fs.existsSync(p)) || 'node';
}

function startApiHidden(caisseHome) {
  const apiDir = path.join(caisseHome, 'caisse_api');
  const serverJs = path.join(apiDir, 'server.js');
  const logDir = path.join(caisseHome, 'setup', 'logs');
  fs.mkdirSync(logDir, { recursive: true });

  const logOut = fs.openSync(path.join(logDir, 'api.log'), 'a');
  const logErr = fs.openSync(path.join(logDir, 'api-error.log'), 'a');

  const node = resolveNodeExecutable();
  const child = spawn(node, [serverJs], {
    cwd: apiDir,
    detached: true,
    stdio: ['ignore', logOut, logErr],
    windowsHide: true,
    env: { ...process.env },
  });
  child.unref();
  return child.pid;
}

async function ensureBackendRunning() {
  const home = readCaisseHome();
  const port = home ? readApiPort(home) : 3000;

  if (await isApiUp(port)) {
    return { ok: true, alreadyRunning: true, port };
  }

  if (!home) {
    return {
      ok: false,
      error: 'Dossier caisse_api introuvable. Lancez Caisse.cmd une fois pour installer.',
    };
  }

  try {
    startApiHidden(home);
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }

  for (let i = 0; i < 40; i += 1) {
    await new Promise((r) => setTimeout(r, 500));
    if (await isApiUp(port)) {
      return { ok: true, alreadyRunning: false, home, port };
    }
  }

  return { ok: false, error: `Le serveur ne repond pas sur le port ${port}.` };
}

module.exports = { ensureBackendRunning, readCaisseHome, isApiUp };
