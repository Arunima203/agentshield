# Nginx Dockerfile
FROM nginx:1.25-alpine

# Install additional tools
RUN apk add --no-cache \
    openssl \
    curl

# Create directories
RUN mkdir -p /etc/nginx/ssl /var/log/nginx

# Copy nginx configuration
COPY nginx/agentshield.conf /etc/nginx/conf.d/default.conf

# Create health check script
RUN echo '#!/bin/sh' > /healthcheck.sh && \
    echo 'curl -f http://localhost/health || exit 1' >> /healthcheck.sh && \
    chmod +x /healthcheck.sh

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD /healthcheck.sh

# Expose ports
EXPOSE 80 443

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
