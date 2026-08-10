#!/usr/bin/env python3
"""Reconcile only SuperMemory-owned Hermes settings on Home 101."""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import shutil
from datetime import datetime, timezone

import yaml


OWNED_ENV = {
    "SUPERMEMORY_ENDPOINT": "http://127.0.0.1:18765",
    "SUPERMEMORY_AGENT_ID": "agent_personal_manager",
    "SUPERMEMORY_AGENT_DEVICE": "device_home101",
    "SUPERMEMORY_AGENT_TOKEN_FILE": "/home/agent/.hermes/supermemory/agent.token",
    "SUPERMEMORY_CAPTURE_SPOOL": "/home/agent/.hermes/supermemory/spool",
}


def backup(path: pathlib.Path, stamp: str) -> None:
    if path.exists():
        shutil.copy2(path, path.with_name(f"{path.name}.pre-supermemory-{stamp}"))


def reconcile_env(path: pathlib.Path) -> None:
    lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    retained = [line for line in lines if line.split("=", 1)[0] not in OWNED_ENV]
    content = retained + [f"{key}={value}" for key, value in OWNED_ENV.items()]
    path.write_text("\n".join(content) + "\n", encoding="utf-8")
    path.chmod(0o600)


def reconcile_config(path: pathlib.Path) -> None:
    with path.open(encoding="utf-8") as stream:
        config = yaml.safe_load(stream) or {}
    model = config.setdefault("model", {})
    model["provider"] = "openai-codex"
    model["default"] = "gpt-5.6-luna"
    config.setdefault("agent", {})["reasoning_effort"] = "high"
    config.setdefault("memory", {})["provider"] = "supermemory-fabric"
    config["fallback_providers"] = []
    temporary = path.with_suffix(".yaml.tmp")
    with temporary.open("w", encoding="utf-8") as stream:
        yaml.safe_dump(config, stream, sort_keys=False, allow_unicode=True)
    temporary.chmod(0o600)
    os.replace(temporary, path)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--hermes-home", default="/home/agent/.hermes")
    args = parser.parse_args()
    home = pathlib.Path(args.hermes_home).resolve()
    config = home / "config.yaml"
    env = home / ".env"
    token = home / "supermemory" / "agent.token"
    if not config.is_file():
        raise SystemExit("home101_hermes_config_missing")
    if not token.is_file() or token.stat().st_mode & 0o077:
        raise SystemExit("home101_agent_token_missing_or_insecure")
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup(config, stamp)
    backup(env, stamp)
    reconcile_env(env)
    reconcile_config(config)
    print(json.dumps({
        "status": "configured",
        "runtime_host": "home101",
        "device_id": "device_home101",
        "memory_provider": "supermemory-fabric",
        "llm_provider": "openai-codex",
        "model": "gpt-5.6-luna",
        "reasoning_effort": "high",
        "fallback_provider": None,
    }))


if __name__ == "__main__":
    main()
