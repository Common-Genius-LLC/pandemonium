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

Set it **DNS-only (grey cloud)**, not Proxied. Reason: Cloudflare's free
Universal SSL does not cover two-label subdomains (`api.pandemonium.*`), so
proxying causes `ERR_SSL_VERSION_OR_CIPHER_MISMATCH`. The origin server handles
TLS directly via Let's Encrypt (see B6). You can keep it DNS-only permanently, or
switch to proxied once you verify TLS works on the origin.

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
TRUST_PROXY=true
```

Notes:
- `TRUST_PROXY=true` is required behind the nginx in B6. The link-preview
  endpoint rate-limits per client, and without this every request arrives from
  the proxy's address, so all users share ONE bucket and hit the limit
  together. It makes the API read `X-Real-IP`, which that nginx config SETS
  from the real peer (overwriting anything a client sends). Only safe while
  port 8787 is unreachable except through nginx (see B3, and B8 below).
- Optional link-preview tuning: `LINK_PREVIEW_RATE_PER_MINUTE` (default 60),
  `LINK_PREVIEW_USER_AGENT` (the desktop-Chrome string tried first; bump the
  version now and then) and `LINK_PREVIEW_BOT_USER_AGENT` (the honest bot
  name tried second; see server/src/link-preview/service.ts for why there are
  two).
- `CORS_ORIGIN` must be the exact frontend origin (add the `*.pages.dev` URL too
  if you use it). It cannot be `*` because credentials are sent.
- `COOKIE_SECURE=true` switches the refresh cookie to Secure + SameSite=None,
  required across HTTPS origins.
- `DATABASE_URL` host is `db` (the compose service name), not localhost.

### B6. TLS config (nginx + certbot)

The host runs nginx as the reverse proxy for TLS termination (not Caddy in
compose). This is the preferred setup when the box already runs other services
(like `prose-backend`) behind nginx.

1. Install nginx and certbot:

```bash
sudo apt-get install -y nginx certbot python3-certbot-nginx
```

2. Create `/etc/nginx/sites-available/pandemonium`:

```nginx
server {
    server_name api.pandemonium.commongenius.in;
    location / {
        proxy_pass http://localhost:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 90;
    }
    listen 443 ssl; # managed by Certbot
    ssl_certificate /etc/letsencrypt/live/api.pandemonium.commongenius.in/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.pandemonium.commongenius.in/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
}
server {
    if ($host = api.pandemonium.commongenius.in) { return 301 https://$host$request_uri; }
    listen 80;
    server_name api.pandemonium.commongenius.in;
    return 404;
}
```

3. Enable the site and get the certificate:

```bash
sudo ln -s /etc/nginx/sites-available/pandemonium /etc/nginx/sites-enabled/
sudo certbot --nginx -d api.pandemonium.commongenius.in
```

4. `server/compose.prod.yml` (API + Postgres, no TLS service):

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
    environment:
      DATABASE_URL: postgres://pandemonium:${DB_PASSWORD}@db:5432/pandemonium
    depends_on: { db: { condition: service_healthy } }
    restart: always
    ports:
      - "8787:8787"
volumes:
  pgdata:
```

Notes:
- The API service binds to `0.0.0.0:8787` (not loopback). Port 8787 is not in
  the UFW allow list, so it is not publicly reachable; nginx on the host is the
  only public endpoint.
- Explicit `DATABASE_URL` override ensures prod uses the correct password from
  `.env` (the base `compose.yml` hardcodes `devpassword` for local dev).

### B7. Bring it up

```bash
docker compose -f compose.yml -f compose.prod.yml up -d --build
```

The API migrates the schema on boot (creates `users`, `projects`,
`refresh_tokens`).

Verify:

```bash
curl https://api.pandemonium.commongenius.in/health
```

Expect `{"ok":true,"service":"pandemonium-api"}`.

Then check link previews end to end against the deployed API (seven real
sites, one per failure mode: plain OG, no tags, video, an app deep link, a
bot wall, a redirect, Japanese text):

```bash
cd server && bun run validate:link-preview --api https://api.pandemonium.commongenius.in/v1
```

### B8. Harden the link-preview fetcher (recommended)

`GET /v1/link-preview` makes this server fetch URLs that anyone supplies. The
code refuses private, loopback and link-local addresses on every redirect hop
(server/src/link-preview/ssrf.ts), but one gap cannot be closed in code: DNS
rebinding, where a hostile DNS server answers the check with a public address
and the fetch a moment later with a private one. Close it at the network
layer instead, where it cannot be talked around:

1. **Instance metadata to v2 only.** OCI console: the instance, Edit,
   Instance metadata service, allow version 2 only. v2 refuses any request
   without the `Authorization: Bearer Oracle` header, which the fetcher never
   sends, so even a request that reached 169.254.169.254 would get nothing.

2. **Drop the containers' route to the metadata range.** Docker filters
   container traffic in its own `DOCKER-USER` chain (UFW does not see it):

   ```bash
   sudo iptables -I DOCKER-USER -d 169.254.0.0/16 -j DROP
   sudo apt-get install -y iptables-persistent && sudo netfilter-persistent save
   ```

   The private ranges (10.0.0.0/8, 192.168.0.0/16) can be dropped the same way
   if nothing in the API container needs them. Do NOT drop 172.16.0.0/12
   without checking: Docker's own bridge networks live there, and the API
   reaches Postgres across one.

3. **Keep 8787 on loopback.** In `compose.prod.yml`, publish the port as
   `"127.0.0.1:8787:8787"` rather than `"8787:8787"`. Docker writes its own
   iptables rules and bypasses UFW, so a published port can be public even
   when UFW says otherwise. (Checked from outside at the time of writing:
   8787 did not answer, so the VCN security list is doing this job today.
   Loopback binding makes it not depend on that.) This is also what keeps
   `TRUST_PROXY` honest: nobody can reach the API directly to forge
   `X-Real-IP`.

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
