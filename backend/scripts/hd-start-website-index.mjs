#!/usr/bin/env node
/**
 * Start a Human Delta website crawl (POST /v1/indexes).
 * Docs in repo: ../Human_delta_rest_api.txt — Base https://api.humandelta.ai
 *
 * Usage:
 *   cd backend && HUMAN_DELTA_API_KEY=hd_live_… node scripts/hd-start-website-index.mjs
 *   # or from repo root: HUMAN_DELTA_API_KEY=… node scripts/hd-start-website-index.mjs
 *   #   (repo `scripts/hd-start-website-index.mjs` forwards to this file)
 *   HUMAN_DELTA_API_KEY=… node scripts/hd-start-website-index.mjs --url "https://diabetes.org/…" --max-pages 150 --name "ADA hub"
 *   … --poll   # poll GET /v1/indexes/{id} until completed or failed
 *
 * Default seed is the ADA hypoglycemia symptoms page (strong internal links to other ADA guides).
 * Crawling third-party sites may be restricted by their terms / robots.txt — check https://diabetes.org/ before bulk crawls.
 *
 * After status is `completed`, set in backend `.env`:
 *   HUMAN_DELTA_INDEX_ID=<id printed here>
 *   HUMAN_DELTA_SOURCES=web
 * (Your `humanDeltaClient` only sends `index_id` when sources are web-only; see humanDeltaClient.ts.)
 */

const HD_BASE = 'https://api.humandelta.ai';

/** ADA URLs previously cited for education (pick one as --url seed; crawl follows same-site links up to max_pages). */
const ADA_SEED_DEFAULT =
  'https://diabetes.org/living-with-diabetes/hypoglycemia-low-blood-glucose/symptoms-treatment';

function parseArgs(argv) {
  const out = { url: ADA_SEED_DEFAULT, name: 'ADA diabetes.org (seed crawl)', maxPages: 100, poll: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--poll') out.poll = true;
    else if (a === '--url' && argv[i + 1]) {
      out.url = argv[++i];
    } else if (a === '--name' && argv[i + 1]) {
      out.name = argv[++i];
    } else if (a === '--max-pages' && argv[i + 1]) {
      const n = Number(argv[++i]);
      if (Number.isFinite(n)) out.maxPages = Math.min(500, Math.max(1, Math.round(n)));
    } else if (a === '--help' || a === '-h') {
      out.help = true;
    }
  }
  return out;
}

async function hdFetch(path, { method = 'GET', body } = {}) {
  const key = process.env.HUMAN_DELTA_API_KEY?.trim();
  if (!key) {
    console.error('Missing HUMAN_DELTA_API_KEY in environment.');
    process.exit(1);
  }
  const res = await fetch(`${HD_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* leave json null */
  }
  return { res, text, json };
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(`Usage: HUMAN_DELTA_API_KEY=… node scripts/hd-start-website-index.mjs [options]

Options:
  --url <url>         Seed URL (default: ADA hypoglycemia symptoms page)
  --name <string>     Label for this index job
  --max-pages <n>     1–500 (default 100)
  --poll              Poll until completed / failed / timeout (5s interval, 30 min max)

Other useful ADA seeds (run separately if you want separate indexes):
  https://diabetes.org/living-with-diabetes/hypoglycemia-low-blood-glucose
  https://diabetes.org/health-wellness
`);
    process.exit(0);
  }

  const payload = {
    source_type: 'website',
    name: args.name,
    website: {
      url: args.url,
      max_pages: args.maxPages,
    },
  };

  console.error('POST /v1/indexes', JSON.stringify({ ...payload, website: payload.website }, null, 2));
  const { res, text, json } = await hdFetch('/v1/indexes', { method: 'POST', body: payload });

  if (!res.ok) {
    console.error(`HTTP ${res.status}:`, text.slice(0, 2000));
    process.exit(1);
  }

  const id =
    json?.id ??
    json?.index_id ??
    json?.data?.id ??
    json?.job?.id ??
    null;
  console.log(JSON.stringify(json, null, 2));
  if (id) {
    console.error(`\nSet in backend/.env after job completes:\n  HUMAN_DELTA_INDEX_ID=${id}\n  HUMAN_DELTA_SOURCES=web\n`);
  } else {
    console.error(
      '\nCould not find index id in JSON (field names may differ). Copy id from the JSON above into HUMAN_DELTA_INDEX_ID.\n',
    );
  }

  if (!args.poll || !id) return;

  const deadline = Date.now() + 30 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000));
    const st = await hdFetch(`/v1/indexes/${encodeURIComponent(id)}`);
    console.error(`poll GET /v1/indexes/${id} → HTTP ${st.res.status}`);
    if (!st.res.ok) {
      console.error(st.text.slice(0, 1500));
      process.exit(1);
    }
    console.log(JSON.stringify(st.json, null, 2));
    const status = st.json?.status ?? st.json?.state ?? st.json?.job?.status;
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      console.error(`\nFinal status: ${status}`);
      process.exit(status === 'completed' ? 0 : 1);
    }
  }
  console.error('Poll timed out after 30 minutes; check dashboard or GET /v1/indexes/{id} manually.');
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
