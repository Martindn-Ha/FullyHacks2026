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
- Optional: **cloudflared** (via `npx`) for a public HTTPS URL to your laptop API when LAN access from the phone fails

## Backend

```bash
cd backend
cp .env.example .env
# Edit .env: GOOGLE_MAPS_API_KEY required; HUMAN_DELTA_* optional for local Google-only testing
npm install
npm run dev
```

Server listens on **`0.0.0.0`** and **`PORT`** (default **3000**) so other devices on the LAN can connect. On startup it logs **LAN** URLs like `http://<your-en0-ip>:3000/health`.

### `backend/.env` (see `.env.example`)

- **`PORT`** — API port (default `3000`).
- **`GOOGLE_MAPS_API_KEY`** — Required. Used with **Places API (New)** (`POST https://places.googleapis.com/v1/places:searchNearby`, headers `X-Goog-Api-Key` and `X-Goog-FieldMask`). Enable **Places API (New)** in the same Google Cloud project as the key, with **billing** enabled.
- **API key restrictions** — For this **Node** server, do **not** use a key restricted only to **iOS apps**, **Android apps**, or **HTTP referrers**. Use **None** while developing, or **IP addresses** for a fixed server. Wrong restrictions cause `PERMISSION_DENIED` / `API_KEY_INVALID`.
- **`HUMAN_DELTA_API_URL`** — Optional. If unset, recommendations still run using **generic placeholder** text per place (`sources.guidance`: `"placeholder"`). If set, the backend POSTs JSON and expects structured passages for **every** returned Google `place_id` (see `.env.example`).
- **`HUMAN_DELTA_API_KEY`** — Optional; sent as `Authorization: Bearer <key>` when set.

### Scripts

- **`npm run dev`** — `tsx watch` for local development.
- **`npm run start`** — Run once without watch.
- **`npm run tunnel`** — `npx cloudflared tunnel --url http://127.0.0.1:3000` — exposes the API on a **`https://….trycloudflare.com`** URL so a **phone on cellular or blocked LAN** can reach your Mac. Keep this running alongside `npm run dev` when using that URL. Each new tunnel run prints a **new** URL.

### Smoke tests (Mac)

```bash
curl -s http://localhost:3000/health
curl -sS -X POST http://localhost:3000/api/nearby-restaurants \
  -H 'content-type: application/json' \
  -d '{"latitude":37.7937,"longitude":-122.3965}'
```

Errors and requests are logged to the terminal (`[http]`, `[api …]`).

## Mobile app

```bash
cd mobile
cp .env.example .env
# Set EXPO_PUBLIC_API_BASE_URL (see below)
npm install
npx expo start --tunnel
# After changing .env, use: npx expo start --tunnel --clear
```

### `mobile/.env` — `EXPO_PUBLIC_API_BASE_URL`

This is the **base URL of the Express API** (no trailing slash). The app calls `{base}/api/recommendations`.

| Where you run the app | Typical base URL |
|------------------------|------------------|
| iOS **Simulator** on the same Mac | `http://localhost:3000` |
| **Android emulator** | `http://10.0.2.2:3000` |
| **Physical device**, same Wi‑Fi as Mac | `http://<Mac-LAN-IP>:3000` — run `ipconfig getifaddr en0` on the Mac; backend logs also print LAN `/health` URLs on startup |
| **Physical device**, LAN blocked (guest Wi‑Fi, AP isolation, etc.) | Use **`npm run tunnel`** in `backend/` and set the printed **`https://….trycloudflare.com`** value here |

Important:

- **`127.0.0.1` / `localhost` on a physical iPhone** refers to the **phone**, not your Mac. Use the Mac’s LAN IP or a tunnel HTTPS URL.
- **`expo start --tunnel`** tunnels the **Metro / JS bundle**, not your custom API. The API URL is controlled only by **`EXPO_PUBLIC_API_BASE_URL`**.
- After changing **`mobile/.env`**, restart Expo with **`--clear`** so the bundle picks up env vars.

The app shows **API: &lt;base&gt;** at the top so you can confirm what URL is baked in.

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
- **Phone “network request timed out”** — Phone cannot reach the API host. Confirm Safari can open **`{base}/health`**. If LAN IP never loads, use **`npm run tunnel`** and the **trycloudflare** HTTPS base URL in **`mobile/.env`**.
- **`.env` not picked up** — Restart Expo with **`--clear`**. Restart **`npm run dev`** after editing **`backend/.env`**.

## Git / secrets

`backend/.env` and `mobile/.env` are listed in `.gitignore`. Do not commit API keys or tunnel URLs you treat as sensitive.
