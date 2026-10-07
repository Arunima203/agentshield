# AgentShield Deployment Guide

This guide covers containerization and deployment of AgentShield using Docker and Docker Compose.

## Quick Start (Development)

### Prerequisites
- Docker & Docker Compose installed
- Node.js 18+ (optional, for local development)
- Python 3.11+ (optional, for local development)

### Local Development Stack

```bash
# Start the backend (SQLite database is stored in a Docker volume)
docker-compose up

# In another terminal, start LLM services (optional)
docker-compose --profile llm up
```

**Services:**
- Backend: http://localhost:3002
- LLM API: http://localhost:8000 (with profile)
- Ollama: http://localhost:11434 (with profile)

**Environment:** `docker-compose.yml` uses development defaults
- SQLite data persists in the `backend-data` Docker volume
- JWT secrets: dev-only values (change in production)
- Log level: debug

---

## Production Deployment

### Prerequisites
- Docker & Docker Compose 1.29+
- A server with: 4+ CPU cores, 8+ GB RAM
- HTTPS certificates (or use Let's Encrypt)
- Domain name configured

### 1. SSL/TLS Certificates

#### Option A: Self-Signed (Development/Testing)
```bash
# Generate self-signed cert for 365 days
openssl req -x509 -newkey rsa:4096 -keyout nginx/ssl/key.pem -out nginx/ssl/cert.pem -days 365 -nodes \
  -subj "/C=US/ST=State/L=City/O=Organization/CN=agentshield.local"
```

#### Option B: Let's Encrypt (Production)
```bash
# Ensure nginx/ssl directory exists
mkdir -p nginx/ssl

# Generate certificate with certbot
docker run --rm -v ./nginx/ssl:/etc/letsencrypt \
  -v ./nginx/.well-known:/var/www/certbot \
  certbot/certbot certonly --standalone \
  -d agentshield.yourdomain.com \
  --email admin@yourdomain.com \
  --agree-tos --no-eff-email

# Copy certificates to nginx/ssl
cp nginx/ssl/live/agentshield.yourdomain.com/fullchain.pem nginx/ssl/cert.pem
cp nginx/ssl/live/agentshield.yourdomain.com/privkey.pem nginx/ssl/key.pem
```

### 2. Configure Environment

Create `.env.production`:
```bash
# JWT Secrets (generate new ones)
JWT_ACCESS_SECRET=$(openssl rand -base64 32)
JWT_REFRESH_SECRET=$(openssl rand -base64 32)

# First-run administrator (required by the production backend)
INITIAL_ADMIN_USERNAME=admin
INITIAL_ADMIN_PASSWORD=$(openssl rand -hex 24)

# Public frontend origin (must match the deployed frontend URL)
ALLOWED_ORIGINS=https://agentshield.yourdomain.com

# Grafana
GRAFANA_PASSWORD=$(openssl rand -base64 16)
```

Load the environment:
```bash
source .env.production
# Or on Windows:
# $env:JWT_ACCESS_SECRET="..."; $env:JWT_REFRESH_SECRET="..."
# $env:INITIAL_ADMIN_USERNAME="admin"; $env:INITIAL_ADMIN_PASSWORD="..."
```

### 3. HTTP Basic Auth (Prometheus/Grafana)

Generate credentials:
```bash
# Install htpasswd if needed
# Mac: brew install httpd
# Linux: sudo apt-get install apache2-utils
# Windows: Use WSL or online generator

htpasswd -cb nginx/.htpasswd admin admin_secure_password_here
chmod 600 nginx/.htpasswd  # Restrict permissions
```

### 4. Build Images

```bash
# Build all images
docker-compose -f docker-compose.prod.yml build

# Or build individually
docker build -f backend/Dockerfile -t agentshield-backend:latest .
docker build -f llm/Dockerfile -t agentshield-llm:latest .
docker build -f nginx/Dockerfile -t agentshield-nginx:latest .
```

### 5. Start Production Stack

```bash
# Bring up services in correct order
docker-compose -f docker-compose.prod.yml up -d

# Check service health
docker-compose -f docker-compose.prod.yml ps

# View logs
docker-compose -f docker-compose.prod.yml logs -f
```

**Expected output:**
```
CONTAINER ID   IMAGE                           STATUS              
xxx            agentshield-nginx               Up 5s (healthy)
xxx            agentshield-backend-1           Up 4s (healthy)
xxx            agentshield-ollama              Up 10s (healthy)
xxx            agentshield-llm-api             Up 3s (healthy)
xxx            agentshield-prometheus          Up 2s
xxx            agentshield-grafana             Up 2s
```

### 6. Verify Persistent Data

```bash
# The SQLite database is initialized automatically and stored in backend-data.
docker-compose -f docker-compose.prod.yml exec backend-1 ls -l /app/data/agentshield.db
```

### 7. Verify Deployment

**Backend Health:**
```bash
curl -k https://localhost/health  # Returns 200 OK with service info
```

**LLM Service:**
```bash
# Through nginx
curl -k https://localhost/llm/health

# Or direct (if exposed)
curl http://localhost:8000/health
```

**Authentication:**
```bash
# Create default admin user (via init script)
# Login endpoint available
curl -X POST https://localhost/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@agentshield.local","password":"admin"}'
```

### 8. Test Tool Call Inspection

```bash
# After authentication, test tool inspection
TOKEN=$(curl -X POST https://localhost/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@agentshield.local","password":"admin"}' \
  | jq -r '.accessToken')

curl -X POST https://localhost/api/inspect \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "execute_pwsh",
    "args": {"command": "echo hello"},
    "agentId": "test-agent"
  }'
```

Expected response:
```json
{
  "toolCallId": "uuid",
  "decision": "allow",
  "riskScore": 15,
  "riskLevel": "safe",
  "message": "Tool call approved automatically (risk score: 15)"
}
```

---

## Monitoring & Observability

### Grafana Dashboards
Access at: https://localhost/grafana

**Login:**
- Username: admin
- Password: (from `.env.production` GRAFANA_PASSWORD)

**Pre-configured dashboards:**
- AgentShield Overview
- Request latency
- Error rate
- Tool call decisions

### Prometheus Metrics
Access at: https://localhost/metrics

**Requires basic auth** (set via nginx/.htpasswd):
```bash
curl --user admin:password https://localhost/metrics
```

### Application Logs

**View backend logs:**
```bash
docker-compose -f docker-compose.prod.yml logs -f backend-1
```

**View nginx logs:**
```bash
docker-compose -f docker-compose.prod.yml exec nginx tail -f /var/log/nginx/agentshield_access.log
```

**View LLM logs:**
```bash
docker-compose -f docker-compose.prod.yml logs -f llm-api
```

---

## Scaling & Performance

The current backend stores users, approvals, and audit entries in a local SQLite
database. Production Compose intentionally runs one backend instance with a
persistent volume. Do not add backend replicas or scale this service horizontally:
instances would not share database state or realtime events. A shared database
and Redis-backed event transport are required before horizontal scaling.

### Ollama GPU Support
Ollama uses CPU by default so the production Compose stack works without an
NVIDIA runtime. To enable GPU acceleration, add this reservation to the `ollama`
service in `docker-compose.prod.yml`:

```yaml
ollama:
  deploy:
    resources:
      reservations:
        devices:
          - driver: nvidia
            count: 1
            capabilities: [gpu]
```

Requires:
- NVIDIA GPU with CUDA support
- nvidia-docker or Docker 20.10+ with NVIDIA runtime
- NVIDIA Container Toolkit installed

---

## Maintenance

### Database Backups

**Manual backup:** stop the backend briefly so the SQLite file cannot change while copied.
```bash
docker-compose -f docker-compose.prod.yml stop backend-1
docker cp agentshield-backend-1:/app/data/agentshield.db "backup_$(date +%Y%m%d_%H%M%S).db"
docker-compose -f docker-compose.prod.yml start backend-1
```

**Restore:**
```bash
docker-compose -f docker-compose.prod.yml stop backend-1
docker cp backup_20261007_120000.db agentshield-backend-1:/app/data/agentshield.db
docker-compose -f docker-compose.prod.yml start backend-1
```

**Automated backups (cron):**
```bash
# Add to crontab: 0 2 * * * /path/to/backup.sh
cat > /path/to/backup.sh << 'EOF'
#!/bin/bash
docker-compose -f docker-compose.prod.yml stop backend-1
docker cp agentshield-backend-1:/app/data/agentshield.db "/backups/backup_$(date +\%Y\%m\%d_\%H\%M\%S).db"
docker-compose -f docker-compose.prod.yml start backend-1
find /backups -type f -mtime +30 -delete  # Keep 30 days
EOF
chmod +x /path/to/backup.sh
```

### Log Rotation

Configure logrotate for nginx logs:
```bash
cat > /etc/logrotate.d/agentshield << 'EOF'
/var/lib/docker/volumes/*_nginx-logs/_data/agentshield_*.log {
    daily
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 www-data www-data
    sharedscripts
    postrotate
        docker-compose -f docker-compose.prod.yml exec nginx nginx -s reload
    endscript
}
EOF
```

### Certificate Renewal

**Manual renewal (Let's Encrypt):**
```bash
docker run --rm -v ./nginx/ssl:/etc/letsencrypt \
  -v ./nginx/.well-known:/var/www/certbot \
  certbot/certbot renew
```

**Automated renewal (cron):**
```bash
# Add to crontab: 0 3 * * * /path/to/renew-cert.sh
cat > /path/to/renew-cert.sh << 'EOF'
#!/bin/bash
cd /path/to/agentshield
docker run --rm -v ./nginx/ssl:/etc/letsencrypt \
  -v ./nginx/.well-known:/var/www/certbot \
  certbot/certbot renew
docker-compose -f docker-compose.prod.yml exec nginx nginx -s reload
EOF
chmod +x /path/to/renew-cert.sh
```

---

## Troubleshooting

### Backend won't start: "Database not initialized"
```bash
# Check the SQLite data directory and backend logs
docker-compose -f docker-compose.prod.yml exec backend-1 ls -l /app/data
docker-compose -f docker-compose.prod.yml logs --tail=100 backend-1
```

### LLM service returns 503
```bash
# Check Ollama is running and has model
docker-compose -f docker-compose.prod.yml exec ollama ollama list

# Pull model if missing
docker-compose -f docker-compose.prod.yml exec ollama ollama pull qwen2.5:7b
```

### Nginx "502 Bad Gateway"
```bash
# Check if backend services are healthy
docker-compose -f docker-compose.prod.yml ps

# Check nginx error log
docker-compose -f docker-compose.prod.yml exec nginx cat /var/log/nginx/agentshield_error.log

# Restart nginx
docker-compose -f docker-compose.prod.yml restart nginx
```

### Out of memory errors
```bash
# Check resource usage
docker stats

# Increase docker memory limit (in Docker Desktop settings or daemon.json)
# Then restart containers
docker-compose -f docker-compose.prod.yml down
docker-compose -f docker-compose.prod.yml up -d
```

---

## Security Best Practices

✅ **Implemented:**
- [x] Non-root users in all containers
- [x] Health checks on all services
- [x] SSL/TLS termination in nginx
- [x] HSTS, X-Frame-Options, CSP headers
- [x] Rate limiting (100 req/min by default)
- [x] JWT authentication on protected routes
- [x] Basic auth on metrics endpoints

⚠️ **To Configure:**
- [ ] Adjust `CORS_ORIGIN` for your domain in nginx config
- [ ] Change default JWT secrets (MUST before production)
- [ ] Enable backup encryption (`gpg -c backup.sql`)
- [ ] Use a secrets manager (HashiCorp Vault, AWS Secrets Manager)
- [ ] Enable audit logging for all admin operations
- [ ] Implement WAF rules in nginx (optional, using ModSecurity)

### Secrets Management

**Do NOT commit secrets to git:**
```bash
# Create .env.production (add to .gitignore)
echo ".env.production" >> .gitignore
echo "nginx/.htpasswd" >> .gitignore

# Load before deployment
set -a
source .env.production
set +a
```

**Use Docker secrets for swarm mode:**
```bash
docker secret create db_password -
# Enter password, press Ctrl+D
```

---

## Rolling Updates

Zero-downtime updates with load balancing:

```bash
# Update backend code
git pull origin main

# Rebuild images
docker-compose -f docker-compose.prod.yml build backend

# The backend uses SQLite; restart its single instance
docker-compose -f docker-compose.prod.yml up -d backend-1

# Verify no errors
docker-compose -f docker-compose.prod.yml logs | grep -i error
```

---

## Disaster Recovery

### Backup Strategy
- **Daily:** Automated SQLite database backups to `/backups`
- **Weekly:** Full system snapshot (via cloud provider)
- **Monthly:** Off-site backup (S3, GCS, etc.)

### Recovery Procedure
```bash
# 1. Stop application
docker-compose -f docker-compose.prod.yml down

# 2. Restore the persistent SQLite database
docker volume ls
docker run --rm -v agentshield-backend-data:/data \
  -v "$PWD/backup.db:/backup/agentshield.db:ro" alpine \
  cp /backup/agentshield.db /data/agentshield.db

# 3. Start application
docker-compose -f docker-compose.prod.yml up -d

# 4. Verify
curl -k https://localhost/health
```

---

## Support & Resources

- **Documentation:** See `README.md` and `ARCHITECTURE_ALIGNMENT.md`
- **Issues:** Report to GitHub issues
- **Security:** Report vulnerabilities to security@agentshield.local

---

**Last Updated:** October 6, 2026  
**Version:** 1.0.0
