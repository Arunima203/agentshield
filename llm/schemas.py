"""
Pydantic data schemas for AgentShield Open-Weight LLM Integration Layer.
"""

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field, field_validator, model_validator


class SecuritySeverity(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"
    UNKNOWN = "UNKNOWN"


class SecurityDecision(str, Enum):
    ALLOW = "ALLOW"
    REVIEW = "REVIEW"
    BLOCK = "BLOCK"


STANDARD_SECURITY_CATEGORIES = [
    "prompt_injection",
    "instruction_override",
    "destructive_command",
    "filesystem_destruction",
    "secret_access",
    "credential_exposure",
    "data_exfiltration",
    "network_access",
    "privilege_escalation",
    "tool_abuse",
    "unsafe_url",
    "suspicious_behavior",
    "unknown_tool",
    "excessive_permissions",
    "malicious_instruction",
    "llm_unavailable",
]


class AgentAction(BaseModel):
    """Input payload representing a proposed action requested by an AI agent."""
    agent_id: str = Field(default="default-agent", description="Identifier of the requesting agent")
    tool: str = Field(..., description="Name of the tool the agent is attempting to execute")
    arguments: Dict[str, Any] = Field(default_factory=dict, description="Arguments passed to the tool")
    context: Optional[Dict[str, Any]] = Field(default=None, description="Optional request context (e.g. user prompt)")


class SecurityAnalysis(BaseModel):
    """Structured security risk evaluation returned by the Open-Weight LLM layer."""

    risk_score: Optional[int] = Field(
        default=None,
        description="Risk score from 0 to 100, or None if evaluation failed/offline"
    )
    severity: SecuritySeverity = Field(
        ...,
        description="Severity level: LOW, MEDIUM, HIGH, CRITICAL, or UNKNOWN"
    )
    decision: SecurityDecision = Field(
        ...,
        description="Recommended action decision: ALLOW, REVIEW, or BLOCK"
    )
    categories: List[str] = Field(
        default_factory=list,
        description="Identified threat or security risk categories"
    )
    reason: str = Field(
        ...,
        description="Detailed natural-language justification for the risk assessment"
    )
    safe_alternative: Optional[str] = Field(
        default=None,
        description="Suggested safer alternative action or mitigation"
    )
    confidence: float = Field(
        default=1.0,
        ge=0.0,
        le=1.0,
        description="LLM confidence score between 0.0 and 1.0"
    )
    model: str = Field(
        default="unknown",
        description="Model name used for inference"
    )
    llm_available: bool = Field(
        default=True,
        description="Whether the LLM runtime was reachable and processed the request"
    )
    timestamp: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat(),
        description="ISO-8601 UTC timestamp of the analysis"
    )

    @field_validator("risk_score")
    @classmethod
    def validate_risk_score(cls, v: Optional[int]) -> Optional[int]:
        if v is not None:
            if not isinstance(v, int) or v < 0 or v > 100:
                raise ValueError("risk_score must be an integer between 0 and 100")
        return v

    @field_validator("confidence")
    @classmethod
    def validate_confidence(cls, v: float) -> float:
        if not (0.0 <= v <= 1.0):
            return max(0.0, min(1.0, float(v)))
        return v

    @classmethod
    def create_fallback(
        cls,
        reason: str = "The open-weight security model was unavailable.",
        model: str = "qwen2.5:7b",
        categories: Optional[List[str]] = None,
        safe_alternative: Optional[str] = "Route the action through deterministic security policies.",
    ) -> "SecurityAnalysis":
        """
        Creates a structured safe fallback when the LLM service is offline, times out,
        or returns unparseable/invalid output.
        """
        return cls(
            risk_score=None,
            severity=SecuritySeverity.UNKNOWN,
            decision=SecurityDecision.REVIEW,
            categories=categories or ["llm_unavailable"],
            reason=reason,
            safe_alternative=safe_alternative,
            confidence=0.0,
            model=model,
            llm_available=False,
            timestamp=datetime.now(timezone.utc).isoformat(),
        )
