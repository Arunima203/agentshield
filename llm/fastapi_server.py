"""
FastAPI server wrapper for AgentShield SecurityAnalyzer.
Exposes the LLM security analysis engine via REST API.

Usage:
    pip install fastapi uvicorn
    python -m llm.fastapi_server
"""

import asyncio
import json
import logging
import os
from typing import Any, Dict, Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import uvicorn

from llm.security_analyzer import SecurityAnalyzer
from llm.config import LLMConfig
from llm.schemas import SecurityAnalysis

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger("agent_shield.fastapi")

# Initialize FastAPI app
app = FastAPI(
    title="AgentShield LLM Security Analyzer",
    description="REST API for LLM-based security analysis of AI agent actions",
    version="1.0.0"
)

# Add CORS middleware for backend communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:5000",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001",
        "http://127.0.0.1:5000",
        os.getenv("BACKEND_URL", "http://localhost:5000"),
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global analyzer instance
analyzer: Optional[SecurityAnalyzer] = None


def get_analyzer() -> SecurityAnalyzer:
    """Get or initialize the SecurityAnalyzer singleton."""
    global analyzer
    if analyzer is None:
        config = LLMConfig()
        analyzer = SecurityAnalyzer(config=config)
        logger.info(f"Initialized SecurityAnalyzer with config: {config}")
    return analyzer


@app.on_event("startup")
async def startup_event():
    """Initialize analyzer and check Ollama availability on startup."""
    analyzer = get_analyzer()
    status = analyzer.get_status()
    logger.info(f"SecurityAnalyzer status: {status}")
    if status.get("available", False):
        logger.info(f"✓ Ollama is available at {status.get('base_url')}")
        logger.info(f"  Model: {status.get('model')}")
    else:
        logger.warning(
            f"✗ Ollama is NOT available at {status.get('base_url')} - "
            f"LLM analysis will use fallback scoring"
        )


@app.get("/health")
async def health_check() -> Dict[str, Any]:
    """Health check endpoint."""
    analyzer = get_analyzer()
    status = analyzer.get_status()
    return {
        "status": "healthy" if status.get("available") else "degraded",
        "llm": status,
    }


@app.post("/analyze")
async def analyze_action(request: Request) -> Dict[str, Any]:
    """
    Analyze a proposed AI agent action for security risks.
    
    Expected JSON body:
    {
        "tool": "string (tool name)",
        "arguments": "dict (tool arguments)",
        "agent_id": "string (optional, default: 'default-agent')",
        "context": "dict (optional, additional context)"
    }
    
    Returns: SecurityAnalysis JSON
    """
    try:
        body = await request.json()
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"Invalid JSON: {str(e)}")

    # Validate required fields
    if "tool" not in body:
        raise HTTPException(status_code=400, detail="Missing required field: 'tool'")
    if "arguments" not in body:
        raise HTTPException(status_code=400, detail="Missing required field: 'arguments'")

    tool = body.get("tool")
    arguments = body.get("arguments")
    agent_id = body.get("agent_id", "default-agent")
    context = body.get("context", {})

    logger.info(
        f"Analyzing action: tool={tool}, agent_id={agent_id}"
    )

    try:
        analyzer = get_analyzer()
        analysis: SecurityAnalysis = await analyzer.analyze_action(
            tool=tool,
            arguments=arguments,
            agent_id=agent_id,
            context=context,
        )
        logger.info(
            f"Analysis complete: tool={tool}, decision={analysis.decision}, "
            f"score={analysis.risk_score}, severity={analysis.severity}"
        )
        return analysis.dict()
    except Exception as e:
        logger.exception(f"Error during analysis: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Analysis error: {str(e)}"
        )


@app.post("/analyze-sync")
async def analyze_action_sync(request: Request) -> Dict[str, Any]:
    """
    Synchronously analyze a proposed AI agent action (blocking).
    Same request/response format as /analyze endpoint.
    """
    try:
        body = await request.json()
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"Invalid JSON: {str(e)}")

    if "tool" not in body or "arguments" not in body:
        raise HTTPException(
            status_code=400,
            detail="Missing required fields: 'tool' and 'arguments'"
        )

    tool = body.get("tool")
    arguments = body.get("arguments")
    agent_id = body.get("agent_id", "default-agent")
    context = body.get("context", {})

    logger.info(f"Analyzing action (sync): tool={tool}, agent_id={agent_id}")

    try:
        analyzer = get_analyzer()
        analysis: SecurityAnalysis = analyzer.analyze_action_sync(
            tool=tool,
            arguments=arguments,
            agent_id=agent_id,
            context=context,
        )
        logger.info(
            f"Sync analysis complete: tool={tool}, decision={analysis.decision}, "
            f"score={analysis.risk_score}"
        )
        return analysis.dict()
    except Exception as e:
        logger.exception(f"Error during sync analysis: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Analysis error: {str(e)}"
        )


@app.get("/status")
async def get_status() -> Dict[str, Any]:
    """Get current LLM configuration and status."""
    analyzer = get_analyzer()
    return {
        "analyzer": {
            "model": analyzer.client.model,
            "base_url": analyzer.client.base_url,
            "config": analyzer.config.to_dict(),
        },
        "llm_status": analyzer.get_status(),
    }


@app.get("/")
async def root() -> Dict[str, str]:
    """Root endpoint with API documentation link."""
    return {
        "message": "AgentShield LLM Security Analyzer API",
        "docs": "/docs",
        "health": "/health",
        "endpoints": {
            "POST /analyze": "Analyze action (async)",
            "POST /analyze-sync": "Analyze action (sync/blocking)",
            "GET /health": "Health check",
            "GET /status": "Get LLM status and config",
        }
    }


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    """Custom HTTP exception handler."""
    logger.error(f"HTTP {exc.status_code}: {exc.detail}")
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": exc.detail, "status_code": exc.status_code},
    )


@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    """Generic exception handler for unexpected errors."""
    logger.exception(f"Unexpected error: {exc}")
    return JSONResponse(
        status_code=500,
        content={"error": "Internal server error", "detail": str(exc)},
    )


def main():
    """Run the FastAPI server."""
    port = int(os.getenv("LLM_API_PORT", "8000"))
    host = os.getenv("LLM_API_HOST", "127.0.0.1")
    
    logger.info(f"Starting AgentShield LLM API server on {host}:{port}")
    logger.info("OpenAPI docs available at http://{}:{}/docs".format(host, port))
    
    uvicorn.run(
        app,
        host=host,
        port=port,
        log_level="info",
    )


if __name__ == "__main__":
    main()
