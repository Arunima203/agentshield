"""
Configuration settings for AgentShield Open-Weight LLM Integration Layer.
"""

import os
from typing import Optional
from dotenv import load_dotenv

# Automatically load environment variables from .env if present
load_dotenv()

class LLMConfig:
    """
    Configuration for Ollama inference runtime and LLM security parameters.
    Allows runtime configuration via environment variables or direct instantiation.
    """

    def __init__(
        self,
        base_url: Optional[str] = None,
        model: Optional[str] = None,
        timeout: Optional[float] = None,
        temperature: Optional[float] = None,
    ):
        self.base_url: str = (
            base_url
            or os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
        ).rstrip("/")

        self.model: str = (
            model
            or os.getenv("OLLAMA_MODEL", "qwen2.5:7b")
        )

        env_timeout = os.getenv("OLLAMA_TIMEOUT", "60")
        try:
            self.timeout: float = float(timeout if timeout is not None else env_timeout)
        except ValueError:
            self.timeout = 60.0

        env_temp = os.getenv("LLM_TEMPERATURE", "0")
        try:
            self.temperature: float = float(temperature if temperature is not None else env_temp)
        except ValueError:
            self.temperature = 0.0

    def to_dict(self) -> dict:
        return {
            "base_url": self.base_url,
            "model": self.model,
            "timeout": self.timeout,
            "temperature": self.temperature,
        }

    def __repr__(self) -> str:
        return (
            f"LLMConfig(base_url={self.base_url!r}, model={self.model!r}, "
            f"timeout={self.timeout}, temperature={self.temperature})"
        )
