# Docker Build Instructions

Quick reference for building and testing AgentShield containers.

## File Structure Created

```
project-root/
├── backend/
│   ├── Dockerfile                    ← Multi-stage Node.js build
│   ├── .dockerignore
│   ├── src/
│   ├── package.json
│   └── agentshield.config.yaml
│
├── llm/
│   ├── Dockerfile                    ← Python 3.11 FastAPI server
│   ├── .dockerignore
│   ├── fastapi_server.py
│   └── security_analyzer.py
│
├── nginx/
│   ├── Dockerfile                    ← Nginx 1.25 reverse proxy
│   ├── agentshield.conf              ← Production config with SSL, load balancing
│   ├── .dockerignore
│   ├── ssl/
│   │   └── .gitkeep                  ← SSL certificates go here
│   ├── .htpasswd.example             ← HTTP basic auth template
│   └── .well-known/                  ← ACME challenge directory
│
├── docker-compose.yml                ← Development stack
├── docker-compose.prod.yml           ← Production stack (3 replicas, monitoring)
├── DEPLOYMENT_GUIDE.md               ← Complete deployment documentation
└── DOCKER_BUILD_INSTRUCTIONS.md      ← This file
```

## Build Commands

### Development Images

```bash
# Build backend
docker build -f backend/Dockerfile -t agentshield-backend:dev .

# Build LLM service
docker build -f llm/Dockerfile -t agentshield-llm:dev .

# Build nginx
docker build -f nginx/Dockerfile -t agentshield-nginx:dev .
```

### Production Images

```bash
# Build all with docker-compose
docker-compose -f docker-compose.prod.yml build

# Or individual services
docker-compose -f docker-compose.prod.yml build backend
docker-compose -f docker-compose.prod.yml build llm-api
docker-compose -f docker-compose.prod.yml build nginx
```

## Image Details

### Backend Image
**Base:** `node:18-alpine` (150MB)  
**Size:** ~400-500MB (built)

**What's included:**
- TypeScript compiled to JavaScript
- node_modules with production dependencies only
- agentshield.config.yaml configuration
- Non-root nodejs user
- Health check endpoint

**Volumes:**
- `/app/logs` — application logs
- `/app/agentshield.config.yaml` — configuration (mounted)

### LLM Image
**Base:** `python:3.11-slim` (130MB)  
**Size:** ~300-350MB (built)

**What's included:**
- FastAPI server
- Ollama Python client
- All security analyzer dependencies
- Non-root llm user

**Dependencies pinned:**
- fastapi==0.104.1
- uvicorn==0.24.0
- ollama==0.1.26
- pydantic==2.5.0

### Nginx Image
**Base:** `nginx:1.25-alpine` (40MB)  
**Size:** ~60-70MB (built)

**What's included:**
- Reverse proxy configuration
- SSL/TLS support
- Load balancing (least_conn)
- Security headers
- Rate limiting
- gzip compression

**Ports:**
- 80 (HTTP, redirects to HTTPS)
- 443 (HTTPS)

## Docker Compose Stack

### Development Stack (`docker-compose.yml`)

Services:
- **postgres** — PostgreSQL 15 database
- **backend** — Node.js application
- **llm-api** — Python FastAPI (optional, `--profile llm`)
- **ollama** — Ollama LLM runtime (optional, `--profile llm`)

**Start:**
```bash
# Core services
docker-compose up

# With LLM services
docker-compose --profile llm up
```

**Ports:**
- Backend: 3000
- PostgreSQL: 5432
- LLM API: 8000 (with profile)
- Ollama: 11434 (with profile)

### Production Stack (`docker-compose.prod.yml`)

Services:
- **nginx** — Reverse proxy + load balancer
- **backend-1, backend-2, backend-3** — 3 replicas
- **postgres** — PostgreSQL database
- **ollama** — LLM runtime
- **llm-api** — FastAPI analyzer
- **prometheus** — Metrics collection
- **grafana** — Dashboards

**Start:**
```bash
# Build images
docker-compose -f docker-compose.prod.yml build

# Start services
docker-compose -f docker-compose.prod.yml up -d

# Check health
docker-compose -f docker-compose.prod.yml ps

# View logs
docker-compose -f docker-compose.prod.yml logs -f
```

**Ports:**
- Nginx: 80, 443 (public)
- Backend: 3000 (internal)
- Grafana: 3000 (internal, via nginx /grafana)
- Prometheus: 9090 (internal, via nginx /metrics)

## .dockerignore Files

Optimizes build layer caching by excluding unnecessary files:

**backend/.dockerignore:**
- node_modules (installed in container)
- .env files
- .git, .pytest_cache, .next
- SQLite database and logs
- Test coverage reports

**llm/.dockerignore:**
- __pycache__, *.pyc
- .venv, venv
- .pytest_cache
- Test outputs

**nginx/.dockerignore:**
- .git
- SSL certificates (mounted separately)
- .htpasswd file (mounted separately)

## Production Checklist

Before deploying to production:

- [ ] **SSL Certificates**
  ```bash
  # Generate self-signed (dev only)
  openssl req -x509 -newkey rsa:4096 -keyout nginx/ssl/key.pem -out nginx/ssl/cert.pem -days 365 -nodes
  
  # Or get Let's Encrypt certificate
  # See DEPLOYMENT_GUIDE.md
  ```

- [ ] **Environment Secrets**
  ```bash
  # Create .env.production with secure values
  DB_USER=agentshield_prod
  DB_PASSWORD=$(openssl rand -base64 32)
  JWT_ACCESS_SECRET=$(openssl rand -base64 32)
  JWT_REFRESH_SECRET=$(openssl rand -base64 32)
  GRAFANA_PASSWORD=$(openssl rand -base64 16)
  ```

- [ ] **HTTP Basic Auth** (for metrics)
  ```bash
  htpasswd -cb nginx/.htpasswd admin secure_password
  chmod 600 nginx/.htpasswd
  ```

- [ ] **Update nginx config**
  - Change `server_name` from `agentshield.local` to your domain
  - Uncomment/configure CORS_ORIGIN for your frontend domain

- [ ] **Database backups** — Implement backup strategy
  - Automated daily dumps
  - Off-site storage

- [ ] **Security**
  - [ ] Non-root users (✓ implemented)
  - [ ] Health checks (✓ implemented)
  - [ ] HTTPS/SSL (✓ configured, needs certs)
  - [ ] Rate limiting (✓ configured, 100 req/min)
  - [ ] JWT authentication (✓ implemented)
  - [ ] CORS properly configured (needs domain)

## Troubleshooting Builds

### Backend build fails: "npm run build"
```bash
# Check TypeScript errors
docker build -f backend/Dockerfile --no-cache -t agentshield-backend:debug . 2>&1 | grep -A 5 "error TS"

# Fix: Ensure all .ts files compile
npm run build  # locally first
```

### LLM build fails: "pip install"
```bash
# Check Python compatibility
docker build -f llm/Dockerfile --no-cache -t agentshield-llm:debug .

# If network error:
# - Use build cache: remove --no-cache
# - Or pre-download wheels and COPY
```

### Nginx build fails: "COPY nginx/agentshield.conf"
```bash
# File not found
docker build -f nginx/Dockerfile --no-cache -t agentshield-nginx:debug .

# Fix: Ensure nginx/agentshield.conf exists
ls -la nginx/agentshield.conf
```

### Docker compose won't start: "service unhealthy"
```bash
# Check which service failed
docker-compose -f docker-compose.prod.yml ps

# Check logs
docker-compose -f docker-compose.prod.yml logs SERVICE_NAME

# Common issues:
# - Database not ready: wait 30+ seconds
# - Port already in use: change port mapping
# - Volume permission denied: fix ownership
```

## Performance Tips

### Image Size Optimization
- ✓ Multi-stage build for backend (removes build tools)
- ✓ alpine base images for smaller footprint
- ✓ Production dependencies only (npm ci --only=production)
- ✓ .dockerignore to exclude unnecessary files

**Resulting sizes:**
- Backend: ~450MB
- LLM: ~350MB
- Nginx: ~70MB
- Total: ~870MB for all images

### Build Speed
- First build: ~5-10 minutes (downloads dependencies)
- Subsequent builds: ~1-2 minutes (layer caching)
- Rebuild single service: ~30s-1m

### Runtime Performance
- Startup time: ~5s (database migrations)
- Requests: <100ms average (with LLM: 500-2000ms)
- Memory: Backend ~200MB, LLM ~800MB, Ollama ~2-4GB

## Multi-Stage Build Explanation

### Backend Dockerfile Structure

```dockerfile
# Stage 1: Build
FROM node:18-alpine AS builder
RUN npm ci
COPY src ./src
RUN npm run build        # Generates dist/

# Stage 2: Runtime
FROM node:18-alpine
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
CMD ["node", "dist/index.js"]
```

**Benefits:**
- ✓ Final image includes ONLY dist/ + node_modules
- ✓ TypeScript compiler not in runtime image
- ✓ Smaller image size (~450MB vs 800MB+)
- ✓ No source code leaks to production

## Security Features

**Container Security:**
- ✓ Non-root users (nodejs, llm)
- ✓ Read-only filesystems (except /app/logs)
- ✓ No sudo or privilege escalation
- ✓ Minimal base images (alpine)

**Network Security:**
- ✓ SSL/TLS termination in nginx
- ✓ HSTS headers (30 days)
- ✓ X-Frame-Options: DENY
- ✓ X-XSS-Protection enabled
- ✓ CORS restricted to known origins
- ✓ Rate limiting (100 req/min)

**Secrets Management:**
- ✓ Secrets NOT hardcoded
- ✓ Environment variables for configuration
- ✓ .env files excluded from images
- ✓ Recommend: Docker Secrets for swarm

## Monitoring & Logging

**Health Checks:**
```bash
# All services have health checks
docker-compose -f docker-compose.prod.yml ps

# Manual health check
curl http://localhost:3000/health        # Backend
curl http://localhost:8000/health        # LLM
curl -k https://localhost/health         # Nginx
```

**Logs:**
```bash
# Follow all logs
docker-compose -f docker-compose.prod.yml logs -f

# Specific service
docker-compose -f docker-compose.prod.yml logs -f backend-1

# Last 100 lines
docker-compose -f docker-compose.prod.yml logs --tail=100 backend
```

**Metrics:**
```bash
# Resource usage
docker stats

# Inspect image details
docker inspect agentshield-backend:latest
```

## Next Steps

1. **Review** `DEPLOYMENT_GUIDE.md` for production setup
2. **Configure** SSL certificates (see SSL section above)
3. **Set** environment secrets (.env.production)
4. **Build** images: `docker-compose -f docker-compose.prod.yml build`
5. **Deploy** stack: `docker-compose -f docker-compose.prod.yml up -d`
6. **Monitor** services and logs
7. **Backup** database regularly

---

**Reference:** All Dockerfiles implement best practices for security, performance, and maintainability.
