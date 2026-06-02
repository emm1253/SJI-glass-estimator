# SJI Glass, Windows & Doors Estimator

A secure React + TypeScript estimating app with a Node backend, PostgreSQL production storage, login authentication, role-based permissions, protected pricing settings, and saved estimates.

## Run

Use the bundled Node runtime if regular `node` is not available:

```powershell
C:\Users\emmad\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe server.mjs
```

Then open:

```text
http://localhost:4173
```

On first local startup, the server creates a development admin account if `data/users.json` does not exist:

```text
admin@sjiglass.local
ChangeMe!2026
```

Change this before any real deployment. In production, set `SJI_ADMIN_EMAIL` and `SJI_ADMIN_PASSWORD`; the server refuses to start without them.

## Security

- Email/password login is required before estimator, pricing, labor, add-ons, saved estimates, or team access APIs can be used.
- Passwords are stored with salted `scrypt` hashes.
- Sessions use random server-side tokens stored as SHA-256 hashes and sent as `HttpOnly`, `SameSite=Strict` cookies.
- Admin-only routes protect pricing settings and team member access.
- Team Members can create/view estimates and use estimator tools, but cannot edit pricing or manage users.
- State-changing API requests validate same-origin requests.
- Production responses include browser security headers and HSTS when `NODE_ENV=production`.

## Production Architecture

- Dockerized Node app serving the React/TypeScript UI and authenticated API
- PostgreSQL database container for users, sessions, pricing settings, and estimates
- NGINX reverse proxy on the Oracle Ubuntu host
- Let's Encrypt SSL certificates through Certbot
- Docker `restart: unless-stopped` policies for automatic restart

Full Oracle Cloud steps are in [deploy/oracle-cloud.md](deploy/oracle-cloud.md).

## Pricing Data

In production, pricing and markup settings are stored in PostgreSQL. For local development without `DATABASE_URL`, the app falls back to `data/pricing.json`.

The admin page edits:

- Glass spec price per square foot
- Markup multiplier
- Optional default tax rate
- Add-ons and cost types
- Labor rates, flat fee, and enabled methods

## Hosting

The app is deployment-ready as a single Node web service. Use HTTPS in front of it and persist the data directory.

Required production environment:

```text
NODE_ENV=production
PORT=4173
DATA_DIR=/app/data
APP_ORIGIN=https://your-hosted-domain.example
SJI_ADMIN_EMAIL=owner@sjiglass.com
SJI_ADMIN_PASSWORD=<long random password>
```

Docker build/run:

```powershell
docker build -t sji-glass-estimator .
docker run -p 4173:4173 --env-file .env -v sji_estimator_data:/app/data sji-glass-estimator
```

Do not deploy local `data/users.json`, `data/sessions.json`, or `data/estimates.json`; they are ignored by `.dockerignore`.

## Quick Oracle Deployment Checklist

1. Create an Oracle Cloud Always Free Ubuntu VM.
2. Open ports `22`, `80`, and `443` in Oracle networking.
3. Point your domain DNS record to the VM public IP.
4. Install Docker, Git, NGINX, and Certbot.
5. Clone the GitHub repository on the server.
6. Copy `.env.example` to `.env` and set strong secrets.
7. Run `docker compose up -d --build`.
8. Install `deploy/nginx/sji-estimator.conf` into NGINX and replace the domain.
9. Run `sudo certbot --nginx -d your-domain`.
10. Sign in with the initial admin account and create team member accounts.
