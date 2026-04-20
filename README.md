# FullyHacks 2026 — Tide Together (Expo + Express.js)

## Purpose

**Tide Together** is a **FullyHacks 2026** project built to explore how software can support day-to-day **glucose self-management** in a practical, demo-friendly way. The goal is to help someone who may be heading toward a **post-meal spike** make a **better nearby food choice** with clear, grounded explanations—and to **loop in a trusted contact** when the person wants to share how they are doing (including optional symptoms) via **SMS**.

Many diabetes and CGM companion apps are built around **logging, thresholds, and hindsight**: they excel at showing what already happened, but usually **do not surface credible near-term risk**—so there is **little room for predictive intervention** (timely nudges *before* a spike or bad choice fully materializes). They are also often **not context-aware in the moment**: **symptoms**, how the person feels, **activity**, and **where they are** rarely feed one combined decision. This prototype is a small experiment in **risk-forward, context-rich** support—spike estimation, **place-aware** meal options, retrieval-backed rationale, and optional outreach.

The app keeps **prediction, safety rules, ranking, and escalation** on our side. **Human Delta** acts as a **retrieval layer** (menus, nutrition snippets, indexed education pages) so suggestions and narratives can reference real content instead of generic guesses. **Gemini** helps turn that material into readable meal guidance and check-in messages. Nothing here replaces a care team or professional advice; it is a **hackathon prototype**, not a medical product.

Deeper product and integration notes: `hackathon_diabetes_app_human_delta_brief.txt`.

## Layout

| Directory | Purpose |
|-----------|---------|
| `mobile/` | Expo app — UI, SMS preset, calls backend |
| `backend/` | Express.js API — Places, Human Delta, Gemini, rules |

## Tech stack

| Area | What we use |
|------|----------------|
| **Mobile** | [Expo](https://expo.dev/) (React Native), **TypeScript**, React Navigation, AsyncStorage; Expo modules (e.g. Location, SMS, Notifications) |
| **Backend** | **Node.js**, **Express.js**, **TypeScript** (dev: `tsx`); orchestrates risk rules, Places, Human Delta, Gemini |
| **Maps** | **Google Places API (New)** — nearby search from the server |
| **Retrieval** | **Human Delta** — `POST /v1/search` for indexed menus / web / docs (optional) |
| **LLM** | **Google Gemini** — Vertex AI (default in `.env.example`) or Google AI Studio (`GEMINI_USE_VERTEX=false`) for meal synthesis and SMS check-in copy |
| **ML (optional)** | **Python** + `ml_model/` — spike regression when env points at the infer script (see `backend/.env.example`) |
| **Dev / network** | **npm**; optional **[Cloudflare](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/) quick tunnels** (`cloudflared` via `npx`) so phones reach Metro and the API on restrictive Wi‑Fi |

## Requirements

- Node **18+** (tested on **24**), **npm**
- **Expo Go** on a phone (SDK matches `mobile/package.json`, e.g. Expo 54)
- Google Cloud: **Places API (New)** + **billing**, key usable **server-side** (see env notes below)
- Optional: [Human Delta](https://dev.humandelta.ai/docs/intro) `POST /v1/search` for retrieval
- Optional: **cloudflared** (via `npx`) for tunnels when the phone cannot reach your Mac on LAN

## Run locally

**1. Backend**

```bash
cd backend && cp .env.example .env
# Set at least GOOGLE_MAPS_API_KEY; add Vertex/Gemini + Human Delta per .env.example
npm install && npm run dev
```

**2. Mobile**

```bash
cd mobile && cp .env.example .env
# Set EXPO_PUBLIC_API_BASE_URL (see Networking)
npm install && npm run start:cloudflare
```

Use **`npm run start:lan`** only if the phone can open your Mac’s LAN IP (typical home Wi‑Fi). On **eduroam / guest / AP isolation**, prefer **`start:cloudflare`** for Metro and a **backend** tunnel for the API (below).

Open **Expo Go** and scan the QR code.

**Simulator on the same machine:** `npx expo start` from `mobile/`, then `i` / `a`; set **`EXPO_PUBLIC_API_BASE_URL`** to `http://localhost:3000` (Android emulator: `http://10.0.2.2:3000`).

After changing **`mobile/.env`**, restart Expo (`--clear` if the bundle still shows old values).

## Networking

The app calls **`{EXPO_PUBLIC_API_BASE_URL}/api/...`** (no trailing slash). The UI shows the resolved base URL.

| Scenario | `EXPO_PUBLIC_API_BASE_URL` |
|----------|----------------------------|
| iOS Simulator on Mac | `http://localhost:3000` |
| Android emulator | `http://10.0.2.2:3000` |
| Physical device, same open Wi‑Fi | `http://<Mac-LAN-IP>:3000` — backend logs print `/health` URLs on start (`ipconfig getifaddr en0` on Mac) |
| Phone cannot reach Mac (isolation, cellular-only dev, etc.) | Run **`npm run tunnel`** in **`backend/`** (Cloudflare quick tunnel to API) and paste the printed **`https://….trycloudflare.com`** here |

**Do not** use `localhost` / `127.0.0.1` on a **physical phone** — that is the phone itself.

**`npm run start:cloudflare`** (mobile): tunnels Metro so the bundle loads over HTTPS; it sets **`EXPO_PACKAGER_PROXY_URL`** for the dev client. That is separate from the **API** URL above.

## Backend

- Listens on **`0.0.0.0`**, **`PORT`** (default **3000**).
- Env: **`backend/.env.example`** (Google key, optional Human Delta, **Vertex Gemini** or AI Studio, optional ML spike script paths, dev flags).

**Google key:** unrestricted or **IP** restriction for this Node host — not iOS/Android/referrer-only keys (those cause `PERMISSION_DENIED`).

**Human Delta:** Official URL is `https://api.humandelta.ai/v1/search`. Unset URL → placeholder menu guidance; SMS narrative skips retrieval. **`HUMAN_DELTA_INDEX_ID`** scopes **website crawl** search when configured (see `.env.example` and `Human_delta_rest_api.txt`).

**Scripts:** `npm run dev` (watch), `npm run start` (once), `npm run tunnel` (expose API for the phone).

**Smoke:**

```bash
curl -s http://localhost:3000/health
curl -sS -X POST http://localhost:3000/api/nearby-restaurants \
  -H 'content-type: application/json' \
  -d '{"latitude":37.7937,"longitude":-122.3965}'
```

## Mobile scripts

| Script | Use |
|--------|-----|
| `npm run start:cloudflare` | Restrictive Wi‑Fi / HTTPS bundle path (default for campus-style setups) |
| `npm run start:lan` | Phone reaches Mac on LAN |
| `npm run start` | Plain `expo start` |
| `npm run start:tunnel` | Expo’s ngrok tunnel — often flaky; if it fails, use **`start:cloudflare`** + backend tunnel |

## API (`/api`)

| Method | Path | Role |
|--------|------|------|
| `POST` | `/risk-assessment` | Rules-based risk |
| `POST` | `/spike-risk` | ML regression spike path (when configured) |
| `POST` | `/nearby-restaurants` | Places (New) nearby |
| `POST` | `/menu-guidance` | Human Delta or placeholder |
| `POST` | `/recommendations` | Full pipeline → ranked suggestions |
| `POST` | `/sms-check-in-message` | Symptoms + template facts + optional HD retrieval → Gemini SMS body |

## Troubleshooting (short)

- **`EADDRINUSE:3000`** — Free the port or set **`PORT`** in `backend/.env` and match **`EXPO_PUBLIC_API_BASE_URL`**.
- **Google 403 / API not enabled** — Enable **Places API (New)** + billing; fix key restrictions.
- **Phone: request timed out** — Open `{base}/health` in Safari on the phone; use **backend `npm run tunnel`** if LAN fails.
- **Metro / QR on eduroam** — **`npm run start:cloudflare`**; **`EDUROAM_EXPO_VERBOSE=1`** for tunnel logs.
- **`expo start --tunnel` / remote gone away** — `rm -rf node_modules && npm install` in **`mobile/`**; prefer **`start:cloudflare`**; see [expo#43335](https://github.com/expo/expo/issues/43335).
- **Fast Refresh broken through trycloudflare** — Reload (`r`) in the Expo terminal after saves.
- **Env ignored** — Restart Expo (`--clear` if needed) and backend after `.env` edits.

## Secrets

`backend/.env` and `mobile/.env` are gitignored. Do not commit keys or long-lived tunnel URLs you treat as sensitive.
