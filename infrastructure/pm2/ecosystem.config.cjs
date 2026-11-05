// PM2 process list for the VPS. Paths go through the /opt/park2all/current symlink, so a reload picks up the new release.
// Fork mode, one instance each: Socket.IO (/live) and the reservation sweeper assume a single API process.
const fs = require('node:fs');
const path = require('node:path');

const BASE = process.env.PARK2ALL_HOME || '/opt/park2all';
const CURRENT = path.join(BASE, 'current');
const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };

/** Minimal .env parser (KEY=VALUE, # comments, optional quotes) so PM2 needs no extra packages. */
function loadEnv(file) {
  const out = {};
  for (const line of read(file).split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

const RELEASE_SHA = read(path.join(CURRENT, 'RELEASE')).trim() || 'unknown';
const api = loadEnv(path.join(BASE, 'shared', 'api.env'));
const PUBLIC_URL = api.PUBLIC_URL || 'https://park.2all.co.in';

const common = { exec_mode: 'fork', instances: 1, max_memory_restart: '512M', kill_timeout: 10000, time: true, merge_logs: true };

module.exports = {
  apps: [
    {
      ...common,
      name: 'park2all-api',
      cwd: path.join(CURRENT, 'api'),
      script: 'dist/main.js',
      env: { ...api, NODE_ENV: api.NODE_ENV || 'production', HOST: '127.0.0.1', PORT: api.PORT || '4100', RELEASE_SHA },
    },
    {
      ...common,
      name: 'park2all-operator-web',
      cwd: path.join(CURRENT, 'operator-web', 'apps', 'operator-web'),
      script: 'server.js',
      env: { NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: '3101', RELEASE_SHA },
    },
    {
      ...common,
      name: 'park2all-booking-web',
      cwd: path.join(CURRENT, 'booking-web', 'apps', 'booking-web'),
      script: 'server.js',
      // Server components call the API over loopback; browsers use the public URL baked in at build time.
      env: { NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: '3104', API_URL: `http://127.0.0.1:${api.PORT || '4100'}`, PUBLIC_URL, RELEASE_SHA },
    },
  ],
};
