"""
SecurityAnalyzer module - Core security analysis engine wrapping the Ollama LLM client.
Provides async and sync security analysis for AI agent actions with safe fallback recovery.
"""

import json
import logging
import re
from typing import Any, Dict, Optional

from llm.client import OllamaClient
from llm.config import LLMConfig
from llm.exceptions import AgentShieldLLMError
from llm.prompts import SYSTEM_SECURITY_PROMPT, build_user_prompt
from llm.schemas import (
    SecurityAnalysis,
    SecurityDecision,
    SecuritySeverity,
)

logger = logging.getLogger("agent_shield.llm")


class SecurityAnalyzer:
    """
    Main entry point for AgentShield Open-Weight LLM Security Analysis.
    Evaluates AI agent actions and produces structured risk assessments.
    """

    def __init__(
        self,
        config: Optional[LLMConfig] = None,
        client: Optional[OllamaClient] = None,
    ):
        self.config: LLMConfig = config or LLMConfig()
        self.client: OllamaClient = client or OllamaClient(self.config)

    def get_status(self) -> Dict[str, Any]:
        """Returns the current operational status of the LLM provider."""
        return self.client.get_status()

    async def analyze_action(
        self,
        tool: str,
        arguments: Dict[str, Any],
        agent_id: str = "default-agent",
        context: Optional[Dict[str, Any]] = None,
    ) -> SecurityAnalysis:
        """
        Asynchronously analyze a proposed AI agent action.

        Returns a SecurityAnalysis instance (Pydantic model) that is directly
        serializable to JSON.
        """
        model_name = self.client.model

        # 1. Availability check: Return structured fallback if Ollama is unreachable
        if not await self.client.is_available_async():
            logger.warning(f"Ollama server is unavailable at {self.client.base_url}")
            return SecurityAnalysis.create_fallback(
                reason="The open-weight security model was unavailable.",
                model=model_name,
            )

        user_prompt = build_user_prompt(
            tool=tool,
            arguments=arguments,
            agent_id=agent_id,
            context=context,
        )

        try:
            # 2. Perform inference
            raw_response = await self.client.analyze(
                system_prompt=SYSTEM_SECURITY_PROMPT,
                user_prompt=user_prompt,
                json_format=True,
            )
            # 3. Parse and validate structured output
            return self._parse_and_validate_response(raw_response, model_name)

        except AgentShieldLLMError as e:
            logger.error(f"Ollama execution error: {e}")
            return SecurityAnalysis.create_fallback(
                reason=f"LLM inference error: {str(e)}",
                model=model_name,
            )
        except Exception as e:
            logger.exception(f"Unexpected error during security analysis: {e}")
            return SecurityAnalysis.create_fallback(
                reason="Unexpected error during LLM security analysis.",
                model=model_name,
            )

    def analyze_action_sync(
        self,
        tool: str,
        arguments: Dict[str, Any],
        agent_id: str = "default-agent",
        context: Optional[Dict[str, Any]] = None,
    ) -> SecurityAnalysis:
        """
        Synchronously analyze a proposed AI agent action.
        """
        model_name = self.client.model

        if not self.client.is_available():
            logger.warning(f"Ollama server is unavailable at {self.client.base_url}")
            return SecurityAnalysis.create_fallback(
                reason="The open-weight security model was unavailable.",
                model=model_name,
            )

        user_prompt = build_user_prompt(
            tool=tool,
            arguments=arguments,
            agent_id=agent_id,
            context=context,
        )

        try:
            raw_response = self.client.generate(
                prompt=user_prompt,
                system=SYSTEM_SECURITY_PROMPT,
                json_format=True,
            )
            return self._parse_and_validate_response(raw_response, model_name)

        except Exception as e:
            logger.error(f"Sync security analysis error: {e}")
            return SecurityAnalysis.create_fallback(
                reason=f"LLM sync analysis error: {str(e)}",
                model=model_name,
            )

    def _parse_and_validate_response(
        self, raw_response: str, model_name: str
    ) -> SecurityAnalysis:
        """
        Safely extracts JSON from model raw response string and converts to SecurityAnalysis.
        Attempts recovery on slightly malformed responses.
        """
        parsed_data = self._extract_json(raw_response)

        if not parsed_data or not isinstance(parsed_data, dict):
            logger.warning("Failed to extract valid JSON dictionary from LLM response.")
            return SecurityAnalysis.create_fallback(
                reason="The open-weight security model returned malformed output.",
                model=model_name,
                categories=["malformed_llm_output"],
            )

        # Sanitize / normalize keys if necessary
        raw_score = parsed_data.get("risk_score")
        try:
            risk_score = int(raw_score) if raw_score is not None else None
            if risk_score is not None:
                risk_score = max(0, min(100, risk_score))
        except (ValueError, TypeError):
            risk_score = None

        raw_severity = str(parsed_data.get("severity", "")).upper()
        raw_decision = str(parsed_data.get("decision", "")).upper()

        # Enforce consistency based on decision matrix if model score exists
        if risk_score is not None:
            if risk_score >= 85:
                severity = SecuritySeverity.CRITICAL
                decision = SecurityDecision.BLOCK
            elif risk_score >= 60:
                severity = SecuritySeverity.HIGH
                decision = SecurityDecision.REVIEW
            elif risk_score >= 30:
                severity = SecuritySeverity.MEDIUM
                decision = SecurityDecision.REVIEW
            else:
                severity = SecuritySeverity.LOW
                decision = SecurityDecision.ALLOW
        else:
            # Map severity
            try:
                severity = SecuritySeverity(raw_severity)
            except ValueError:
                severity = SecuritySeverity.UNKNOWN

            # Map decision
            try:
                decision = SecurityDecision(raw_decision)
            except ValueError:
                decision = SecurityDecision.REVIEW

        categories = parsed_data.get("categories", [])
        if not isinstance(categories, list):
            categories = [str(categories)] if categories else []
        categories = [str(c) for c in categories]

        reason = str(parsed_data.get("reason") or "Analysis completed.")
        safe_alt = parsed_data.get("safe_alternative")
        safe_alt = str(safe_alt) if safe_alt is not None else None

        raw_conf = parsed_data.get("confidence", 1.0)
        try:
            confidence = float(raw_conf)
            confidence = max(0.0, min(1.0, confidence))
        except (ValueError, TypeError):
            confidence = 1.0

        try:
            return SecurityAnalysis(
                risk_score=risk_score,
                severity=severity,
                decision=decision,
                categories=categories,
                reason=reason,
                safe_alternative=safe_alt,
                confidence=confidence,
                model=model_name,
                llm_available=True,
            )
        except Exception as err:
            logger.warning(f"Schema validation error on parsed dict: {err}")
            return SecurityAnalysis.create_fallback(
                reason="Security evaluation schema validation failed.",
                model=model_name,
            )

    def _extract_json(self, text: str) -> Optional[Dict[str, Any]]:
        """Extracts JSON dict from raw string, handling markdown wrappers or leading/trailing text."""
        if not text:
            return None

        text = text.strip()

        # 1. Try direct JSON load
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            pass

        # 2. Try removing markdown ```json ... ``` tags
        markdown_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
        if markdown_match:
            try:
                return json.loads(markdown_match.group(1))
            except json.JSONDecodeError:
                pass

        # 3. Try finding first '{' and last '}'
        start_idx = text.find("{")
        end_idx = text.rfind("}")
        if start_idx != -1 and end_idx != -1 and end_idx > start_idx:
            substring = text[start_idx : end_idx + 1]
            try:
                return json.loads(substring)
            except json.JSONDecodeError:
                pass

        return None
