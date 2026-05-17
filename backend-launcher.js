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

/** Dossier d installation standard sur tous les PC client */
function getStandardCaisseRoot() {
  const fromEnv = (process.env.CAISSE_HOME || '').trim();
  return path.normalize(fromEnv || 'C:\\caisse');
}

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

function isValidCaisseHome(dir) {
  return (
    dir &&
    fs.existsSync(path.join(dir, 'caisse_api', 'server.js'))
  );
}

function readHomePathFromRegistry() {
  const standard = getStandardCaisseRoot();
  if (isValidCaisseHome(standard)) return standard;

  const files = [
    path.join(process.env.PROGRAMDATA || '', 'Caisse', 'home.path'),
    path.join(process.env.LOCALAPPDATA || '', 'Caisse', 'home.path'),
  ];
  for (const file of files) {
    try {
      if (fs.existsSync(file)) {
        const root = fs.readFileSync(file, 'utf8').trim();
        if (isValidCaisseHome(root)) return root;
      }
    } catch (_) {
      /* ignore */
    }
  }
  return null;
}

function copyTreeFiltered(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, {
    recursive: true,
    filter: (srcPath) => !String(srcPath).includes(`${path.sep}node_modules${path.sep}`),
  });
}

function copyBundledSetupScripts(root) {
  if (!app.isPackaged) {
    const devSetup = path.join(__dirname, '..', 'setup', 'scripts', 'Start-CaisseApi.ps1');
    const dest = path.join(root, 'setup', 'scripts', 'Start-CaisseApi.ps1');
    if (fs.existsSync(devSetup)) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      if (!fs.existsSync(dest)) fs.copyFileSync(devSetup, dest);
    }
    const devCmd = path.join(__dirname, '..', 'Caisse.cmd');
    const cmdDest = path.join(root, 'Caisse.cmd');
    if (fs.existsSync(devCmd) && !fs.existsSync(cmdDest)) {
      fs.copyFileSync(devCmd, cmdDest);
    }
    return;
  }

  const ps1Bundled = path.join(process.resourcesPath, 'setup', 'scripts', 'Start-CaisseApi.ps1');
  const ps1Dest = path.join(root, 'setup', 'scripts', 'Start-CaisseApi.ps1');
  if (fs.existsSync(ps1Bundled)) {
    fs.mkdirSync(path.dirname(ps1Dest), { recursive: true });
    if (!fs.existsSync(ps1Dest)) fs.copyFileSync(ps1Bundled, ps1Dest);
  }
}

function populateStandardCaisseRoot(fromRoot) {
  const root = getStandardCaisseRoot();
  if (isValidCaisseHome(root)) return true;

  fs.mkdirSync(path.join(root, 'setup', 'logs'), { recursive: true });

  const apiDir = path.join(root, 'caisse_api');
  const registryHome = readHomePathFromRegistry();
  const sources = [fromRoot, registryHome, path.join(__dirname, '..')]
    .filter(Boolean)
    .filter((dir) => isValidCaisseHome(dir));

  for (const src of sources) {
    if (src.toLowerCase() === root.toLowerCase()) continue;
    try {
      copyTreeFiltered(path.join(src, 'caisse_api'), apiDir);
      const setupSrc = path.join(src, 'setup');
      if (fs.existsSync(setupSrc)) {
        copyTreeFiltered(setupSrc, path.join(root, 'setup'));
      }
      const cmdSrc = path.join(src, 'Caisse.cmd');
      if (fs.existsSync(cmdSrc) && !fs.existsSync(path.join(root, 'Caisse.cmd'))) {
        fs.copyFileSync(cmdSrc, path.join(root, 'Caisse.cmd'));
      }
      if (isValidCaisseHome(root)) break;
    } catch (_) {
      /* try next source */
    }
  }

  if (!isValidCaisseHome(root)) {
    const bundled = getBundledApiSource();
    if (bundled) {
      copyTreeFiltered(bundled, apiDir);
    }
  }

  copyBundledSetupScripts(root);
  return isValidCaisseHome(root);
}

function findCaisseCmdRoot() {
  const seen = new Set();
  const candidates = [getStandardCaisseRoot()];

  if (process.env.CAISSE_HOME) {
    candidates.push(process.env.CAISSE_HOME.trim());
  }

  const fromRegistry = readHomePathFromRegistry();
  if (fromRegistry) candidates.push(fromRegistry);

  let dir = app.isPackaged ? path.dirname(process.execPath) : path.join(__dirname, '..');
  for (let i = 0; i < 10; i += 1) {
    candidates.push(dir);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  candidates.push(path.join(__dirname, '..'));

  for (const root of candidates) {
    if (!root || seen.has(root)) continue;
    seen.add(root);
    const cmd = path.join(root, 'Caisse.cmd');
    if (fs.existsSync(cmd) && isValidCaisseHome(root)) {
      return root;
    }
  }

  return null;
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

function getWritableCaisseHome() {
  const standard = getStandardCaisseRoot();

  if (isValidCaisseHome(standard)) {
    return standard;
  }

  const legacy = findCaisseCmdRoot();
  if (populateStandardCaisseRoot(legacy)) {
    return standard;
  }

  let dir = app.isPackaged ? path.dirname(process.execPath) : path.join(__dirname, '..');
  for (let i = 0; i < 8; i += 1) {
    if (isValidCaisseHome(dir) && populateStandardCaisseRoot(dir)) {
      return standard;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return null;
}

function saveHomePath(caisseHome) {
  const root = getStandardCaisseRoot();
  const content = isValidCaisseHome(root) ? root : caisseHome.trim();

  const targets = [
    path.join(process.env.PROGRAMDATA || '', 'Caisse'),
    path.join(process.env.LOCALAPPDATA || '', 'Caisse'),
  ];
  for (const dir of targets) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'home.path'), content, 'utf8');
    } catch (_) {
      /* ignore */
    }
  }

  try {
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'home.path'), content, 'utf8');
  } catch (_) {
    /* ignore */
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

  const candidates = [
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'node.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'nodejs', 'node.exe'),
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
  return null;
}

function envWithNodeOnPath() {
  const env = { ...process.env };
  const node = resolveNodeExecutable();
  if (node) {
    const nodeDir = path.dirname(node);
    const pathKey = process.platform === 'win32' ? 'Path' : 'PATH';
    const current = env[pathKey] || env.PATH || '';
    if (!current.toLowerCase().includes(nodeDir.toLowerCase())) {
      env[pathKey] = `${nodeDir};${current}`;
    }
  }
  return env;
}

function apiDepsReady(caisseHome) {
  return fs.existsSync(
    path.join(caisseHome, 'caisse_api', 'node_modules', 'express', 'package.json'),
  );
}

function ensureApiDependencies(caisseHome) {
  if (apiDepsReady(caisseHome)) {
    return { ok: true };
  }

  const node = resolveNodeExecutable();
  if (!node) {
    return {
      ok: false,
      error:
        'Node.js n est pas installe. Telechargez-le sur https://nodejs.org puis redemarrez Caisse.',
    };
  }

  const npm = resolveNpmExecutable();
  if (!npm) {
    return {
      ok: false,
      error: 'npm introuvable. Reinstallez Node.js (version LTS) avec npm inclus.',
    };
  }

  const apiDir = path.join(caisseHome, 'caisse_api');
  const nodeModules = path.join(apiDir, 'node_modules');
  if (fs.existsSync(nodeModules)) {
    try {
      fs.rmSync(nodeModules, { recursive: true, force: true });
    } catch (_) {
      /* ignore */
    }
  }

  const logDir = path.join(caisseHome, 'setup', 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, 'npm-install.log');

  const result = spawnSync(npm, ['install', '--omit=dev'], {
    cwd: apiDir,
    windowsHide: true,
    timeout: 600000,
    env: envWithNodeOnPath(),
    encoding: 'utf8',
  });

  if (result.status !== 0 || !apiDepsReady(caisseHome)) {
    let tail = '';
    try {
      if (fs.existsSync(logFile)) {
        tail = fs.readFileSync(logFile, 'utf8').split('\n').slice(-8).join('\n').trim();
      }
    } catch (_) {
      /* ignore */
    }
    const detail = (result.stderr || result.stdout || tail || '').slice(-600);
    return {
      ok: false,
      error: `npm install a echoue.${detail ? `\n\n${detail}` : '\n\nVerifiez que Node.js est installe.'}`,
    };
  }

  return { ok: true };
}

function resolveStartScript(caisseHome) {
  const inProject = path.join(caisseHome, 'setup', 'scripts', 'Start-CaisseApi.ps1');
  if (fs.existsSync(inProject)) return inProject;

  if (app.isPackaged) {
    const bundled = path.join(process.resourcesPath, 'setup', 'scripts', 'Start-CaisseApi.ps1');
    if (fs.existsSync(bundled)) return bundled;
  }

  return null;
}

function startApiViaCaisseCmd(caisseHome) {
  const cmdPath = path.join(caisseHome, 'Caisse.cmd');
  if (fs.existsSync(cmdPath)) {
    const child = spawn('cmd.exe', ['/c', cmdPath, '--api-only'], {
      cwd: caisseHome,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: envWithNodeOnPath(),
    });
    child.unref();
    return { method: 'Caisse.cmd', pid: child.pid };
  }

  const ps1 = resolveStartScript(caisseHome);
  if (!ps1) {
    throw new Error('Caisse.cmd et Start-CaisseApi.ps1 introuvables');
  }

  const child = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      ps1,
      '-ProjectRoot',
      caisseHome,
    ],
    {
      cwd: caisseHome,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: envWithNodeOnPath(),
    },
  );
  child.unref();
  return { method: 'Start-CaisseApi.ps1', pid: child.pid };
}

function isApiUp(port = 3000) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/stats?period=today`, { timeout: 2000 }, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 600);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

function readApiLogTail(caisseHome, lines = 10) {
  try {
    const logPath = path.join(caisseHome, 'setup', 'logs', 'api-error.log');
    if (!fs.existsSync(logPath)) return '';
    const content = fs.readFileSync(logPath, 'utf8');
    return content.split('\n').slice(-lines).join('\n').trim();
  } catch (_) {
    return '';
  }
}

async function prepareCaisseBackend() {
  const home = getWritableCaisseHome();
  if (!home) {
    return {
      ok: false,
      error:
        'Dossier Caisse introuvable. Copiez caisse_api et setup dans C:\\caisse (ou definissez CAISSE_HOME).',
    };
  }

  fs.mkdirSync(path.join(home, 'setup', 'logs'), { recursive: true });
  ensureEnvFile(home);
  saveHomePath(home);

  const deps = ensureApiDependencies(home);
  if (!deps.ok) {
    return { ok: false, error: deps.error, home };
  }

  return { ok: true, home, usesCmd: fs.existsSync(path.join(home, 'Caisse.cmd')) };
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
    const started = startApiViaCaisseCmd(home);
    prepared.startMethod = started.method;
  } catch (err) {
    return { ok: false, error: err.message || String(err), home };
  }

  const maxAttempts = 90;
  for (let i = 0; i < maxAttempts; i += 1) {
    await new Promise((r) => setTimeout(r, 500));
    if (await isApiUp(port)) {
      return {
        ok: true,
        alreadyRunning: false,
        home,
        port,
        startMethod: prepared.startMethod,
      };
    }
  }

  const tail = readApiLogTail(home);
  const hint = tail
    ? `\n\n${tail}`
    : '\n\nVerifiez Node.js, MySQL (port 3306) et le dossier caisse_api.';

  return {
    ok: false,
    error: `Le serveur ne repond pas sur le port ${port}.${hint}`,
    home,
  };
}

module.exports = {
  ensureBackendRunning,
  prepareCaisseBackend,
  getWritableCaisseHome,
  getStandardCaisseRoot,
  findCaisseCmdRoot,
  isApiUp,
};
