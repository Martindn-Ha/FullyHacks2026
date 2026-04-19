'use strict';
/**
 * Eduroam / client isolation: Cloudflare quick tunnel → Metro :8081, then Expo with EXPO_PACKAGER_PROXY_URL.
 *
 * **Hot reload / Fast Refresh** often does **not** work reliably through trycloudflare (WebSocket path).
 * Expect to press **`r`** in the Expo terminal for a full reload after edits, or restart this script if reload hangs.
 *
 * Uses **--protocol http2** (TCP) by default — many campus networks block QUIC (UDP), which makes
 * cloudflared exit with code 1 before any trycloudflare URL appears.
 *
 * Override: `EDUROAM_EXPO_CF_PROTOCOL=auto` to let cloudflared pick (often QUIC first).
 *
 * @see https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/
 * @see https://github.com/expo/expo/issues/43335
 */
const { spawn } = require('child_process');
const path = require('path');

const mobileRoot = path.join(__dirname, '..');
const tunnelUrlRe = /https:\/\/[a-z0-9-]+\.trycloudflare\.com\/?/i;

function cloudflaredArgs() {
  const p = (process.env.EDUROAM_EXPO_CF_PROTOCOL || 'http2').trim();
  const base = ['--yes', 'cloudflared', 'tunnel', '--url', 'http://127.0.0.1:8081'];
  if (p && p !== 'auto') base.splice(3, 0, '--protocol', p);
  return base;
}

function main() {
  const proto = process.env.EDUROAM_EXPO_CF_PROTOCOL || 'http2';
  console.log('[eduroam-expo] Starting Cloudflare quick tunnel to http://127.0.0.1:8081 …');
  console.log(`[eduroam-expo] cloudflared protocol: ${proto === 'auto' ? 'auto (cloudflared default)' : proto} (set EDUROAM_EXPO_CF_PROTOCOL=auto to use default)\n`);

  const cf = spawn('npx', cloudflaredArgs(), {
    cwd: mobileRoot,
    stdio: ['inherit', 'pipe', 'pipe'],
  });

  let buf = '';
  let proxyUrl = '';
  let expo = null;
  const deadline = Date.now() + 90_000;

  const tryStartExpo = () => {
    if (expo || !proxyUrl) return;
    const u = proxyUrl.replace(/\/$/, '');
    console.log('\n[eduroam-expo] Tunnel:', u);
    console.log('[eduroam-expo] Starting Expo with EXPO_PACKAGER_PROXY_URL (QR / URL in terminal).\n');

    expo = spawn('npx', ['expo', 'start', '--lan'], {
      cwd: mobileRoot,
      stdio: 'inherit',
      env: { ...process.env, EXPO_PACKAGER_PROXY_URL: u },
    });

    expo.on('exit', (code) => {
      if (!cf.killed) cf.kill('SIGINT');
      process.exit(code == null ? 0 : code);
    });
  };

  const onChunk = (chunk) => {
    const s = chunk.toString();
    buf += s;
    if (process.env.EDUROAM_EXPO_VERBOSE) process.stderr.write(s);
    const m = buf.match(tunnelUrlRe);
    if (m) {
      proxyUrl = m[0];
      tryStartExpo();
    }
  };

  cf.stdout.on('data', onChunk);
  cf.stderr.on('data', onChunk);

  cf.on('error', (err) => {
    console.error('[eduroam-expo] Could not run cloudflared:', err.message);
    console.error('[eduroam-expo] Install: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/');
    process.exit(1);
  });

  cf.on('exit', (code, signal) => {
    if (expo) return;
    const tail = buf.trim().slice(-6000);
    console.error(
      '[eduroam-expo] cloudflared exited before a trycloudflare.com URL appeared.',
      signal || `code ${code}`,
    );
    if (tail) {
      console.error('\n[eduroam-expo] Last cloudflared output:\n---\n' + tail + '\n---\n');
    }
    if (proto !== 'http2' && code !== 0) {
      console.error('[eduroam-expo] Tip: many school networks block QUIC. Retry with default (omit EDUROAM_EXPO_CF_PROTOCOL) for --protocol http2.');
    } else if (proto === 'http2' && code !== 0) {
      console.error('[eduroam-expo] Tip: this network may block outbound tunnels; try GlobalProtect / another network, or use the iOS Simulator on the Mac.');
    }
    process.exit(code || 1);
  });

  const shutdown = () => {
    if (expo && !expo.killed) expo.kill('SIGINT');
    if (!cf.killed) cf.kill('SIGINT');
  };
  process.on('SIGINT', () => {
    shutdown();
    process.exit(0);
  });
  process.on('SIGTERM', shutdown);

  const poller = setInterval(() => {
    if (expo) {
      clearInterval(poller);
      return;
    }
    if (Date.now() > deadline) {
      clearInterval(poller);
      console.error('[eduroam-expo] Timed out waiting for tunnel URL.');
      const tail = buf.trim().slice(-6000);
      if (tail) console.error('\n---\n' + tail + '\n---\n');
      cf.kill('SIGINT');
      process.exit(1);
    }
  }, 400);
}

main();
