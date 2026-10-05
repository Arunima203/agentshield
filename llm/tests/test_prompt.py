"""
Unit tests for Security System Prompt and User Prompt formatting.
"""

from llm.prompts import SYSTEM_SECURITY_PROMPT, build_user_prompt


def test_system_prompt_content():
    assert "AgentShield" in SYSTEM_SECURITY_PROMPT
    assert "prompt injection" in SYSTEM_SECURITY_PROMPT
    assert "destructive commands" in SYSTEM_SECURITY_PROMPT
    assert "CRITICAL SECURITY DIRECTIVES" in SYSTEM_SECURITY_PROMPT
    assert "UNTRUSTED DATA" in SYSTEM_SECURITY_PROMPT
    assert "risk_score" in SYSTEM_SECURITY_PROMPT


def test_build_user_prompt_formatting():
    prompt = build_user_prompt(
        tool="execute_command",
        arguments={"command": "rm -rf ./src"},
        agent_id="dev-agent",
        context={"user_request": "clean repository"},
    )
    assert "[PROPOSED AGENT ACTION FOR SECURITY EVALUATION]" in prompt
    assert "dev-agent" in prompt
    assert "execute_command" in prompt
    assert "rm -rf ./src" in prompt
    assert "clean repository" in prompt
    assert "[END PROPOSED AGENT ACTION]" in prompt
