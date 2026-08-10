"""Tool schemas and command builders for the governed SuperMemory API."""

import hashlib
import hmac
import json
import uuid


TOOL_NAMES = [
    "pm_recall", "pm_get", "pm_lineage", "pm_pin", "pm_unpin",
    "pm_add", "pm_update", "pm_resolve", "pm_supersede", "pm_forget",
]


def tool_schemas():
    common_scope = {"scope_kind": {"enum": ["owner", "project"]}, "project_id": {"type": "string"}}
    return [
        {
            "name": "pm_recall",
            "description": "Recall cited personal memory across an authorized scope.",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string"}, "mode": {"enum": ["auto", "project", "portfolio", "historical"]}, **common_scope},
                "required": ["query"],
            },
        },
        {
            "name": "pm_get",
            "description": "Read one memory and optionally a historical revision.",
            "parameters": {"type": "object", "properties": {"memory_id": {"type": "string"}, "as_of": {"type": "string"}}, "required": ["memory_id"]},
        },
        {
            "name": "pm_lineage",
            "description": "Explain why a memory was retained using its cited episodes, evidence and revisions.",
            "parameters": {"type": "object", "properties": {"memory_id": {"type": "string"}}, "required": ["memory_id"]},
        },
        *[
            {
                "name": name,
                "description": f"Governed {name.removeprefix('pm_')} of an existing canonical memory.",
                "parameters": {"type": "object", "properties": {"memory_id": {"type": "string"}}, "required": ["memory_id"]},
            }
            for name in ["pm_pin", "pm_unpin"]
        ],
        *[_mutation_schema(name) for name in ["pm_add", "pm_update", "pm_resolve", "pm_supersede"]],
        {
            "name": "pm_forget",
            "description": "Plan or confirm removal of a memory from recall authority.",
            "parameters": {
                "type": "object",
                "properties": {"memory_id": {"type": "string"}, "plan_id": {"type": "string"}, "plan_hash": {"type": "string"}},
            },
        },
    ]


def _canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _message_hash(message):
    return f"sha256:{hashlib.sha256(message.encode('utf-8')).hexdigest()}"


def build_turn_instruction(*, token, agent_id, trusted_message, trusted_turn_id):
    message = str(trusted_message or "")
    nonce = f"nonce_{uuid.uuid4().hex}"
    turn = {
        "agent_id": agent_id,
        "turn_id": str(trusted_turn_id),
        "nonce": nonce,
        "message": message,
        "message_hash": _message_hash(message),
    }
    signed = {key: turn[key] for key in ["agent_id", "turn_id", "nonce", "message_hash"]}
    turn["signature"] = f"hmac-sha256:{hmac.new(token.encode('utf-8'), _canonical(signed).encode('utf-8'), hashlib.sha256).hexdigest()}"
    return turn


def _mutation_schema(name):
    properties = {
        "scope_kind": {"enum": ["owner", "project"]},
        "project_id": {"type": "string"},
        "memory_id": {"type": "string"},
        "expected_revision": {"type": "integer"},
        "domain": {"type": "string"},
        "title": {"type": "string"},
        "text": {"type": "string"},
    }
    required = ["text"] if name == "pm_add" else ["memory_id", "expected_revision", "text"]
    return {
        "name": name,
        "description": (
            f"Governed personal-memory {name.removeprefix('pm_')} operation. "
            "Use only when the current user explicitly asks to change memory."
        ),
        "parameters": {"type": "object", "properties": properties, "required": required},
    }


def build_command(tool_name, arguments, *, token, agent_id, trusted_message, trusted_turn_id):
    operation = tool_name.removeprefix("pm_")
    turn = build_turn_instruction(
        token=token,
        agent_id=agent_id,
        trusted_message=trusted_message,
        trusted_turn_id=trusted_turn_id,
    )
    patch = {key: arguments[key] for key in ["domain", "title", "text"] if key in arguments}
    patch.setdefault("domain", "personal_note")
    return {
        "schema": "supermemory.personal-memory-command.v1",
        "command_id": f"pmc_{uuid.uuid4().hex}",
        "idempotency_key": str(arguments.get("idempotency_key") or f"idem_{uuid.uuid4().hex}"),
        "operation": operation,
        "target": {"memory_id": arguments["memory_id"]} if arguments.get("memory_id") else None,
        "expected_revision": arguments.get("expected_revision"),
        "scope": ({"kind": "project", "project_id": arguments.get("project_id")} if arguments.get("scope_kind") == "project" or arguments.get("project_id") else {"kind": "owner"}),
        "patch": patch,
        "user_instruction": turn,
    }
