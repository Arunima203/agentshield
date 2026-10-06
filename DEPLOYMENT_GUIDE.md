# AgentShield Deployment Guide

This guide covers containerization and deployment of AgentShield using Docker and Docker Compose.

## Quick Start (Development)

### Prerequisites
- Docker & Docker Compose installed
- Node.js 18+ (optional, for local development)
- Python 3.11+ (optional, for local development)

### Local Development Stack

```bash
# Start core services (PostgreSQL + Backend)
docker-compose up

# In another terminal, start LLM services (optional)
docker-compose --profile llm up
```

**Services:**
- Backend: http://localhost:3000
- PostgreSQL: localhost:5432 (inside docker network)
- LLM API: http://localhost:8000 (with profile)
- Ollama: http://localhost:11434 (with profile)

**Environment:** `docker-compose.yml` uses development defaults
- PostgreSQL: agentshield / agentshield_password
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
# Database
DB_USER=agentshield_prod
DB_PASSWORD=$(openssl rand -base64 32)
DB_POOL_SIZE=20

# JWT Secrets (generate new ones)
JWT_ACCESS_SECRET=$(openssl rand -base64 32)
JWT_REFRESH_SECRET=$(openssl rand -base64 32)

# Grafana
GRAFANA_PASSWORD=$(openssl rand -base64 16)
```

Load the environment:
```bash
source .env.production
# Or on Windows:
# $env:DB_USER="agentshield_prod"; $env:DB_PASSWORD="..."; etc.
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
xxx            agentshield-backend-2           Up 4s (healthy)
xxx            agentshield-backend-3           Up 4s (healthy)
xxx            agentshield-ollama              Up 10s (healthy)
xxx            agentshield-llm-api             Up 3s (healthy)
xxx            agentshield-postgres            Up 2s (healthy)
xxx            agentshield-prometheus          Up 2s
xxx            agentshield-grafana             Up 2s
```

### 6. Initialize Data

```bash
# The database is auto-initialized via docker-entrypoint-initdb.d
# Verify it's ready:
docker-compose -f docker-compose.prod.yml exec postgres pg_isready -U agentshield_prod

# Check tables were created
docker-compose -f docker-compose.prod.yml exec postgres psql -U agentshield_prod -d agentshield -c "\dt"
```

Expected tables:
```
schema_version
users
audit_log
approval_requests
configuration
sessions
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
docker-compose -f docker-compose.prod.yml logs -f backend-1 backend-2 backend-3
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

### Database Connection Pooling
Configured in `docker-compose.prod.yml`:
```yaml
DB_POOL_SIZE=20        # Max 20 connections
DB_IDLE_TIMEOUT=30000  # 30s idle timeout
```

**Adjust based on load:**
- Low traffic: 5-10 connections
- Medium traffic: 10-20 connections
- High traffic: 20-50 connections

### Backend Replicas
Production stack includes 3 backend replicas with **least-conn** load balancing:
- Request 1 → backend-1
- Request 2 → backend-2
- Request 3 → backend-3
- Request 4 → whichever has fewest active connections

**Add more replicas:**
```yaml
backend-4:
  build:
    context: .
    dockerfile: backend/Dockerfile
  # ... copy from backend-1, change container_name
```

### Ollama GPU Support
By default, Ollama runs on CPU. To enable GPU (NVIDIA):

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

**Manual backup:**
```bash
docker-compose -f docker-compose.prod.yml exec postgres pg_dump \
  -U agentshield_prod \
  -d agentshield > backup_$(date +%Y%m%d_%H%M%S).sql
```

**Restore:**
```bash
docker-compose -f docker-compose.prod.yml exec postgres psql \
  -U agentshield_prod \
  -d agentshield < backup_20240101_120000.sql
```

**Automated backups (cron):**
```bash
# Add to crontab: 0 2 * * * /path/to/backup.sh
cat > /path/to/backup.sh << 'EOF'
#!/bin/bash
docker-compose -f docker-compose.prod.yml exec postgres pg_dump \
  -U agentshield_prod \
  -d agentshield > /backups/backup_$(date +\%Y\%m\%d_\%H\%M\%S).sql
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
# Wait for PostgreSQL to be ready
docker-compose -f docker-compose.prod.yml exec postgres pg_isready

# Check if migrations ran
docker-compose -f docker-compose.prod.yml exec postgres psql \
  -U agentshield_prod -d agentshield -c "SELECT version FROM schema_version"
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

# Restart one backend at a time
docker-compose -f docker-compose.prod.yml up -d backend-1
sleep 10  # Wait for health check
docker-compose -f docker-compose.prod.yml up -d backend-2
sleep 10
docker-compose -f docker-compose.prod.yml up -d backend-3

# Verify no errors
docker-compose -f docker-compose.prod.yml logs | grep -i error
```

---

## Disaster Recovery

### Backup Strategy
- **Daily:** Automated PostgreSQL dumps to `/backups`
- **Weekly:** Full system snapshot (via cloud provider)
- **Monthly:** Off-site backup (S3, GCS, etc.)

### Recovery Procedure
```bash
# 1. Stop application
docker-compose -f docker-compose.prod.yml down

# 2. Restore database
docker run --rm -v agentshield_postgres-data:/data \
  -v ./backup.sql:/backup.sql \
  postgres:15-alpine \
  psql -U agentshield_prod -d agentshield < /backup.sql

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
