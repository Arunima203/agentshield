"""
Ollama Client implementation for AgentShield Open-Weight LLM Integration Layer.
Handles HTTP communication, timeouts, connection checks, and error mapping.
"""

from typing import Any, Dict, List, Optional
import httpx

from llm.config import LLMConfig
from llm.exceptions import (
    AgentShieldLLMError,
    OllamaConnectionError,
    OllamaTimeoutError,
    OllamaModelNotFoundError,
)


class OllamaClient:
    """
    Client for interacting with local Ollama inference service.
    Decoupled from security analysis logic.
    """

    def __init__(self, config: Optional[LLMConfig] = None):
        self.config: LLMConfig = config or LLMConfig()

    @property
    def base_url(self) -> str:
        return self.config.base_url

    @property
    def model(self) -> str:
        return self.config.model

    @model.setter
    def model(self, new_model: str) -> None:
        self.config.model = new_model

    @property
    def timeout(self) -> float:
        return self.config.timeout

    def is_available(self) -> bool:
        """Synchronously check if Ollama server is reachable."""
        try:
            with httpx.Client(timeout=3.0) as client:
                res = client.get(f"{self.base_url}/")
                return res.status_code == 200
        except Exception:
            return False

    async def is_available_async(self) -> bool:
        """Asynchronously check if Ollama server is reachable."""
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                res = await client.get(f"{self.base_url}/")
                return res.status_code == 200
        except Exception:
            return False

    def list_models(self) -> List[str]:
        """List available model names installed in Ollama."""
        try:
            with httpx.Client(timeout=self.timeout) as client:
                res = client.get(f"{self.base_url}/api/tags")
                res.raise_for_status()
                data = res.json()
                return [m.get("name", "") for m in data.get("models", [])]
        except Exception as e:
            self._handle_http_error(e)
            return []

    async def list_models_async(self) -> List[str]:
        """Asynchronously list available model names installed in Ollama."""
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                res = await client.get(f"{self.base_url}/api/tags")
                res.raise_for_status()
                data = res.json()
                return [m.get("name", "") for m in data.get("models", [])]
        except Exception as e:
            self._handle_http_error(e)
            return []

    def get_status(self) -> Dict[str, Any]:
        """Return simple provider status dict."""
        available = self.is_available()
        return {
            "provider": "ollama",
            "model": self.model,
            "available": available,
        }

    def generate(
        self,
        prompt: str,
        system: Optional[str] = None,
        json_format: bool = True,
    ) -> str:
        """
        Synchronously generate text or JSON output from Ollama using /api/generate or /api/chat.
        """
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        payload = {
            "model": self.model,
            "messages": messages,
            "stream": False,
            "options": {
                "temperature": self.config.temperature,
            },
        }
        if json_format:
            payload["format"] = "json"

        try:
            with httpx.Client(timeout=self.timeout) as client:
                res = client.post(f"{self.base_url}/api/chat", json=payload)
                if res.status_code == 404:
                    raise OllamaModelNotFoundError(
                        f"Model '{self.model}' was not found on Ollama server at {self.base_url}."
                    )
                res.raise_for_status()
                data = res.json()
                message_content = data.get("message", {}).get("content", "")
                if not message_content:
                    # Fallback check for /api/generate format
                    message_content = data.get("response", "")
                return message_content
        except Exception as e:
            self._handle_http_error(e)
            raise

    async def analyze(
        self,
        system_prompt: str,
        user_prompt: str,
        json_format: bool = True,
    ) -> str:
        """
        Asynchronously send security analysis prompts to Ollama.
        """
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]

        payload = {
            "model": self.model,
            "messages": messages,
            "stream": False,
            "options": {
                "temperature": self.config.temperature,
            },
        }
        if json_format:
            payload["format"] = "json"

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                res = await client.post(f"{self.base_url}/api/chat", json=payload)
                if res.status_code == 404:
                    raise OllamaModelNotFoundError(
                        f"Model '{self.model}' was not found on Ollama server at {self.base_url}."
                    )
                res.raise_for_status()
                data = res.json()
                message_content = data.get("message", {}).get("content", "")
                if not message_content:
                    message_content = data.get("response", "")
                return message_content
        except Exception as e:
            self._handle_http_error(e)
            raise

    def _handle_http_error(self, e: Exception) -> None:
        if isinstance(e, (OllamaConnectionError, OllamaTimeoutError, OllamaModelNotFoundError)):
            return
        if isinstance(e, httpx.TimeoutException):
            raise OllamaTimeoutError(f"Request to Ollama timed out after {self.timeout}s: {e}") from e
        if isinstance(e, (httpx.ConnectError, httpx.NetworkError)):
            raise OllamaConnectionError(f"Failed to connect to Ollama at {self.base_url}: {e}") from e
        if isinstance(e, httpx.HTTPStatusError):
            if e.response.status_code == 404:
                raise OllamaModelNotFoundError(f"Ollama resource or model '{self.model}' not found: {e}") from e
            raise AgentShieldLLMError(f"Ollama HTTP error {e.response.status_code}: {e}") from e
        raise AgentShieldLLMError(f"Unexpected error communicating with Ollama: {e}") from e
