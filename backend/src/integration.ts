/**
 * integration.ts
 *
 * Complete system integration layer.
 * Brings together all architecture components for a cohesive production system.
 */

import express, { Express, Request, Response } from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import cors from 'cors';
import { logger } from './logger';
import { healthChecker } from './healthCheck';
import { getMetrics, getMetricsContentType, updateSystemHealth, recordInspection } from './monitoring';
import { authenticate, authorize, requireRole, auditLog, requestLoggingMiddleware } from './middleware/authorization';
import { inspect } from './interceptor';
import { tracingService, structuredLogger, requestLoggingMiddleware as tracingMiddleware } from './tracing';
import { backupManager, scheduleBackups } from './backup';
import { getLLMService } from './llmService';

const CTX = 'Integration';

/**
 * System configuration
 */
export interface SystemConfig {
  port: number;
  environment: 'development' | 'production' | 'staging';
  enableMetrics: boolean;
  enableTracing: boolean;
  enableBackups: boolean;
  backupInterval: number; // minutes
  backupRetention: number; // days
  corsOrigins?: string[];
}

/**
 * System health status
 */
export interface SystemStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  version: string;
  components: Record<string, any>;
  metrics: Record<string, any>;
}

class SystemIntegration {
  private app: Express | null = null;
  private startTime = Date.now();
  private config: SystemConfig;

  constructor(config: Partial<SystemConfig> = {}) {
    this.config = {
      port: config.port || parseInt(process.env.PORT || '5000'),
      environment: (config.environment || process.env.NODE_ENV || 'development') as any,
      enableMetrics: config.enableMetrics !== false,
      enableTracing: config.enableTracing !== false,
      enableBackups: config.enableBackups !== false,
      backupInterval: config.backupInterval || 60,
      backupRetention: config.backupRetention || 30,
      corsOrigins: config.corsOrigins,
    };

    logger.info(CTX, `System configuration initialized: ${JSON.stringify(this.config)}`);
  }

  /**
   * Initialize and configure the Express app
   */
  initializeApp(): Express {
    this.app = express();

    // Security middleware
    this.app.use(helmet());
    this.app.use(cors({
      origin: this.config.corsOrigins || '*',
      credentials: true,
    }));

    // Tracing middleware (before other middleware)
    if (this.config.enableTracing) {
      this.app.use(tracingMiddleware);
    }

    // Request logging
    this.app.use(
      morgan(
        this.config.environment === 'production'
          ? 'combined'
          : 'dev'
      )
    );

    // Body parsers
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ limit: '10mb', extended: true }));

    logger.info(CTX, 'Express app initialized');
    return this.app;
  }

  /**
   * Setup authentication and authorization
   */
  setupAuthentication(app: Express): void {
    // Health and status endpoints (public)
    app.get('/health', this.handleHealth.bind(this));
    app.get('/live', this.handleLive.bind(this));
    app.get('/ready', this.handleReady.bind(this));
    app.get('/status', this.handleStatus.bind(this));

    // Metrics endpoint (restricted)
    app.get('/metrics', authenticate, authorize('monitoring:read'), this.handleMetrics.bind(this));

    // Public endpoints
    app.post('/auth/login', this.handleLogin.bind(this));
    app.post('/auth/logout', this.handleLogout.bind(this));

    // Protected endpoints
    app.post(
      '/inspect',
      authenticate,
      authorize('inspect:write'),
      auditLog('inspect_request'),
      this.handleInspect.bind(this)
    );

    app.get(
      '/audit',
      authenticate,
      authorize('audit:read'),
      this.handleAuditLog.bind(this)
    );

    app.get(
      '/approvals',
      authenticate,
      authorize('approvals:read'),
      this.handleApprovals.bind(this)
    );

    app.post(
      '/approvals/:id/approve',
      authenticate,
      authorize('approvals:write'),
      auditLog('approval_decision'),
      this.handleApproveRequest.bind(this)
    );

    app.post(
      '/approvals/:id/reject',
      authenticate,
      authorize('approvals:write'),
      auditLog('approval_rejection'),
      this.handleRejectRequest.bind(this)
    );

    // Admin endpoints
    app.get(
      '/config',
      authenticate,
      requireRole('admin'),
      this.handleGetConfig.bind(this)
    );

    app.put(
      '/config',
      authenticate,
      requireRole('admin'),
      auditLog('config_update'),
      this.handleSetConfig.bind(this)
    );

    logger.info(CTX, 'Authentication and authorization configured');
  }

  /**
   * Setup health checks
   */
  setupHealthChecks(app: Express): void {
    // Periodic health check updates
    setInterval(async () => {
      try {
        const health = await healthChecker.checkSystemHealth();
        const healthScore = (health.summary.healthy / Object.keys(health.components).length) * 100;
        updateSystemHealth(healthScore);
      } catch (error) {
        logger.warn(CTX, `Health check failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }, 30000); // Every 30 seconds

    logger.info(CTX, 'Health checks configured');
  }

  /**
   * Setup backups
   */
  setupBackups(): void {
    if (!this.config.enableBackups) {
      logger.info(CTX, 'Backups disabled');
      return;
    }

    const dbPath = 'backend/data/agentshield.db';
    scheduleBackups(dbPath, this.config.backupInterval, this.config.backupRetention);

    logger.info(CTX, 'Backup scheduling configured');
  }

  /**
   * Handler: /health (simple health check)
   */
  private async handleHealth(req: Request, res: Response): Promise<void> {
    const health = await healthChecker.checkSystemHealth();
    const statusCode = health.status === 'healthy' ? 200 : health.status === 'degraded' ? 202 : 503;

    res.status(statusCode).json(health);
  }

  /**
   * Handler: /live (liveness probe)
   */
  private handleLive(req: Request, res: Response): void {
    res.json({ status: 'alive' });
  }

  /**
   * Handler: /ready (readiness probe)
   */
  private async handleReady(req: Request, res: Response): Promise<void> {
    const isReady = await healthChecker.isReady();
    res.status(isReady ? 200 : 503).json({ ready: isReady });
  }

  /**
   * Handler: /status (full system status)
   */
  private async handleStatus(req: Request, res: Response): Promise<void> {
    const uptime = Date.now() - this.startTime;
    const health = await healthChecker.checkSystemHealth();
    const backupStats = backupManager.getBackupStats();

    const status: SystemStatus = {
      status: health.status,
      timestamp: new Date().toISOString(),
      uptime,
      version: '1.0.0',
      components: health.components,
      metrics: {
        backups: backupStats,
        llm: await getLLMService().getStatus(),
      },
    };

    res.json(status);
  }

  /**
   * Handler: /metrics (Prometheus metrics)
   */
  private handleMetrics(req: Request, res: Response): void {
    res.set('Content-Type', getMetricsContentType());
    res.send(getMetrics());
  }

  /**
   * Handler: /auth/login
   */
  private handleLogin(req: Request, res: Response): void {
    // Implement authentication logic
    res.json({ token: 'mock-jwt-token' });
  }

  /**
   * Handler: /auth/logout
   */
  private handleLogout(req: Request, res: Response): void {
    res.json({ message: 'Logged out' });
  }

  /**
   * Handler: POST /inspect
   */
  private async handleInspect(req: Request, res: Response): Promise<void> {
    try {
      const traceContext = tracingService.createTraceContext(
        (req as any).user?.id,
        req.body?.agentId,
        req.body?.sessionId
      );
      tracingService.pushTraceContext(traceContext);

      const startTime = Date.now();
      const result = await inspect(req.body);
      const duration = Date.now() - startTime;

      recordInspection(
        result.decision,
        result.riskScore,
        result.riskScore, // simplified
        result.llmAnalysis?.risk_score || null,
        result.riskFindings?.length || 0,
        duration
      );

      tracingService.popTraceContext();
      res.json(result);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(CTX, `Inspect failed: ${errorMsg}`);
      res.status(500).json({ error: errorMsg });
    }
  }

  /**
   * Handler: GET /audit
   */
  private handleAuditLog(req: Request, res: Response): void {
    // Return audit logs (stub)
    res.json({ logs: [] });
  }

  /**
   * Handler: GET /approvals
   */
  private handleApprovals(req: Request, res: Response): void {
    // Return pending approvals (stub)
    res.json({ approvals: [] });
  }

  /**
   * Handler: POST /approvals/:id/approve
   */
  private handleApproveRequest(req: Request, res: Response): void {
    res.json({ message: 'Approval recorded' });
  }

  /**
   * Handler: POST /approvals/:id/reject
   */
  private handleRejectRequest(req: Request, res: Response): void {
    res.json({ message: 'Rejection recorded' });
  }

  /**
   * Handler: GET /config
   */
  private handleGetConfig(req: Request, res: Response): void {
    res.json({ config: this.config });
  }

  /**
   * Handler: PUT /config
   */
  private handleSetConfig(req: Request, res: Response): void {
    res.json({ message: 'Config updated' });
  }

  /**
   * Start the integrated system
   */
  async start(): Promise<void> {
    try {
      // Initialize app
      const app = this.initializeApp();

      // Setup all components
      this.setupAuthentication(app);
      this.setupHealthChecks(app);
      this.setupBackups();

      // Start server
      const server = app.listen(this.config.port, () => {
        logger.info(CTX, `🚀 AgentShield system started on port ${this.config.port}`);
        logger.info(CTX, `📊 Monitoring enabled: ${this.config.enableMetrics}`);
        logger.info(CTX, `🔍 Tracing enabled: ${this.config.enableTracing}`);
        logger.info(CTX, `💾 Backups enabled: ${this.config.enableBackups}`);
        logger.info(CTX, `🌍 Environment: ${this.config.environment}`);
      });

      // Graceful shutdown
      process.on('SIGTERM', () => {
        logger.info(CTX, 'SIGTERM received, shutting down gracefully...');
        server.close(() => {
          logger.info(CTX, 'Server closed');
          process.exit(0);
        });
      });

      process.on('SIGINT', () => {
        logger.info(CTX, 'SIGINT received, shutting down gracefully...');
        server.close(() => {
          logger.info(CTX, 'Server closed');
          process.exit(0);
        });
      });
    } catch (error) {
      logger.error(CTX, `Failed to start system: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  }
}

export const systemIntegration = new SystemIntegration();
