const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');
const { app } = require('electron');

const DEFAULT_ENV = `MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=asas
MYSQL_DATABASE=caisse
PORT=3000
API_BASE_URL=http://localhost:3000
`;

function readApiPort(caisseHome) {
  try {
    const envPath = path.join(caisseHome, 'caisse_api', '.env');
    if (fs.existsSync(envPath)) {
      const env = fs.readFileSync(envPath, 'utf8');
      const m = env.match(/^\s*PORT\s*=\s*(\d+)/m);
      if (m) return Number(m[1]);
    }
    const cfgPath = path.join(caisseHome, 'setup', 'config.env');
    if (fs.existsSync(cfgPath)) {
      const cfg = fs.readFileSync(cfgPath, 'utf8');
      const m = cfg.match(/^\s*PORT\s*=\s*(\d+)/m);
      if (m) return Number(m[1]);
    }
  } catch (_) {
    /* ignore */
  }
  return 3000;
}

function getBundledApiSource() {
  if (!app.isPackaged) {
    const dev = path.join(__dirname, '..', 'caisse_api');
    if (fs.existsSync(path.join(dev, 'server.js'))) return dev;
    return null;
  }
  const bundled = path.join(process.resourcesPath, 'caisse_api');
  if (fs.existsSync(path.join(bundled, 'server.js'))) return bundled;
  return null;
}

function readHomePathFromRegistry() {
  const files = [
    path.join(process.env.PROGRAMDATA || '', 'Caisse', 'home.path'),
    path.join(process.env.LOCALAPPDATA || '', 'Caisse', 'home.path'),
  ];
  for (const file of files) {
    try {
      if (fs.existsSync(file)) {
        const root = fs.readFileSync(file, 'utf8').trim();
        if (root && fs.existsSync(path.join(root, 'caisse_api', 'server.js'))) {
          return root;
        }
      }
    } catch (_) {
      /* ignore */
    }
  }
  return null;
}

function getWritableCaisseHome() {
  const existing = readHomePathFromRegistry();
  if (existing) return existing;

  const bundled = getBundledApiSource();
  const home = path.join(process.env.LOCALAPPDATA || '', 'Caisse', 'app-data');
  const apiDir = path.join(home, 'caisse_api');

  if (!fs.existsSync(path.join(apiDir, 'server.js')) && bundled) {
    fs.mkdirSync(home, { recursive: true });
    fs.cpSync(bundled, apiDir, {
      recursive: true,
      filter: (src) => !String(src).includes(`${path.sep}node_modules${path.sep}`),
    });
  }

  if (fs.existsSync(path.join(apiDir, 'server.js'))) {
    return home;
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

function saveHomePath(caisseHome) {
  const targets = [
    path.join(process.env.PROGRAMDATA || '', 'Caisse'),
    path.join(process.env.LOCALAPPDATA || '', 'Caisse'),
  ];
  for (const dir of targets) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'home.path'), caisseHome.trim(), 'utf8');
    } catch (_) {
      /* ignore */
    }
  }
}

function ensureEnvFile(caisseHome) {
  const apiEnv = path.join(caisseHome, 'caisse_api', '.env');
  if (!fs.existsSync(apiEnv)) {
    fs.mkdirSync(path.dirname(apiEnv), { recursive: true });
    fs.writeFileSync(apiEnv, DEFAULT_ENV, 'utf8');
  }
}

function resolveNodeExecutable() {
  const fromPath = process.env.PATH?.split(';')
    .map((p) => path.join(p.trim(), 'node.exe'))
    .find((p) => p && fs.existsSync(p));
  if (fromPath) return fromPath;

  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const candidates = [
    path.join(programFiles, 'nodejs', 'node.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'nodejs', 'node.exe'),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function resolveNpmExecutable() {
  const fromPath = process.env.PATH?.split(';')
    .map((p) => path.join(p.trim(), 'npm.cmd'))
    .find((p) => p && fs.existsSync(p));
  if (fromPath) return fromPath;
  const node = resolveNodeExecutable();
  if (node) {
    const npm = path.join(path.dirname(node), 'npm.cmd');
    if (fs.existsSync(npm)) return npm;
  }
  return 'npm.cmd';
}

function ensureApiDependencies(caisseHome) {
  const apiDir = path.join(caisseHome, 'caisse_api');
  const nodeModules = path.join(apiDir, 'node_modules');
  const flag = path.join(caisseHome, 'setup', 'logs', 'npm-ready.flag');

  if (fs.existsSync(nodeModules) && fs.existsSync(flag)) {
    return { ok: true, skipped: true };
  }

  if (!resolveNodeExecutable()) {
    return {
      ok: false,
      error:
        'Node.js n est pas installe. Installez Node.js ou utilisez Caisse.cmd une fois.',
    };
  }

  const npm = resolveNpmExecutable();
  const result = spawnSync(npm, ['install', '--omit=dev'], {
    cwd: apiDir,
    windowsHide: true,
    timeout: 600000,
    env: { ...process.env },
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').slice(-500);
    return {
      ok: false,
      error: `npm install a echoue. ${detail || 'Verifiez que Node.js est installe.'}`,
    };
  }

  fs.mkdirSync(path.dirname(flag), { recursive: true });
  fs.writeFileSync(flag, new Date().toISOString(), 'utf8');
  return { ok: true, skipped: false };
}

async function prepareCaisseBackend() {
  const home = getWritableCaisseHome();
  if (!home) {
    return {
      ok: false,
      error:
        'Fichiers serveur introuvables. Reinstallez Caisse ou placez le dossier caisse_api a cote de l application.',
    };
  }

  fs.mkdirSync(path.join(home, 'setup', 'logs'), { recursive: true });
  ensureEnvFile(home);
  saveHomePath(home);

  const deps = ensureApiDependencies(home);
  if (!deps.ok) {
    return { ok: false, error: deps.error, home };
  }

  return { ok: true, home, firstDepsInstall: !deps.skipped };
}

function isApiUp(port = 3000) {
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

function startApiHidden(caisseHome) {
  const apiDir = path.join(caisseHome, 'caisse_api');
  const serverJs = path.join(apiDir, 'server.js');
  const logDir = path.join(caisseHome, 'setup', 'logs');
  fs.mkdirSync(logDir, { recursive: true });

  const logOut = fs.openSync(path.join(logDir, 'api.log'), 'a');
  const logErr = fs.openSync(path.join(logDir, 'api-error.log'), 'a');

  const node = resolveNodeExecutable();
  if (!node) {
    throw new Error('Node.js introuvable');
  }

  const ts = new Date().toISOString();
  fs.appendFileSync(path.join(logDir, 'api.log'), `\n--- Demarrage API ${ts} (DB auto si besoin) ---\n`);

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

function readApiLogTail(caisseHome, lines = 8) {
  try {
    const logPath = path.join(caisseHome, 'setup', 'logs', 'api-error.log');
    if (!fs.existsSync(logPath)) return '';
    const content = fs.readFileSync(logPath, 'utf8');
    return content.split('\n').slice(-lines).join('\n').trim();
  } catch (_) {
    return '';
  }
}

async function ensureBackendRunning() {
  const prepared = await prepareCaisseBackend();
  if (!prepared.ok) {
    return prepared;
  }

  const { home } = prepared;
  const port = readApiPort(home);

  if (await isApiUp(port)) {
    return { ok: true, alreadyRunning: true, port, home };
  }

  try {
    startApiHidden(home);
  } catch (err) {
    return { ok: false, error: err.message || String(err), home };
  }

  for (let i = 0; i < 50; i += 1) {
    await new Promise((r) => setTimeout(r, 500));
    if (await isApiUp(port)) {
      return {
        ok: true,
        alreadyRunning: false,
        home,
        port,
        firstDepsInstall: prepared.firstDepsInstall,
      };
    }
  }

  const tail = readApiLogTail(home);
  const hint = tail
    ? `\n\n${tail}`
    : '\n\nVerifiez que MySQL est installe et demarre (port 3306).';

  return {
    ok: false,
    error: `Le serveur ne demarre pas.${hint}`,
    home,
  };
}

module.exports = {
  ensureBackendRunning,
  prepareCaisseBackend,
  getWritableCaisseHome,
  isApiUp,
};
