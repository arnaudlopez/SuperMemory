"""Small async HTTP client for supermemoryd's Personal Manager boundary."""

import asyncio
import json
import urllib.error
import urllib.parse
import urllib.request


class SuperMemoryClient:
    def __init__(self, endpoint, *, agent_id, device_id, token, timeout=15):
        parsed = urllib.parse.urlparse(endpoint)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError("supermemory_endpoint_invalid")
        if parsed.scheme == "http" and parsed.hostname not in {"127.0.0.1", "localhost", "::1"}:
            raise ValueError("supermemory_plaintext_endpoint_forbidden")
        self.endpoint = endpoint.rstrip("/")
        self.agent_id = agent_id
        self.device_id = device_id
        self.token = token
        self.timeout = timeout

    async def request(self, method, path, payload=None):
        return await asyncio.to_thread(self._request, method, path, payload)

    def _request(self, method, path, payload):
        data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
        request = urllib.request.Request(
            f"{self.endpoint}{path}",
            data=data,
            method=method,
            headers={
                "content-type": "application/json",
                "x-supermemory-agent-id": self.agent_id,
                "x-supermemory-agent-device": self.device_id,
                "x-supermemory-agent-token": self.token,
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            try:
                detail = json.loads(error.read().decode("utf-8")).get("error")
            except Exception:
                detail = None
            raise RuntimeError(detail or f"supermemory_http_{error.code}") from error
