# AgentShield LLM — Deployment Guide

Production deployment checklist and configurations.

## Pre-Deployment Checklist

- [ ] Ollama installed and tested locally
- [ ] LLM model(s) pulled: `ollama pull qwen2.5:7b`
- [ ] Backend dependencies installed: `npm install`
- [ ] Python dependencies installed: `pip install -r requirements.txt`
- [ ] Environment variables configured
- [ ] All e2e tests passing
- [ ] Load testing completed
- [ ] Monitoring/alerting configured
- [ ] Documentation reviewed by team

## Environment Variables

### Backend (`backend/.env`)

```bash
# Server
PORT=5000
NODE_ENV=production

# Approval
APPROVAL_MODE=auto              # auto | strict | audit
ENABLE_LLM=true

# LLM Service Connection
LLM_API_URL=http://127.0.0.1:8000
LLM_API_TIMEOUT=30000           # 30 seconds

# Database (if using external)
DB_HOST=localhost
DB_PORT=3306
DB_NAME=agentshield
DB_USER=agentshield
DB_PASSWORD=secure_password

# Logging
LOG_LEVEL=info                  # debug | info | warn | error
LOG_FILE=logs/app.log

# JWT
JWT_SECRET=your-secure-secret-key
JWT_EXPIRY=24h
```

### Python LLM (`llm/.env`)

```bash
# Ollama Configuration
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5:7b
OLLAMA_TIMEOUT=60               # Seconds
OLLAMA_NUM_PARALLEL=4           # Parallel requests

# LLM Parameters
LLM_TEMPERATURE=0               # 0 = deterministic
LLM_TOP_P=0.95

# FastAPI Server
LLM_API_HOST=0.0.0.0           # 0.0.0.0 for network access
LLM_API_PORT=8000
LOG_LEVEL=info

# Security
API_KEY=optional-api-key        # For authentication
ALLOWED_ORIGINS=http://localhost:5000,https://your-domain.com
```

## Deployment Scenarios

### Scenario 1: Single Machine (Development/Testing)

All services on one machine.

```
┌─────────────────────────────────┐
│      Single Server              │
│  ┌──────────────────────────┐   │
│  │ Ollama                   │   │
│  │ (Port 11434)             │   │
│  └───────────┬──────────────┘   │
│              │                  │
│  ┌───────────▼──────────────┐   │
│  │ FastAPI LLM Service      │   │
│  │ (Port 8000)              │   │
│  └───────────┬──────────────┘   │
│              │                  │
│  ┌───────────▼──────────────┐   │
│  │ Node.js Backend          │   │
│  │ (Port 5000)              │   │
│  └──────────────────────────┘   │
└─────────────────────────────────┘
```

**Start Order:**
```bash
# Terminal 1
ollama serve

# Terminal 2
python -m llm.fastapi_server

# Terminal 3
npm run dev
```

**RAM Required:** 8GB+
**Disk:** 10GB+ (for model)

---

### Scenario 2: Separate Services (Production)

LLM service on dedicated GPU machine.

```
┌──────────────────────────────┐
│   GPU Server                 │
│  ┌────────────────────────┐  │
│  │ Ollama                 │  │
│  │ (CPU or GPU optimized) │  │
│  └───────────┬────────────┘  │
│              │                │
│  ┌───────────▼────────────┐  │
│  │ FastAPI LLM Service    │  │
│  │ :8000                  │  │
│  └────────────────────────┘  │
└──────────────┬───────────────┘
               │
        [Network: HTTP]
               │
┌──────────────▼───────────────┐
│   Application Server         │
│  ┌────────────────────────┐  │
│  │ Node.js Backend        │  │
│  │ :5000                  │  │
│  │                        │  │
│  │ Calls LLM API over     │  │
│  │ HTTP with retry logic  │  │
│  └────────────────────────┘  │
└──────────────────────────────┘
```

**Configuration:**
```bash
# On GPU server (server1.example.com:8000)
OLLAMA_BASE_URL=http://localhost:11434
LLM_API_HOST=0.0.0.0

# On app server (server2.example.com:5000)
LLM_API_URL=http://server1.example.com:8000
```

**Network Requirements:**
- Allow port 8000 from app server to GPU server
- Use HTTPS in production: Add reverse proxy (Nginx)
- Consider: VPC, security groups, firewalls

---

### Scenario 3: Kubernetes Deployment

Scalable cloud deployment.

```yaml
# kubernetes-deployment.yaml

apiVersion: v1
kind: Namespace
metadata:
  name: agentshield

---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ollama-server
  namespace: agentshield
spec:
  replicas: 1  # Single Ollama instance (GPU)
  selector:
    matchLabels:
      app: ollama
  template:
    metadata:
      labels:
        app: ollama
    spec:
      containers:
      - name: ollama
        image: ollama/ollama:latest
        ports:
        - containerPort: 11434
        resources:
          limits:
            nvidia.com/gpu: 1  # Requires GPU node
          requests:
            memory: "8Gi"
            cpu: "4"
        volumeMounts:
        - name: ollama-data
          mountPath: /root/.ollama
      volumes:
      - name: ollama-data
        persistentVolumeClaim:
          claimName: ollama-pvc

---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: llm-api-service
  namespace: agentshield
spec:
  replicas: 2  # Two replicas for HA
  selector:
    matchLabels:
      app: llm-api
  template:
    metadata:
      labels:
        app: llm-api
    spec:
      containers:
      - name: llm-api
        image: agentshield/llm-api:latest
        ports:
        - containerPort: 8000
        env:
        - name: OLLAMA_BASE_URL
          value: "http://ollama-server:11434"
        - name: LLM_API_HOST
          value: "0.0.0.0"
        livenessProbe:
          httpGet:
            path: /health
            port: 8000
          initialDelaySeconds: 30
          periodSeconds: 10
        resources:
          requests:
            memory: "1Gi"
            cpu: "1"
          limits:
            memory: "2Gi"
            cpu: "2"

---
apiVersion: v1
kind: Service
metadata:
  name: llm-api-service
  namespace: agentshield
spec:
  selector:
    app: llm-api
  ports:
  - port: 8000
    targetPort: 8000
  type: ClusterIP

---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: backend-service
  namespace: agentshield
spec:
  replicas: 3  # Multiple replicas
  selector:
    matchLabels:
      app: backend
  template:
    metadata:
      labels:
        app: backend
    spec:
      containers:
      - name: backend
        image: agentshield/backend:latest
        ports:
        - containerPort: 5000
        env:
        - name: LLM_API_URL
          value: "http://llm-api-service:8000"
        - name: NODE_ENV
          value: "production"
        - name: LOG_LEVEL
          value: "info"
        livenessProbe:
          httpGet:
            path: /health
            port: 5000
          initialDelaySeconds: 15
          periodSeconds: 10
        resources:
          requests:
            memory: "512Mi"
            cpu: "500m"
          limits:
            memory: "1Gi"
            cpu: "1000m"

---
apiVersion: v1
kind: Service
metadata:
  name: backend-service
  namespace: agentshield
spec:
  selector:
    app: backend
  ports:
  - port: 5000
    targetPort: 5000
  type: LoadBalancer
```

**Deploy:**
```bash
kubectl apply -f kubernetes-deployment.yaml

# Check status
kubectl get pods -n agentshield
kubectl get svc -n agentshield

# View logs
kubectl logs -n agentshield deployment/backend-service -f
```

---

## Docker Containerization

### Dockerfile: Python LLM Service

```dockerfile
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements
COPY llm/requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy code
COPY llm/ ./llm/
COPY llm/fastapi_server.py ./

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

EXPOSE 8000

CMD ["python", "-m", "llm.fastapi_server"]
```

### Dockerfile: Node.js Backend

```dockerfile
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY backend/package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy code
COPY backend/src ./src/
COPY backend/tsconfig.json ./

# Compile TypeScript
RUN npm run build

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://localhost:5000/health || exit 1

EXPOSE 5000

CMD ["node", "dist/index.js"]
```

### Docker Compose

```yaml
version: '3.8'

services:
  ollama:
    image: ollama/ollama:latest
    ports:
      - "11434:11434"
    volumes:
      - ollama-data:/root/.ollama
    environment:
      - OLLAMA_MODELS=/root/.ollama/models
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:11434/api/tags"]
      interval: 30s
      timeout: 10s
      retries: 3

  llm-api:
    build:
      context: .
      dockerfile: Dockerfile.llm
    ports:
      - "8000:8000"
    environment:
      OLLAMA_BASE_URL: "http://ollama:11434"
      LLM_API_HOST: "0.0.0.0"
      LOG_LEVEL: "info"
    depends_on:
      - ollama
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  backend:
    build:
      context: .
      dockerfile: Dockerfile.backend
    ports:
      - "5000:5000"
    environment:
      LLM_API_URL: "http://llm-api:8000"
      NODE_ENV: "production"
      LOG_LEVEL: "info"
    depends_on:
      - llm-api
    healthcheck:
      test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost:5000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

volumes:
  ollama-data:
```

**Deploy with Docker Compose:**
```bash
docker-compose up -d

# View logs
docker-compose logs -f

# Stop
docker-compose down
```

---

## Monitoring & Observability

### Prometheus Metrics

Add to backend:
```typescript
import prometheus from 'prom-client';

const decisionCounter = new prometheus.Counter({
  name: 'agentshield_decisions_total',
  help: 'Total decisions by type',
  labelNames: ['decision']
});

const riskScoreHistogram = new prometheus.Histogram({
  name: 'agentshield_risk_score',
  help: 'Risk score distribution',
  buckets: [10, 30, 50, 70, 85, 100]
});

// In your decision logic
decisionCounter.inc({ decision });
riskScoreHistogram.observe(riskScore);

app.get('/metrics', (req, res) => {
  res.set('Content-Type', prometheus.register.contentType);
  res.end(prometheus.register.metrics());
});
```

### Grafana Dashboard

Sample PromQL queries:
```promql
# Decision distribution
rate(agentshield_decisions_total[5m])

# Average risk score
avg(agentshield_risk_score)

# LLM availability
increase(llm_availability[1h])

# Response time percentiles
histogram_quantile(0.95, rate(request_duration_seconds_bucket[5m]))
```

### Alert Rules

```yaml
groups:
- name: agentshield
  rules:
  - alert: HighBlockRate
    expr: rate(agentshield_decisions_total{decision="block"}[5m]) > 0.1
    for: 5m
    annotations:
      summary: "High rate of blocked decisions"

  - alert: LLMServiceDown
    expr: up{job="llm-api"} == 0
    for: 1m
    annotations:
      summary: "LLM API service is down"

  - alert: OllamaUnavailable
    expr: up{job="ollama"} == 0
    for: 1m
    annotations:
      summary: "Ollama server is down"
```

---

## Performance Tuning

### Optimize Ollama

```bash
# Use GPU if available
CUDA_VISIBLE_DEVICES=0 ollama serve

# Increase context window (uses more RAM)
OLLAMA_CONTEXT_SIZE=4096 ollama serve

# Adjust num_predict for latency
# In code: num_predict=128 (shorter responses)
```

### Optimize Node.js

```bash
# Increase file descriptors
ulimit -n 65536

# Node clustering
cluster.fork() for each CPU core

# Run with production flag
NODE_ENV=production node dist/index.js
```

### Optimize Network

- Use HTTP/2 or HTTP/3
- Enable gzip compression
- Cache responses when possible
- Use CDN for static content

---

## Backup & Disaster Recovery

### Backup Ollama Models

```bash
# Backup models directory
tar -czf ollama-models-backup.tar.gz ~/.ollama/models

# Restore
tar -xzf ollama-models-backup.tar.gz -C ~/.ollama/

# Or pull models programmatically
curl http://localhost:11434/api/pull -d '{"name": "qwen2.5:7b"}'
```

### Database Backups

```bash
# SQLite (if using)
cp backend/data/agentshield.db backups/agentshield-$(date +%s).db

# PostgreSQL (if migrating)
pg_dump agentshield | gzip > backup-$(date +%Y%m%d).sql.gz
```

### High Availability Setup

```
        ┌─────────────────┐
        │   Load Balancer │
        └────────┬────────┘
                 │
    ┌────────────┼────────────┐
    │            │            │
    ▼            ▼            ▼
┌───────┐  ┌───────┐  ┌───────┐
│Backend│  │Backend│  │Backend│
└───┬───┘  └───┬───┘  └───┬───┘
    │         │         │
    │    ┌────┼────┐    │
    └────┤ Shared  ├────┘
         │Database │
         └─────────┘
              │
    ┌─────────┴──────────┐
    │                    │
    ▼                    ▼
┌─────────────┐   ┌─────────────┐
│LLM Service 1│   │LLM Service 2│
└─────────────┘   └─────────────┘
```

---

## Security Hardening

### Network Security

```bash
# Only expose necessary ports
- 5000: Backend (behind firewall/VPN)
- 8000: LLM API (behind firewall)
- 11434: Ollama (only localhost)

# Use HTTPS
# Add reverse proxy (Nginx) with SSL certificates
```

### Application Security

```bash
# Environment variables
export JWT_SECRET=$(openssl rand -hex 32)
export API_KEY=$(openssl rand -hex 16)

# Disable debug mode in production
NODE_ENV=production

# Enable security headers
helmet()

# Rate limiting
rateLimit()
```

### Database Security

```bash
# Change default credentials
# Enable authentication
# Use strong passwords
# Regular backups
# Encrypt sensitive data
```

---

## Troubleshooting Deployment

| Issue | Solution |
|-------|----------|
| Services can't connect | Check firewall, verify service addresses |
| High memory usage | Reduce Ollama context size or model size |
| High latency | Use smaller model, add caching, check network |
| OOM errors | Allocate more memory, use smaller model |
| Model not available | Pull model: `ollama pull qwen2.5:7b` |
| Port conflicts | Change ports in env files |
| SSL errors | Update certificates, check expiry |

---

## Post-Deployment

1. **Verify all services are healthy**
   ```bash
   curl http://localhost:5000/health
   curl http://localhost:8000/health
   ```

2. **Run e2e tests**
   ```bash
   npx ts-node e2e-test.ts
   ```

3. **Monitor for 24 hours**
   - Check logs for errors
   - Monitor resource usage
   - Verify decision quality

4. **Collect baseline metrics**
   - Average response time
   - Decision distribution
   - Error rate
   - LLM availability

5. **Document production config**
   - Record chosen thresholds
   - Note performance characteristics
   - Document emergency procedures

---

Good luck with your deployment! 🚀
