# Deployment

Step-by-step runbook for taking Pandemonium to production.

- Frontend: Cloudflare Pages (static, edge).
- Backend: Oracle Cloud (OCI) Always Free, Docker Compose (API + Postgres +
  Caddy for automatic TLS).

This is the practical checklist. The reasoning behind the choices lives in
[BACKEND_ARCHITECTURE.md](BACKEND_ARCHITECTURE.md).

Planned URLs (change to taste):

| Piece | URL |
| --- | --- |
| Frontend | https://pandemonium.commongenius.in (custom domain) or the `*.pages.dev` default |
| Backend API | https://api.pandemonium.commongenius.in/v1 |

Frontend and backend sit under the same registrable domain (`commongenius.in`),
so the auth cookie is same-site. Keep it that way if you can: it makes cookies
and CORS simpler.

Order matters slightly: the frontend bakes the API URL in at build time, and the
backend needs the frontend origin for CORS. Deploy the frontend first (it works
in local mode with no backend), stand up the backend, then confirm the two agree
on URLs and rebuild the frontend if the API URL changed.

---

## Part A: Frontend to Cloudflare Pages

Method: Wrangler direct upload (deploys the exact build verified locally, no
GitHub required). `wrangler` is already a dev dependency.

### A1. Set the API URL the build points at

`.env.production` (committed, public value) holds:

```
VITE_API_BASE=https://api.pandemonium.commongenius.in/v1
```

It must end in `/v1`. If the backend lands elsewhere, change this line and
rebuild.

### A2. Build

From the repo root:

```bash
bun run build
```

This produces `dist/` with the API URL inlined and `dist/_redirects` (SPA
fallback, so a refresh on any path serves the app).

Sanity check the URL made it in:

```bash
grep -ro "https://api.pandemonium.commongenius.in/v1" dist/assets/*.js | head -1
```

### A3. Log in to Cloudflare (opens your browser)

```bash
bunx wrangler login
```

### A4. Create the Pages project (first time only)

```bash
bunx wrangler pages project create pandemonium --production-branch main
```

### A5. Deploy

```bash
bunx wrangler pages deploy dist --project-name pandemonium --branch main --commit-dirty=true
```

Wrangler prints the live URL (e.g. `https://pandemonium.pages.dev`). Redeploys
are just A2 then A5.

### A6. Custom domain (optional, recommended)

Cloudflare dashboard, Pages, your project, Custom domains, add
`pandemonium.commongenius.in`. Because `commongenius.in` is on Cloudflare DNS,
TLS is provisioned automatically. Add the DNS record when prompted.

### A7. Expected behavior before the backend exists

The site is fully usable in local mode (create/edit projects, file save/open,
IndexedDB autosave). Sign-in will error until Part B is done. That is expected,
not a broken deploy.

---

## Part B: Backend to Oracle Cloud (OCI)

Target: one Ampere A1 (ARM) Always Free instance running Docker Compose with the
API, PostgreSQL, and Caddy (automatic Let's Encrypt TLS).

Production uses PostgreSQL (not the dev SQLite file). The same server code runs
on both; only `DATABASE_URL` differs.

### B1. Provision the instance

1. OCI console, create an Ampere A1 (aarch64) compute instance, Ubuntu 22.04 or
   24.04. A sensible free split is 2 OCPU / 12 GB.
2. Assign a reserved public IP.
3. Save the SSH key; log in: `ssh ubuntu@<public-ip>`.

### B2. DNS for the API subdomain

In Cloudflare DNS for `commongenius.in`, add an A record:

```
api.pandemonium   ->  <public-ip>
```

Set it DNS-only (grey cloud) at first so Let's Encrypt can validate directly.
Turn the orange proxy on later if you want Cloudflare in front.

### B3. Open the network (two layers, both required)

OCI blocks ingress in two independent places. Miss either and TLS issuance hangs.

1. OCI Security List (or NSG) on the instance subnet: add stateful ingress rules
   for TCP 80 and TCP 443 from `0.0.0.0/0`.
2. The instance firewall (Oracle Ubuntu images ship restrictive iptables):

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80  -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

Leave 5432 (Postgres) closed to the internet. It is reached only over the Docker
network by the API container.

### B4. Install Docker and fetch the repo

```bash
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-plugin git
sudo usermod -aG docker $USER && newgrp docker
git clone https://github.com/Common-Genius-LLC/pandemonium.git
cd pandemonium/server
```

### B5. Configure the environment

```bash
cp .env.example .env
```

Edit `server/.env`:

```
PORT=8787
JWT_SECRET=<at least 32 random bytes>
CORS_ORIGIN=https://pandemonium.commongenius.in
DATABASE_URL=postgres://pandemonium:<strong-password>@db:5432/pandemonium
COOKIE_SECURE=true
```

Notes:
- `CORS_ORIGIN` must be the exact frontend origin (add the `*.pages.dev` URL too
  if you use it). It cannot be `*` because credentials are sent.
- `COOKIE_SECURE=true` switches the refresh cookie to Secure + SameSite=None,
  required across HTTPS origins.
- `DATABASE_URL` host is `db` (the compose service name), not localhost.

### B6. TLS config (Caddy)

`server/Caddyfile`:

```
api.pandemonium.commongenius.in {
  reverse_proxy api:8787
}
```

`server/compose.prod.yml` (API + Postgres + Caddy). If it is not already in the
repo, create it:

```yaml
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_USER: pandemonium
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: pandemonium
    volumes: ["pgdata:/var/lib/postgresql/data"]
    restart: always
  api:
    build: { context: .., dockerfile: server/Dockerfile }
    env_file: .env
    depends_on: { db: { condition: service_healthy } }
    restart: always
  caddy:
    image: caddy:2
    ports: ["80:80", "443:443"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
    depends_on: [api]
    restart: always
volumes:
  pgdata:
  caddy_data:
```

(`DB_PASSWORD` here must match the password in `DATABASE_URL`.)

### B7. Bring it up

```bash
docker compose -f compose.yml -f compose.prod.yml up -d --build
```

The API migrates the schema on boot (creates `users`, `projects`,
`refresh_tokens`). Caddy fetches the certificate automatically on first request.

Verify:

```bash
curl https://api.pandemonium.commongenius.in/health
```

Expect `{"ok":true,"service":"pandemonium-api"}`.

### B8. Nginx + certbot alternative (if you do not want Caddy)

```bash
sudo apt-get install -y nginx certbot python3-certbot-nginx
# server block: proxy_pass http://127.0.0.1:8787; forward Host and X-Forwarded-For
sudo certbot --nginx -d api.pandemonium.commongenius.in
```

Here the API container publishes `127.0.0.1:8787` on the host and nginx runs on
the host instead of in compose. Caddy is fewer moving parts; nginx is the pick if
the box already runs other host services.

---

## Part C: Connect the two

1. Confirm `VITE_API_BASE` (frontend) and `CORS_ORIGIN` (backend) agree with the
   real deployed hosts. If the API URL differs from what was baked in Part A,
   edit `.env.production`, rebuild (`bun run build`), and redeploy (A5).
2. Open the frontend, register an account, create a project. It should sync.
3. Confirm on the server it landed:

```bash
docker compose exec -T db psql -U pandemonium -d pandemonium -c "SELECT email FROM users;"
```

---

## Operations

- Backups: nightly `pg_dump` to object storage (R2 or OCI Object Storage) via
  cron. A database with no backup is a data-loss incident waiting for a date.
- Secrets: `JWT_SECRET` at least 32 bytes, strong DB password, `.env` never
  committed (it is gitignored).
- Health: point an uptime check (Cloudflare Health Checks or a cron `curl`) at
  `/health` so the single VM going down is noticed.
- Updates: `git pull` on the box, then
  `docker compose -f compose.yml -f compose.prod.yml up -d --build`.
- Cloudflare proxy: once TLS is verified working, you can turn the orange cloud
  on for the `api` record for DDoS shielding.

---

## Redeploy cheat sheet

Frontend:

```bash
bun run build
bunx wrangler pages deploy dist --project-name pandemonium --branch main --commit-dirty=true
```

Backend (on the OCI box):

```bash
git pull
docker compose -f compose.yml -f compose.prod.yml up -d --build
```
