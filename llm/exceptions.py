"""
Custom exception types for AgentShield Open-Weight LLM Integration Layer.
"""

class AgentShieldLLMError(Exception):
    """Base exception class for all AgentShield LLM module errors."""
    pass


class OllamaConnectionError(AgentShieldLLMError):
    """Raised when connecting to the Ollama service fails."""
    pass


class OllamaTimeoutError(AgentShieldLLMError):
    """Raised when an HTTP request to Ollama times out."""
    pass


class OllamaModelNotFoundError(AgentShieldLLMError):
    """Raised when the requested Ollama model is not available or not pulled."""
    pass


class LLMResponseParseError(AgentShieldLLMError):
    """Raised when the raw output from Ollama cannot be parsed into JSON."""
    pass


class LLMValidationError(AgentShieldLLMError):
    """Raised when parsed JSON does not satisfy the SecurityAnalysis schema."""
    pass
