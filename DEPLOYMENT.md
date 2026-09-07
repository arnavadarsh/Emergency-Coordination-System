# Deploying the Emergency Coordination System

Two containers, one Supabase project.

```
  web (nginx)                          backend (NestJS)
    /           user dashboard           /api        REST
    /admin/     admin dashboard          /socket.io  live updates
    /driver/    driver dashboard
    /hospital/  hospital dashboard              │
                                                ▼
                                        Supabase project
                                          • Postgres  — every row
                                          • Storage   — chat images
```

The browser reaches the backend one of two ways:

- **Same origin** — nginx proxies `/api` and `/socket.io` to it (Compose, a VPS).
  Set `BACKEND_ORIGIN` on the web container.
- **Separate hosts** — the dashboards are built against the backend's own public
  URL, which lists the web origin in `CORS_ORIGINS` (Railway). Leave
  `BACKEND_ORIGIN` unset.

Both are supported by the same image; the nginx config is rendered at startup.

Everything the system saves lives in the Supabase project. Neither container
keeps state, so both can be rebuilt, restarted or replaced at any time without
losing data.

---

## 1. Prepare Supabase

**Database** — Project Settings → Database → Connection string → URI.
Use the **pooler** host (port `6543`), not the direct connection: a restarting
container will otherwise exhaust the project's direct connection limit.

**Storage** — Storage → New bucket → name it `chat-attachments` → **Public**.
Chat attachments are uploaded here. Object names are random UUIDs and the URL is
the capability to view the image — the same model the app used before, now on
storage that survives a restart.

**API keys** — Project Settings → API. You need the **service role** key. It
bypasses row-level security, so it stays on the server: never in a dashboard
build, never in git.

## 2. Migrate the database

The schema is applied by migrations. `DB_RUN_MIGRATIONS=true` (the compose
default) runs pending ones at startup; to do it by hand:

```bash
cd backend && npm ci
npm run migration:show     # what is pending
npm run migration:run      # apply
```

**If the database already has tables but little migration history**, TypeORM
will try to re-create them and fail. Baseline once, then migrate:

```bash
npm run migration:baseline            # dry run: shows what it would record
npm run migration:baseline -- --apply
npm run migration:run
```

Baselining only records migrations **older** than the ones already applied —
anything newer is real pending work and is never skipped.

> **This project's Supabase database is already baselined and migrated**, including
> `emergency_contacts`, `tracking_links` and `tracking_notifications`. The first
> deploy will find nothing pending. The commands above are for a fresh project or
> the next schema change.

---

## Choose a deployment path

- **[Railway](#path-a--railway)** — two services from this repo, no server to run.
- **[Docker Compose](#path-b--docker-compose-on-any-server)** — one host you control.
- **[Render](#path-c--render-blueprint-free-tier)** — one-click from `render.yaml`, free tier available.

## Path A — Railway

Two services from this one repository, plus your Supabase project. Railway
assigns each service a port and a public domain; nothing else is shared.

### Before you start

Push the repo (Railway deploys from GitHub):

```bash
git add -A && git commit -m "Deployment configuration"
git push origin main
```

Complete **step 1 (Prepare Supabase)** above — the connection string, a public
`chat-attachments` bucket, and the service role key.

### Service 1 — backend

**New Project → Deploy from GitHub repo → this repo.** Then in the service:

- **Settings → Root Directory:** `backend`
- **Settings → Networking → Generate Domain** (note the URL, e.g.
  `https://ecs-backend-production.up.railway.app`)

`backend/railway.json` supplies the Dockerfile builder, the start command and
the `/api/health` healthcheck, so there is nothing to configure there.

**Variables** — paste into the Raw Editor, then fill in:

```
NODE_ENV=production
DATABASE_URL=<Supabase pooler URI, port 6543>
DB_RUN_MIGRATIONS=true
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service role key>
SUPABASE_STORAGE_BUCKET=chat-attachments
JWT_SECRET=<openssl rand -base64 48>
CORS_ORIGINS=<the web service URL — fill in after service 2 exists>
PUBLIC_TRACKING_BASE_URL=<web service URL>/track
RATE_LIMIT_TRUST_PROXY=true
SEED_DEMO_DATA=true
SMS_PROVIDER=log
```

Do **not** set `PORT` — Railway sets it, and the app binds to it.

The service will fail its first deploy on purpose if any required variable is
missing; the log names exactly which. `CORS_ORIGINS` and
`PUBLIC_TRACKING_BASE_URL` need the web URL, so put a placeholder in now and
correct them in step 3.

### Service 2 — web

**+ New → GitHub Repo → the same repo.** Then:

- **Settings → Root Directory:** leave as `/` (the repo root — the web
  Dockerfile reads `deploy/` as well as `web/`)
- **Settings → Build → Dockerfile Path:** `web/Dockerfile`
- **Settings → Networking → Generate Domain** (note the URL)

**Variables** — these are *build* arguments. Vite bakes them into the bundle, so
changing one requires a redeploy, not a restart:

```
VITE_API_URL=https://<backend-url>/api
VITE_SOCKET_URL=https://<backend-url>
VITE_LOGIN_URL=https://<web-url>
VITE_HOSPITAL_APP_URL=https://<web-url>/hospital
VITE_DRIVER_APP_URL=https://<web-url>/driver
VITE_ADMIN_APP_URL=https://<web-url>/admin
```

Leave `BACKEND_ORIGIN` unset. The browser then talks to the backend's own public
URL, which avoids Railway's IPv6-only private networking entirely. (If you do
want same-origin, set `BACKEND_ORIGIN=http://<backend>.railway.internal:8080`
and `HOST=::` on the backend so it listens on IPv6.)

### Step 3 — close the loop

Back on the **backend** service, set the two values that needed the web URL:

```
CORS_ORIGINS=https://<web-url>
PUBLIC_TRACKING_BASE_URL=https://<web-url>/track
```

Redeploy the backend. Then check:

```bash
curl https://<backend-url>/api/health
curl https://<backend-url>/api/health/ready     # database + storage
curl https://<web-url>/healthz
```

Open `https://<web-url>` and register an account. `/admin`, `/driver` and
`/hospital` serve the other dashboards.

### Railway notes

- **Migrations run at boot** with `DB_RUN_MIGRATIONS=true`. This project's
  Supabase database has already been baselined and migrated, so the first deploy
  finds nothing pending.
- **One replica.** Rate-limit counters live in memory, so each replica would
  enforce its own copy of every limit.
- **Redeploy the web service** after changing any `VITE_*` value — they are
  compiled in, not read at runtime.


---

## Path B — Docker Compose (on any server)

### Configure

```bash
cp deploy/.env.example deploy/.env
$EDITOR deploy/.env          # every value is explained inline
openssl rand -base64 48      # → JWT_SECRET
```

The values that must be right before anything works:

| Variable | Why |
|---|---|
| `PUBLIC_BASE_URL` | Public address of the site. The dashboards are **built** against this, and tracking links point at it. |
| `DATABASE_URL` | Supabase pooler connection string. |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Chat attachments → Supabase Storage. |
| `JWT_SECRET` | A long random value. The shipped default is public. |
| `CORS_ORIGINS` | Exact origins allowed to call the API. |
| `PUBLIC_TRACKING_BASE_URL` | `https://your-host/track` — what family members receive by SMS. |

The backend **refuses to start** in production if any of those is missing or
still a placeholder, rather than starting up quietly wrong. Warnings (not
failures) are printed for things that work but behave oddly — an SMS provider
still set to `log`, a tracking URL still on localhost.

### Build and run

```bash
docker compose --env-file deploy/.env up -d --build
docker compose logs -f backend
```

Then check:

```bash
curl https://your-host/api/health         # liveness
curl https://your-host/api/health/ready   # database + storage
```

`ready` reports `status: "ok"` only when Postgres answers and Storage is
configured; it returns `degraded` rather than failing, so a database blip does
not pull every instance out of rotation mid-emergency.

## Path C — Render (blueprint, free tier)

`render.yaml` in the repo root describes both services, so Render can build the
whole system from one screen.

1. **Render → New → Blueprint → select this repository → Apply.**
   It creates `ecs-backend` (Docker) and `ecs-web` (static, all four dashboards).
2. Render prompts for the values marked `sync: false`. The only one needed to
   start is **`DATABASE_URL`** — your Supabase pooler connection string.
   `deploy/.env`, generated locally and gitignored, already contains it along
   with a freshly generated `JWT_SECRET`.
3. When both services have URLs, set the four that reference them and redeploy:

   | Service | Variable | Value |
   |---|---|---|
   | backend | `CORS_ORIGINS` | the web service URL |
   | backend | `PUBLIC_TRACKING_BASE_URL` | `<web URL>/track` |
   | web | `VITE_API_URL` | `<backend URL>/api` |
   | web | `VITE_SOCKET_URL` | the backend URL |
   | web | `VITE_LOGIN_URL` | the web URL |
   | web | `VITE_*_APP_URL` | `<web URL>/hospital`, `/driver`, `/admin` |

   The web service must be **rebuilt**, not restarted: Vite inlines `VITE_*` at
   build time.
4. Check `<backend>/api/health` and `<backend>/api/health/ready`.

Two things specific to Render's free tier: services **sleep after inactivity**,
so the first request after idling takes a few seconds — which matters for an
emergency system and is a reason to move off free before real use. And a free
static site has no server-side proxy, which is why the dashboards are built
against the backend's own URL and `CORS_ORIGINS` has to name the web origin.

---

---

---

## First run (any path)

Set `SEED_DEMO_DATA=true` for a test deployment: it writes sample Delhi
hospitals and an available ambulance, without which nothing can be dispatched.
It is **off by default in production** so a deploy never quietly adds demo rows
to real data. Turn it off before real use.

Register the first accounts at `https://your-host` — the sign-in screen also
registers patients, drivers and hospitals. An admin account needs `role`
`ADMIN`, which is set by an admin or directly in Supabase.

## Notes that matter in production

**The dashboards are built, not configured.** Vite inlines `VITE_*` at build
time, so changing `PUBLIC_BASE_URL` requires `--build`, not a restart. A
production build without `VITE_API_URL` now fails loudly instead of silently
shipping a bundle pointing at localhost.

**Rate limits are per instance.** Counters live in memory. One instance is
correct; behind a load balancer each enforces its own copy, so effective limits
multiply by the instance count. Shared limits would need Redis.

**Set `RATE_LIMIT_TRUST_PROXY=true` only behind a proxy you control.** It makes
the app believe `X-Forwarded-For`; reachable directly, anyone can forge that
header and walk through every per-caller limit. Compose sets it because nginx
sits in front.

**Third-party keys are optional and degrade cleanly.** No `GEMINI_API_KEY` →
triage uses the offline rule-based engine. No `GOOGLE_MAPS_API_KEY` → hospital
travel times are estimated from distance rather than live traffic. No Twilio →
emergency contacts get nothing; tracking links only reach the log.

**Watch the spend.** `GET /api/triage/llm/usage` (admin) reports LLM request and
token counts, the active ceilings, refusals by reason and approximate cost.
Every limit is tunable by environment — see `backend/.env.example`.

**TLS.** Compose serves plain HTTP on `HTTP_PORT`. Put it behind a terminating
proxy (Caddy, Traefik, a cloud load balancer) or add certificates to
`deploy/nginx.conf`. Tracking links are shared by SMS and opened on phones —
serve them over HTTPS.
