# FullyHacks 2026 — Diabetes support (Expo + Express)

Hackathon app: **rules-based spike-risk estimate**, **Google Places (New)** for nearby restaurants, optional **Human Delta**–style menu retrieval (or **placeholder** mode when the URL is unset), then ranked **top 3** meal suggestions. Not medical advice.

Product spec notes: `hackathon_diabetes_app_human_delta_brief.txt`.

## Repo layout

| Path | Role |
|------|------|
| `mobile/` | Expo (React Native) app — collects context, calls the API, shows results |
| `backend/` | Express API — Google Places, optional Human Delta client, ranking, safety rules |

## Prerequisites

- **Node.js** (v18+ recommended; project tested on v24)
- **npm**
- **Expo Go** on a physical phone (SDK matches `mobile/package.json`, e.g. Expo 54)
- **Google Cloud** project with **Places API (New)** enabled, **billing** on, and an API key suitable for **server-side** use (see below)
- Optional: **Human Delta** HTTP endpoint for real menu passages
- Optional: **cloudflared** (pulled via `npx` when you run the scripts below) for public HTTPS URLs when **client isolation** (e.g. **eduroam**) prevents the phone from reaching your Mac on the local network, or when `expo start --tunnel` is unreliable

## Quick start (two terminals)

**Terminal 1 — API**

```bash
cd backend
cp .env.example .env
# Edit .env: GOOGLE_MAPS_API_KEY required; HUMAN_DELTA_* optional
npm install
npm run dev
```

For a **physical phone** on **eduroam / guest / isolated Wi‑Fi**, also run **`npm run tunnel`** in **`backend/`** and put the printed **`https://….trycloudflare.com`** into **`mobile/.env`** as **`EXPO_PUBLIC_API_BASE_URL`** (no trailing slash).

**Terminal 2 — Expo**

```bash
cd mobile
cp .env.example .env
# Set EXPO_PUBLIC_API_BASE_URL (tunnel URL from backend if the phone cannot use your LAN IP)
npm install
npm run start:cloudflare
```

Open **Expo Go** and scan the QR code from the Expo terminal.

**Simulator on the same Mac** (no tunnels): from **`mobile/`**, use **`npx expo start`** and press **`i`** / **`a`** — use **`http://localhost:3000`** in **`EXPO_PUBLIC_API_BASE_URL`**.

After changing **`mobile/.env`**, restart Expo ( **`--clear`** if the bundle still shows old env, e.g. `npx expo start --lan --clear` when not using **`start:cloudflare`**).

## Backend

Server listens on **`0.0.0.0`** and **`PORT`** (default **3000**) so other devices on the LAN can connect. On startup it logs **LAN** URLs like `http://<your-en0-ip>:3000/health`.

### `backend/.env` (see `backend/.env.example`)

- **`PORT`** — API port (default `3000`).
- **`GOOGLE_MAPS_API_KEY`** — Required. Used with **Places API (New)** (`POST https://places.googleapis.com/v1/places:searchNearby`, headers `X-Goog-Api-Key` and `X-Goog-FieldMask`). Enable **Places API (New)** in the same Google Cloud project as the key, with **billing** enabled.
- **API key restrictions** — For this **Node** server, do **not** use a key restricted only to **iOS apps**, **Android apps**, or **HTTP referrers**. Use **None** while developing, or **IP addresses** for a fixed server. Wrong restrictions cause `PERMISSION_DENIED` / `API_KEY_INVALID`.
- **`HUMAN_DELTA_API_URL`** — Optional. If unset, recommendations still run using **generic placeholder** text per place (`sources.guidance`: `"placeholder"`). If set to Human Delta’s **`POST /v1/search`** URL (**`https://api.humandelta.ai/v1/search`**, per [Human Delta Developer Platform](https://dev.humandelta.ai/docs/intro)), the backend sends a **search-shaped** `query` and maps common search JSON into guidance. Other URLs can still use the custom `{ query, places }` → `{ items|results: [{ placeId, passages }] }` contract (see `.env.example`).
- **`HUMAN_DELTA_API_KEY`** — Optional; sent as **`Authorization: Bearer <key>`** when set (docs show keys like `hd_live_…`).

### Scripts

- **`npm run dev`** — `tsx watch` for local development.
- **`npm run start`** — Run once without watch.
- **`npm run tunnel`** — `npx cloudflared tunnel --url http://127.0.0.1:3000` — exposes the API on a **`https://….trycloudflare.com`** URL so a **phone on cellular or blocked LAN** can reach your Mac. Keep this running alongside `npm run dev` when using that URL. Each new tunnel run prints a **new** URL; paste it into **`mobile/.env`** as **`EXPO_PUBLIC_API_BASE_URL`** (no trailing slash).

### Smoke tests (Mac)

```bash
curl -s http://localhost:3000/health
curl -sS -X POST http://localhost:3000/api/nearby-restaurants \
  -H 'content-type: application/json' \
  -d '{"latitude":37.7937,"longitude":-122.3965}'
```

Errors and requests are logged to the terminal (`[http]`, `[api …]`).

## Mobile app

### `mobile/.env` — `EXPO_PUBLIC_API_BASE_URL`

This is the **base URL of the Express API** (no trailing slash). The app calls `{base}/api/recommendations`.

| Where you run the app | Typical base URL |
|------------------------|------------------|
| iOS **Simulator** on the same Mac | `http://localhost:3000` |
| **Android emulator** | `http://10.0.2.2:3000` |
| **Physical device**, same Wi‑Fi as Mac (no AP isolation) | `http://<Mac-LAN-IP>:3000` — run `ipconfig getifaddr en0` on the Mac; backend logs also print LAN `/health` URLs on startup |
| **Physical device**, LAN blocked (guest Wi‑Fi, **eduroam** client isolation, etc.) | Run **`npm run tunnel`** in `backend/` and set the printed **`https://….trycloudflare.com`** value here |

Important:

- **`127.0.0.1` / `localhost` on a physical iPhone** refers to the **phone**, not your Mac. Use the Mac’s LAN IP or a tunnel HTTPS URL.
- **`expo start --tunnel`** ( **`npm run start:tunnel`** ) tunnels Metro via Expo’s **bundled ngrok 2.x** path. It is **often flaky or blocked** on modern networks and accounts; Expo recommends **your own** tunnel (e.g. Cloudflare) instead — see [expo/expo#43335](https://github.com/expo/expo/issues/43335). On **campus / isolated Wi‑Fi**, use **`npm run start:cloudflare`** (not **`start:lan`**, which needs the phone to reach your Mac on the LAN).
- The **API** URL is only **`EXPO_PUBLIC_API_BASE_URL`**. A separate tunnel + **`EXPO_PACKAGER_PROXY_URL`** is only for the **Metro bundler** when you use **`start:cloudflare`**.

The app shows **API: &lt;base&gt;** at the top so you can confirm what URL is baked in.

### Scripts

- **`npm run start:cloudflare`** — **Default for Expo Go on restrictive Wi‑Fi** (eduroam, AP isolation): **Cloudflare quick tunnel** → **Metro :8081** with **`--protocol http2`**, then **`expo start --lan`** plus **`EXPO_PACKAGER_PROXY_URL`** so the phone loads the bundle over **HTTPS**. Keep **`backend`** **`npm run dev`** and, for the API, **`npm run tunnel`** with **`EXPO_PUBLIC_API_BASE_URL`** set to that tunnel URL.
- **`npm run start:lan`** — Only useful when the **phone can open your Mac’s LAN IP** (unrestricted home/office Wi‑Fi). **Not viable on typical eduroam** (client isolation).
- **`npm run start`** / **`npm run start:tunnel`** — Standard Expo; **`start:tunnel`** is optional and may fail with `remote gone away`.

Optional environment (shell only, not required in `.env` unless you want them permanent):

- **`EDUROAM_EXPO_VERBOSE=1`** — Stream full **cloudflared** logs while **`start:cloudflare`** starts.
- **`EDUROAM_EXPO_CF_PROTOCOL=auto`** — Let **cloudflared** pick the protocol (defaults to **`http2`** in the script).

## API overview (`/api` on the backend)

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/risk-assessment` | Rules-based risk from context (respects urgent symptom escalation) |
| `POST` | `/api/nearby-restaurants` | Google Places (New) nearby restaurants |
| `POST` | `/api/menu-guidance` | Human Delta retrieval, or placeholder rows if URL unset |
| `POST` | `/api/recommendations` | Full flow: safety → risk → Google → Human Delta or placeholder → top 3 |

## Troubleshooting

- **`EADDRINUSE` on port 3000** — Another Node process is using the port. Stop it, e.g. `kill $(lsof -tiTCP:3000)`, or set **`PORT=3001`** in `backend/.env` and point **`EXPO_PUBLIC_API_BASE_URL`** at the new port.
- **Google `403` / “Places API (New) has not been used…”** — Enable **Places API (New)** for the key’s project, enable **billing**, fix **key restrictions** as above.
- **Phone “network request timed out”** — Phone cannot reach the API host. Confirm Safari can open **`{base}/health`**. If LAN IP never loads, use **`npm run tunnel`** in **`backend/`** and the **trycloudflare** HTTPS base URL in **`mobile/.env`**.
- **Eduroam: phone cannot open Metro / QR never loads** — Use **`npm run start:cloudflare`** in **`mobile/`**. If **cloudflared** exits immediately, read the script’s dumped logs; try **`EDUROAM_EXPO_VERBOSE=1`**. If tunnels never come up, the network may block **outbound** tunnel traffic — try **GlobalProtect / another campus network**, or develop against the **iOS Simulator** on the Mac (`npx expo start`).
- **Edits don’t show up live while using `start:cloudflare`** — **Fast Refresh** depends on a **WebSocket** to Metro; **trycloudflare** often breaks or delays that. Press **`r`** in the Expo terminal to **reload** after saves, or **restart** `start:cloudflare` if reload hangs.
- **`expo start --tunnel` / `remote gone away`** — Not your app bug; use **`start:cloudflare`** (or the **simulator**), or see [expo#43335](https://github.com/expo/expo/issues/43335).
- **Stale tools after many experiments** — If Metro, **cloudflared**, or tunnels behave inconsistently, do a **clean reinstall**: from **`mobile/`**, `rm -rf node_modules && npm install`. If you use **Homebrew ngrok** for your own CLI tunnels, `brew uninstall ngrok && brew install ngrok` (or `brew reinstall ngrok`), then `ngrok config add-authtoken <token>` again. That resets local binaries and caches; it does **not** swap Expo’s **bundled** ngrok used by **`start:tunnel`**, but it has fixed “nothing works / then it works” situations in practice.
- **`.env` not picked up** — Restart Expo ( **`--clear`** if needed). Restart **`npm run dev`** after editing **`backend/.env`**.

## Git / secrets

`backend/.env` and `mobile/.env` are listed in `.gitignore`. Do not commit API keys or tunnel URLs you treat as sensitive.
