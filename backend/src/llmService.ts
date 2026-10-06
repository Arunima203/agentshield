/**
 * llmService.ts
 *
 * Client for calling the Python FastAPI LLM security analyzer.
 * Provides semantic analysis to complement deterministic rule-based scoring.
 */

import axios, { AxiosInstance } from "axios";
import { logger } from "./logger";

const CTX = "LLMService";

export interface LLMSecurityAnalysis {
  risk_score: number | null;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "UNKNOWN";
  decision: "ALLOW" | "REVIEW" | "BLOCK";
  categories: string[];
  reason: string;
  safe_alternative: string | null;
  confidence: number;
  model: string;
  llm_available: boolean;
}

export interface LLMAnalysisRequest {
  tool: string;
  arguments: Record<string, any>;
  agent_id?: string;
  context?: Record<string, any>;
}

/**
 * LLMService wraps the Python FastAPI analyzer.
 * Handles communication, error recovery, and fallback gracefully.
 */
export class LLMService {
  private client: AxiosInstance;
  private baseUrl: string;
  private timeout: number;
  private available: boolean = true;
  private lastErrorTime: number = 0;
  private readonly ERROR_COOLDOWN_MS = 30000; // 30 seconds

  constructor(baseUrl?: string, timeout?: number) {
    this.baseUrl = (baseUrl || process.env.LLM_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
    const configuredTimeout = Number(process.env.LLM_API_TIMEOUT_MS ?? 75000);
    this.timeout = timeout ?? (
      Number.isFinite(configuredTimeout) && configuredTimeout > 0
        ? configuredTimeout
        : 75000
    );

    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: this.timeout,
      headers: {
        "Content-Type": "application/json",
      },
    });

    logger.info(CTX, `Initialized LLMService: ${this.baseUrl}`);
  }

  /**
   * Check if the LLM service is available.
   * Uses cooldown to avoid hammering unreachable service.
   */
  async isAvailable(): Promise<boolean> {
    if (!this.available) {
      const timeSinceError = Date.now() - this.lastErrorTime;
      if (timeSinceError < this.ERROR_COOLDOWN_MS) {
        return false;
      }
    }

    try {
      const response = await this.client.get("/health", { timeout: 5000 });
      this.available = true;
      logger.debug(CTX, "LLM service health check passed");
      return true;
    } catch (error) {
      this.available = false;
      this.lastErrorTime = Date.now();
      logger.warn(
        CTX,
        `LLM service unavailable: ${this.baseUrl}/health - ${error instanceof Error ? error.message : String(error)}`
      );
      return false;
    }
  }

  /**
   * Analyze an agent action using the LLM service.
   * Returns structured security analysis or fallback if unavailable.
   */
  async analyze(request: LLMAnalysisRequest): Promise<LLMSecurityAnalysis> {
    try {
      const isAvailable = await this.isAvailable();
      if (!isAvailable) {
        return this.createFallbackAnalysis(
          "LLM service is currently unavailable",
          request.tool
        );
      }

      logger.debug(
        CTX,
        `Calling LLM analyzer for tool="${request.tool}"`
      );

      const response = await this.client.post<LLMSecurityAnalysis>(
        "/analyze",
        {
          tool: request.tool,
          arguments: request.arguments,
          agent_id: request.agent_id || "default-agent",
          context: request.context || {},
        }
      );

      if (!response.data) {
        return this.createFallbackAnalysis(
          "LLM returned empty response",
          request.tool
        );
      }

      logger.debug(
        CTX,
        `LLM analysis complete: tool="${request.tool}", decision="${response.data.decision}", score=${response.data.risk_score}`
      );

      return response.data;
    } catch (error) {
      this.available = false;
      this.lastErrorTime = Date.now();

      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.warn(CTX, `LLM analysis failed: ${errorMsg}`);

      return this.createFallbackAnalysis(
        `LLM analysis error: ${errorMsg}`,
        request.tool
      );
    }
  }

  /**
   * Get current LLM service status.
   */
  async getStatus(): Promise<Record<string, any>> {
    try {
      const response = await this.client.get("/status", { timeout: 5000 });
      return response.data;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.warn(CTX, `Failed to get LLM status: ${errorMsg}`);
      return {
        available: false,
        error: errorMsg,
        base_url: this.baseUrl,
      };
    }
  }

  /**
   * Create a fallback analysis when LLM is unavailable.
   * Neutral scoring to defer to rule-based system.
   */
  private createFallbackAnalysis(
    reason: string,
    tool: string
  ): LLMSecurityAnalysis {
    return {
      risk_score: null, // null indicates fallback/unavailable
      severity: "UNKNOWN",
      decision: "REVIEW", // Conservative default
      categories: [],
      reason: `[LLM Unavailable] ${reason}`,
      safe_alternative: null,
      confidence: 0.0,
      model: "unavailable",
      llm_available: false,
    };
  }
}

// Export singleton instance
let llmServiceInstance: LLMService | null = null;

export function getLLMService(): LLMService {
  if (!llmServiceInstance) {
    llmServiceInstance = new LLMService();
  }
  return llmServiceInstance;
}

export function setLLMService(service: LLMService): void {
  llmServiceInstance = service;
}
