"""Temporary Python authority for the CON-009 cross-runtime parity suite."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import sys
from pathlib import Path
from typing import Any

from fastapi.routing import APIRoute
from pydantic import TypeAdapter

from advx_backend.contracts.audience import ViewerPresenceEvent
from advx_backend.contracts.binary import decode_binary_envelope, encode_binary_envelope
from advx_backend.contracts.realtime import (
    AsrTranscriptEvent,
    BackendPong,
    BackendReady,
    BarrageEventMessage,
    ClientAudioCommit,
    ClientHello,
    ClientPing,
    ClientTextSubmit,
    ClientVoiceActivity,
    IngestAck,
    IngestRejected,
    RealtimeProtocolError,
    SessionStatusEvent,
)
from advx_backend.contracts.viewer_runtime import CanonicalRuntimeSpec
from advx_backend.main import app


REALTIME_MODELS = {
    "asr.transcript": AsrTranscriptEvent,
    "backend.pong": BackendPong,
    "backend.ready": BackendReady,
    "barrage.event": BarrageEventMessage,
    "client.audio.commit": ClientAudioCommit,
    "client.hello": ClientHello,
    "client.ping": ClientPing,
    "client.text.submit": ClientTextSubmit,
    "client.voice.activity": ClientVoiceActivity,
    "ingest.ack": IngestAck,
    "ingest.rejected": IngestRejected,
    "protocol.error": RealtimeProtocolError,
    "session.status": SessionStatusEvent,
    "viewer.joined": ViewerPresenceEvent,
    "viewer.kicked": ViewerPresenceEvent,
    "viewer.left": ViewerPresenceEvent,
    "viewer.muted": ViewerPresenceEvent,
    "viewer.rejoined": ViewerPresenceEvent,
    "viewer.unmuted": ViewerPresenceEvent,
}
SECRET_FIELDS = {"model_api_key", "asr_api_key"}
SYNTHETIC_SECRET = "con-009-internal-synthetic-secret"


def route_map() -> dict[tuple[str, str], APIRoute]:
    routes: dict[tuple[str, str], APIRoute] = {}
    for included in app.routes:
        router = getattr(included, "original_router", None)
        if router is None:
            continue
        for route in router.routes:
            if not isinstance(route, APIRoute):
                continue
            for method in route.methods:
                routes[(method, route.path)] = route
    return routes


def dump(value: Any) -> Any:
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json")
    return TypeAdapter(type(value)).dump_python(value, mode="json")


def validate_fields(fields: list[Any], candidate: dict[str, Any]) -> dict[str, Any]:
    output: dict[str, Any] = {}
    for field in fields:
        alias = field.alias
        if alias not in candidate:
            continue
        value, errors = field.validate(candidate[alias], {}, loc=(alias,))
        if errors:
            raise ValueError(errors)
        output[alias] = field.serialize(value)
    return output


def validate_body(route: APIRoute, candidate: Any, controlled: bool) -> Any:
    fields = list(route.dependant.body_params)
    if not fields:
        return candidate
    hydrated = hydrate_python_hashes(dict(candidate))
    if controlled:
        hydrated.setdefault("model_base_url", "https://example.invalid/v1")
        hydrated.setdefault("model_name", "synthetic-model")
        for name in SECRET_FIELDS:
            hydrated[name] = SYNTHETIC_SECRET
    if len(fields) == 1:
        parsed, errors = fields[0].validate(hydrated, {}, loc=(fields[0].alias,))
        if errors:
            raise ValueError(errors)
        serialized = fields[0].serialize(parsed)
    else:
        serialized = validate_fields(fields, hydrated)
    if controlled:
        serialized = {
            key: serialized[key] for key in candidate if key not in SECRET_FIELDS
        }
    return serialized


def hydrate_python_hashes(candidate: dict[str, Any]) -> dict[str, Any]:
    container = candidate.get("bundle") if isinstance(candidate.get("bundle"), dict) else candidate
    if isinstance(container.get("canonical_runtime_spec"), dict):
        spec = CanonicalRuntimeSpec.model_validate(container["canonical_runtime_spec"])
        container["canonical_runtime_spec"] = spec.model_dump(mode="json", exclude_none=True)
        hash_field = "config_hash" if "config_hash" in container else "client_config_hash"
        if hash_field in container:
            container[hash_field] = spec.config_hash()
    return candidate


def validate_response(route: APIRoute, candidate: Any, record: dict[str, Any]) -> Any:
    if route.response_model is None:
        if candidate is not None:
            raise ValueError(f"{route.path} has no Python response model but received data")
        return None
    adapter = TypeAdapter(route.response_model)
    if route.path == "/debug/ai-calls/images/{preview_id}":
        body = b"CON009"
        authority = adapter.validate_python(
            {
                "mime_type": candidate["mime_type"],
                "data_url": f"data:{candidate['mime_type']};base64,{base64.b64encode(body).decode('ascii')}",
            }
        )
        serialized = adapter.dump_python(authority, mode="json")
        return {
            "preview_id": record["contracts"]["pathParams"]["preview_id"],
            "mime_type": serialized["mime_type"],
            "byte_length": len(body),
            "content_sha256": hashlib.sha256(body).hexdigest(),
            "redacted": True,
        }
    return adapter.dump_python(adapter.validate_python(candidate), mode="json")


def validate_http(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    routes = route_map()
    output: list[dict[str, Any]] = []
    for record in records:
        key = (record["method"], record["path"])
        route = routes.get(key)
        if route is None:
            raise ValueError(f"missing retained Python route: {key[0]} {key[1]}")
        contracts = record["contracts"]
        serialized = {
            "pathParams": validate_fields(list(route.dependant.path_params), contracts["pathParams"]),
            "query": validate_fields(list(route.dependant.query_params), contracts["query"]),
            "responses": {
                status: (
                    validate_response(route, value, record)
                    if 200 <= int(status) < 300
                    else value
                )
                for status, value in contracts["responses"].items()
            },
        }
        if "body" in contracts:
            serialized["body"] = validate_body(
                route, contracts["body"], record["bodyKind"] == "controlled-secret-boundary"
            )
        output.append({**record, "contracts": serialized})
    return output


def validate_realtime(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for record in records:
        if "canonical" in record:
            canonical = record["canonical"]
            wire = canonical_to_wire(canonical)
            model = REALTIME_MODELS[wire["type"]]
            model.model_validate(wire)
            output.append({"canonical": canonical, "messageType": wire["type"]})
            continue
        wire = record["wire"]
        model = REALTIME_MODELS[wire["type"]]
        serialized = model.model_validate(wire).model_dump(mode="json", exclude_none=False)
        output.append({"wire": serialized, "context": record["context"]})
    return output


def canonical_to_wire(canonical: dict[str, Any]) -> dict[str, Any]:
    message_type = canonical["message_type"]
    payload = canonical["payload"]
    base: dict[str, Any] = {
        "protocol_version": canonical["protocol_version"],
        "type": message_type,
    }
    if message_type == "client.hello":
        return {**base, "token": SYNTHETIC_SECRET, **payload}
    if message_type in {"client.ping", "backend.pong"}:
        return {**base, "request_id": payload["request_id"]}
    if message_type == "client.text.submit":
        return {**base, "session_id": canonical["session_id"], "created_at_ms": canonical["created_at_ms"], **payload}
    if message_type in {"client.audio.commit", "client.voice.activity"}:
        return {**base, "session_id": canonical["session_id"], **payload}
    if message_type in {"backend.ready", "session.status"}:
        return {**base, "session": payload["session"]}
    if message_type == "barrage.event":
        return {**base, "barrage": payload["barrage"]}
    if message_type == "protocol.error":
        return {**base, **payload}
    if message_type == "ingest.ack":
        return {**base, "session_id": canonical["session_id"], **payload}
    if message_type == "ingest.rejected":
        return {**base, **({"session_id": canonical["session_id"]} if "session_id" in canonical else {}), **payload}
    if message_type == "asr.transcript":
        allowed = {key: payload[key] for key in (
            "source", "text", "final", "started_at_ms", "ended_at_ms", "utterance_id", "revision"
        ) if key in payload}
        return {**base, **allowed}
    if message_type.startswith("viewer."):
        return {
            **base,
            "session_id": canonical["session_id"],
            "audience_epoch": canonical["audience_epoch"],
            **payload,
        }
    raise ValueError(f"unsupported retained realtime family: {message_type}")


def validate_binary(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for record in records:
        payload = base64.b64decode(record["base64"], validate=True)
        decoded = decode_binary_envelope(payload)
        encoded = encode_binary_envelope(decoded)
        output.append({**record, "base64": base64.b64encode(encoded).decode("ascii")})
    return output


def process(payload: dict[str, Any]) -> dict[str, Any]:
    result = {
        "schemaVersion": 1,
        "http": validate_http(payload["http"]),
        "realtime": validate_realtime(payload["realtime"]),
        "binary": validate_binary(payload["binary"]),
    }
    encoded = json.dumps(result, ensure_ascii=True, sort_keys=True, separators=(",", ":"))
    if SYNTHETIC_SECRET in encoded or any(name in encoded for name in SECRET_FIELDS):
        raise ValueError("controlled credential material escaped the Python oracle")
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    pid_path = os.environ.get("ADVX_PARITY_PID_FILE")
    if pid_path:
        Path(pid_path).write_text(str(os.getpid()), encoding="ascii")
    payload = json.loads(args.input.read_text(encoding="utf-8"))
    result = process(payload)
    args.output.write_text(
        json.dumps(result, ensure_ascii=True, sort_keys=True, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({"http": len(result["http"]), "realtime": len(result["realtime"]), "binary": len(result["binary"])}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"contract parity oracle failed: {error}", file=sys.stderr)
        raise
