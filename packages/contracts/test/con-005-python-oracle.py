from __future__ import annotations

import json
from pathlib import Path

from advx_backend.contracts.audience import ViewerPresenceEvent
from advx_backend.contracts.realtime import (
    AsrTranscriptEvent, BackendPong, BackendReady, BarrageEventMessage,
    ClientAudioCommit, ClientHello, ClientPing, ClientTextSubmit,
    ClientVoiceActivity, IngestAck, IngestRejected, RealtimeProtocolError,
    SessionStatusEvent,
)

MODELS = {
    "asr.transcript": AsrTranscriptEvent, "backend.pong": BackendPong,
    "backend.ready": BackendReady, "barrage.event": BarrageEventMessage,
    "client.audio.commit": ClientAudioCommit, "client.hello": ClientHello,
    "client.ping": ClientPing, "client.text.submit": ClientTextSubmit,
    "client.voice.activity": ClientVoiceActivity, "ingest.ack": IngestAck,
    "ingest.rejected": IngestRejected, "protocol.error": RealtimeProtocolError,
    "session.status": SessionStatusEvent, "viewer.joined": ViewerPresenceEvent,
    "viewer.kicked": ViewerPresenceEvent, "viewer.left": ViewerPresenceEvent,
    "viewer.muted": ViewerPresenceEvent, "viewer.rejoined": ViewerPresenceEvent,
    "viewer.unmuted": ViewerPresenceEvent,
}

def main() -> None:
    root = Path(__file__).resolve().parents[3]
    fixture = json.loads((Path(__file__).parent / "fixtures/realtime-python-v4.json").read_text())
    inventory = json.loads((root / "docs/migrations/typescript-bun/contract-inventory.json").read_text())
    owned = {
        binding["surface"]["identifier"] for binding in inventory["bindings"]
        if binding["disposition"]["future_task"] == "CON-005"
        and binding["surface"]["kind"] == "ws-json-message"
    }
    fixture_types = {entry["wire"]["type"] for entry in fixture["messages"]}
    assert owned == set(MODELS) == fixture_types
    assert len(fixture["messages"]) == 19
    for entry in fixture["messages"]:
        wire = entry["wire"]
        assert MODELS[wire["type"]].model_validate(wire).type == wire["type"]
    print(json.dumps({"status": "passed", "python_wire_messages": 19, "versions": [3, 4]}))

if __name__ == "__main__":
    main()
