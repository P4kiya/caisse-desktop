const fs = require('fs');
const path = require('path');
function parseEnvFile(content) {
  const vars = {};
  for (const line of String(content || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const m = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    vars[m[1]] = value;
  }
  return vars;
}

function getCaisseHome() {
  const fromEnv = (process.env.CAISSE_HOME || '').trim();
  if (fromEnv) return path.normalize(fromEnv);

  const standard = 'C:\\caisse';
  if (fs.existsSync(path.join(standard, 'caisse_api', 'server.js'))) {
    return standard;
  }

  const pointerFiles = [
    path.join(process.env.PROGRAMDATA || '', 'Caisse', 'home.path'),
    path.join(process.env.LOCALAPPDATA || '', 'Caisse', 'home.path'),
  ];
  for (const file of pointerFiles) {
    try {
      if (fs.existsSync(file)) {
        const root = fs.readFileSync(file, 'utf8').trim();
        if (fs.existsSync(path.join(root, 'caisse_api', 'server.js'))) {
          return path.normalize(root);
        }
      }
    } catch (_) {
      /* ignore */
    }
  }
  return standard;
}

function applyEnvVars(vars) {
  for (const [key, value] of Object.entries(vars)) {
    if (value !== undefined && value !== '') {
      process.env[key] = value;
    }
  }
}

/** Charge .env app puis config client (C:\caisse\...) — le client ecrase l app. */
function loadClientEnv(appDir) {
  const caisseHome = getCaisseHome();
  const files = [
    path.join(appDir, '.env'),
    path.join(caisseHome, 'caisse_api', '.env'),
    path.join(caisseHome, 'setup', 'config.env'),
    path.join(caisseHome, 'setup', 'print.env'),
  ];

  for (const file of files) {
    try {
      if (!fs.existsSync(file)) continue;
      applyEnvVars(parseEnvFile(fs.readFileSync(file, 'utf8')));
    } catch (_) {
      /* ignore */
    }
  }
}

module.exports = { loadClientEnv, getCaisseHome, parseEnvFile };
