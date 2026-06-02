# Oracle Cloud Always Free Deployment Guide

This guide deploys the SJI Glass, Windows & Doors estimator on an Oracle Cloud Ubuntu VM using Docker containers, PostgreSQL, NGINX, and Let's Encrypt HTTPS.

## 1. Create The Oracle Cloud VM

1. In Oracle Cloud, create an Always Free Ubuntu instance.
2. Recommended shape: Ampere A1 Flex with 1 OCPU and 6 GB RAM, or the free AMD VM if that is what your tenancy supports.
3. Add your SSH public key.
4. In the VM subnet security list or network security group, allow inbound TCP:
   - `22` for SSH
   - `80` for HTTP
   - `443` for HTTPS
5. Point your DNS record to the VM public IP:
   - Example: `estimator.yourdomain.com -> <Oracle public IP>`

## 2. Install Server Packages

SSH into the server:

```bash
ssh ubuntu@<oracle-public-ip>
```

Update Ubuntu and install Docker, Git, NGINX, and Certbot:

```bash
sudo apt update
sudo apt upgrade -y
sudo apt install -y ca-certificates curl gnupg git nginx certbot python3-certbot-nginx
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker ubuntu
```

Log out and back in so the `docker` group applies.

If Ubuntu firewall is enabled, allow web traffic:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw status
```

## 3. Clone From GitHub

Create a GitHub repository, push this project, then clone it on Oracle:

```bash
git clone https://github.com/<your-org-or-user>/<your-repo>.git
cd <your-repo>
```

## 4. Configure Production Environment

Copy the template and edit secrets:

```bash
cp .env.example .env
nano .env
```

Set these values:

```text
NODE_ENV=production
PORT=4173
APP_ORIGIN=https://estimator.yourdomain.com
SJI_ADMIN_EMAIL=owner@sjiglass.com
SJI_ADMIN_PASSWORD=<long random admin password>
POSTGRES_DB=sji_estimator
POSTGRES_USER=sji_app
POSTGRES_PASSWORD=<long random database password>
DATABASE_URL=postgres://sji_app:<same database password>@postgres:5432/sji_estimator
```

Generate strong passwords:

```bash
openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 40
```

Lock down the file:

```bash
chmod 600 .env
```

Never commit `.env` to GitHub.

## 5. Start App And PostgreSQL

Build and start the containers:

```bash
docker compose up -d --build
```

Check status:

```bash
docker compose ps
docker compose logs -f app
```

The app container uses `restart: unless-stopped`, so it automatically restarts after crashes or VM reboots.

## 6. Configure NGINX Reverse Proxy

Copy the NGINX config:

```bash
sudo cp deploy/nginx/sji-estimator.conf /etc/nginx/sites-available/sji-estimator
sudo nano /etc/nginx/sites-available/sji-estimator
```

Replace every `estimator.yourdomain.com` with your real domain.

Enable it:

```bash
sudo ln -s /etc/nginx/sites-available/sji-estimator /etc/nginx/sites-enabled/sji-estimator
sudo nginx -t
sudo systemctl reload nginx
```

## 7. Enable HTTPS With Let's Encrypt

Run Certbot:

```bash
sudo certbot --nginx -d estimator.yourdomain.com
```

Test auto-renewal:

```bash
sudo certbot renew --dry-run
```

## 8. Verify Production

Open:

```text
https://estimator.yourdomain.com
```

Sign in with the initial admin account from `.env`. After logging in, create named accounts for team members in **Team Access**.

## 9. Backups

Back up PostgreSQL regularly:

```bash
docker compose exec postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > sji-estimator-$(date +%F).sql
```

Restore:

```bash
cat backup.sql | docker compose exec -T postgres psql -U "$POSTGRES_USER" "$POSTGRES_DB"
```

## 10. Updates

Pull new code and rebuild:

```bash
git pull
docker compose up -d --build
docker compose logs -f app
```

## Notes For Always Free

- Keep PostgreSQL in the Docker volume named `postgres-data`.
- Do not expose PostgreSQL to the public internet.
- Open only ports `22`, `80`, and `443` in Oracle networking.
- Use a reserved public IP if you do not want DNS to change when recreating the VM.
