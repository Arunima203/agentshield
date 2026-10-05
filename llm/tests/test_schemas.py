"""
Unit tests for Pydantic schemas in llm/schemas.py.
"""

import pytest
from pydantic import ValidationError

from llm.schemas import (
    AgentAction,
    SecurityAnalysis,
    SecurityDecision,
    SecuritySeverity,
)


def test_agent_action_creation():
    action = AgentAction(
        agent_id="test-agent",
        tool="read_file",
        arguments={"path": "README.md"},
        context={"user_request": "view readme"},
    )
    assert action.agent_id == "test-agent"
    assert action.tool == "read_file"
    assert action.arguments["path"] == "README.md"
    assert action.context["user_request"] == "view readme"


def test_security_analysis_valid():
    analysis = SecurityAnalysis(
        risk_score=95,
        severity=SecuritySeverity.CRITICAL,
        decision=SecurityDecision.BLOCK,
        categories=["destructive_command"],
        reason="Command deletes files forcefully.",
        safe_alternative="Do not delete files.",
        confidence=0.98,
        model="qwen2.5:7b",
        llm_available=True,
    )
    assert analysis.risk_score == 95
    assert analysis.severity == SecuritySeverity.CRITICAL
    assert analysis.decision == SecurityDecision.BLOCK
    assert "destructive_command" in analysis.categories
    assert analysis.confidence == 0.98
    assert analysis.llm_available is True


def test_security_analysis_invalid_risk_score():
    with pytest.raises(ValidationError):
        SecurityAnalysis(
            risk_score=150,  # Invalid: > 100
            severity=SecuritySeverity.HIGH,
            decision=SecurityDecision.BLOCK,
            reason="Invalid score test",
        )


def test_security_analysis_fallback_creation():
    fallback = SecurityAnalysis.create_fallback(
        reason="Model server unreachable.",
        model="qwen2.5:7b",
    )
    assert fallback.risk_score is None
    assert fallback.severity == SecuritySeverity.UNKNOWN
    assert fallback.decision == SecurityDecision.REVIEW
    assert fallback.categories == ["llm_unavailable"]
    assert fallback.reason == "Model server unreachable."
    assert fallback.llm_available is False
    assert fallback.confidence == 0.0
    assert fallback.model == "qwen2.5:7b"
    assert fallback.timestamp is not None
