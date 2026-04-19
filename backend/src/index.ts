import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { createServer } from 'node:http';
import os from 'node:os';
import { apiRouter } from './routes/api.js';

function logLanHealthUrls(port: number) {
  const nets = os.networkInterfaces();
  const ips: string[] = [];
  for (const addrs of Object.values(nets)) {
    for (const a of addrs ?? []) {
      const fam = a.family as string | number;
      const v4 = fam === 'IPv4' || fam === 4;
      if (v4 && !a.internal) ips.push(a.address);
    }
  }
  const uniq = [...new Set(ips)];
  if (uniq.length) {
    console.log('Reachable on your LAN (same Wi‑Fi as the phone):');
    for (const ip of uniq) {
      console.log(`  http://${ip}:${port}/health`);
    }
  }
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
  const started = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - started;
    console.log(`[http] ${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms`);
  });
  next();
});

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.use('/api', apiRouter);

const port = Number(process.env.PORT || 3000);
/** Bind IPv4 on all interfaces so a physical phone on the same LAN can connect (not only loopback). */
const host = process.env.HOST || '0.0.0.0';
const server = createServer(app);
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `Port ${port} is already in use. Stop the other server (e.g. run: kill $(lsof -tiTCP:${port})) or set PORT=3001 in backend/.env and update the mobile app URL.`,
    );
    process.exit(1);
  }
  throw err;
});
server.listen(port, host, () => {
  console.log(`Diabetes support API listening on http://localhost:${port} (bound to ${host}:${port})`);
  logLanHealthUrls(port);
  console.log(
    'If your phone still cannot open /health: try another Wi‑Fi (not guest), disable VPN on the phone, allow Node in macOS Firewall, or run a tunnel: npx cloudflared tunnel --url http://127.0.0.1:' +
      port,
  );
});
