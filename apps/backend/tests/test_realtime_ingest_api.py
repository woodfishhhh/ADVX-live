import asyncio
import time
from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from advx_backend.application.ingest_service import IngestSessionNotActiveError
from advx_backend.application.ports.asr import AudioChunk, TranscriptSegment
from advx_backend.application.ports.ingest import (
    AudioCommit,
    AudioInput,
    FrameInput,
    IngestInputKind,
    IngestReceipt,
    IngestReceiptStage,
    TextInput,
)
from advx_backend.bootstrap import PipelineConfig, build_runtime
from advx_backend.contracts.binary import (
    BinaryEnvelopeHeader,
    BinaryInputEnvelope,
    BinaryMediaType,
    encode_binary_envelope,
)
from advx_backend.contracts.generation import (
    BarrageCandidate,
    GenerationRequest,
    GenerationResult,
)
from advx_backend.main import create_app

LOCAL_TOKEN = "test-local-token"


def hello() -> dict[str, object]:
    return {
        "type": "client.hello",
        "protocol_version": 1,
        "token": LOCAL_TOKEN,
    }


def envelope(
    *,
    media_type: BinaryMediaType,
    input_id: str,
    format_value: str,
    body: bytes,
    session_id: str = "session-1",
    captured_at_ms: int = 100,
) -> bytes:
    return encode_binary_envelope(
        BinaryInputEnvelope(
            header=BinaryEnvelopeHeader(
                media_type=media_type,
                session_id=session_id,
                input_id=input_id,
                captured_at_ms=captured_at_ms,
                format=format_value,
                body_length=len(body),
            ),
            body=body,
        )
    )


class RecordingIngestPort:
    def __init__(self, *, reject_inactive: bool = False) -> None:
        self.reject_inactive = reject_inactive
        self.inputs: list[TextInput | AudioInput | AudioCommit | FrameInput] = []

    async def submit_text(self, input: TextInput) -> IngestReceipt:
        return self._record(input, IngestInputKind.TEXT)

    async def submit_audio(self, input: AudioInput) -> IngestReceipt:
        return self._record(input, IngestInputKind.AUDIO)

    async def commit_audio(self, commit: AudioCommit) -> IngestReceipt:
        return self._record(
            commit,
            IngestInputKind.AUDIO,
            stage=IngestReceiptStage.COMMITTED,
        )

    async def submit_frame(self, input: FrameInput) -> IngestReceipt:
        return self._record(input, IngestInputKind.FRAME)

    def _record(
        self,
        input: TextInput | AudioInput | AudioCommit | FrameInput,
        kind: IngestInputKind,
        *,
        stage: IngestReceiptStage = IngestReceiptStage.RECEIVED,
    ) -> IngestReceipt:
        if self.reject_inactive:
            raise IngestSessionNotActiveError(input.session_id, None)
        self.inputs.append(input)
        return IngestReceipt(
            session_id=input.session_id,
            input_id=input.input_id,
            input_kind=kind,
            stage=stage,
            accepted_at_ms=123,
        )


class SilentAsrProvider:
    async def start(self) -> None:
        return None

    async def push_audio(self, chunk: AudioChunk) -> None:
        del chunk

    async def commit(self) -> None:
        return None

    async def results(self) -> AsyncIterator[TranscriptSegment]:
        await asyncio.Future()
        if False:
            yield TranscriptSegment(
                session_id="unreachable",
                text="",
                started_at_ms=0,
                ended_at_ms=0,
                final=False,
            )

    async def stop(self) -> None:
        return None


class RecordingModelProvider:
    def __init__(self, *, fail: bool = False) -> None:
        self.requests: list[GenerationRequest] = []
        self.fail = fail

    async def health(self) -> bool:
        return True

    async def generate(self, request: GenerationRequest) -> GenerationResult:
        self.requests.append(request)
        if self.fail:
            raise RuntimeError("upstream rejected the request")
        return GenerationResult(
            request_id=request.request_id,
            candidates=[
                BarrageCandidate(
                    audience_id=request.audiences[0].member.audience_id,
                    text="window reaction",
                )
            ],
        )

    async def cancel(self, request_id: str) -> None:
        del request_id


def receive_until(
    websocket: object,
    message_type: str,
    *,
    input_id: str | None = None,
) -> dict[str, object]:
    while True:
        message = websocket.receive_json()  # type: ignore[attr-defined]
        if message.get("type") != message_type:
            continue
        if input_id is not None and message.get("input_id") != input_id:
            continue
        return message


def test_realtime_dispatches_text_after_gateway_is_configured(tmp_path: Path) -> None:
    runtime = build_runtime(local_token=LOCAL_TOKEN, data_directory=tmp_path)
    app = create_app(runtime=runtime)
    ingest = RecordingIngestPort()
    runtime.ingest_gateway.configure(ingest)

    with TestClient(app) as client:
        with client.websocket_connect("/ws") as websocket:
            websocket.send_json(hello())
            websocket.receive_json()
            websocket.send_json(
                {
                    "type": "client.text.submit",
                    "protocol_version": 1,
                    "session_id": "session-1",
                    "input_id": "text-1",
                    "created_at_ms": 100,
                    "text": "private text",
                }
            )

            assert websocket.receive_json() == {
                "type": "ingest.ack",
                "protocol_version": 1,
                "session_id": "session-1",
                "input_id": "text-1",
                "input_kind": "text",
                "stage": "received",
                "accepted_at_ms": 123,
            }

    assert isinstance(ingest.inputs[0], TextInput)
    assert ingest.inputs[0].text == "private text"


def test_realtime_dispatches_binary_audio_frame_and_audio_commit(tmp_path: Path) -> None:
    runtime = build_runtime(local_token=LOCAL_TOKEN, data_directory=tmp_path)
    ingest = RecordingIngestPort()
    runtime.ingest_gateway.configure(ingest)
    app = create_app(runtime=runtime)
    audio_body = b"\x00\x00\x01\x00"
    frame_body = b"private-frame"

    with TestClient(app) as client:
        with client.websocket_connect("/ws") as websocket:
            websocket.send_json(hello())
            websocket.receive_json()
            websocket.send_bytes(
                envelope(
                    media_type=BinaryMediaType.AUDIO,
                    input_id="audio-1",
                    format_value="audio/pcm;rate=16000;channels=1;format=s16le",
                    body=audio_body,
                )
            )
            assert websocket.receive_json()["input_kind"] == "audio"

            websocket.send_json(
                {
                    "type": "client.audio.commit",
                    "protocol_version": 1,
                    "session_id": "session-1",
                    "input_id": "audio-1",
                    "committed_at_ms": 101,
                }
            )
            assert websocket.receive_json()["stage"] == "committed"

            websocket.send_bytes(
                envelope(
                    media_type=BinaryMediaType.IMAGE,
                    input_id="frame-1",
                    format_value="image/webp",
                    body=frame_body,
                )
            )
            assert websocket.receive_json()["input_kind"] == "frame"

    assert isinstance(ingest.inputs[0], AudioInput)
    assert ingest.inputs[0].body == audio_body
    assert isinstance(ingest.inputs[1], AudioCommit)
    assert isinstance(ingest.inputs[2], FrameInput)
    assert ingest.inputs[2].body == frame_body


@pytest.mark.parametrize(
    ("fail_generation", "expected_message_type"),
    [(False, "barrage.event"), (True, "generation.error")],
)
def test_realtime_frames_are_combined_into_one_periodic_model_window(
    tmp_path: Path,
    fail_generation: bool,
    expected_message_type: str,
) -> None:
    runtime = build_runtime(
        local_token=LOCAL_TOKEN,
        data_directory=tmp_path,
        pipeline_config=PipelineConfig(
            frame_window_interval_ms=50,
            frame_window_min_frames=7,
            max_frames_per_observation=15,
        ),
    )
    model = RecordingModelProvider(fail=fail_generation)
    runtime.configure_ingest_pipeline(
        asr_provider=SilentAsrProvider(),
        model_provider=model,
    )
    app = create_app(runtime=runtime)
    headers = {
        "Authorization": f"Bearer {LOCAL_TOKEN}",
        "X-ADVX-Protocol-Version": "1",
    }

    with TestClient(app) as client:
        with client.websocket_connect("/ws") as websocket:
            websocket.send_json(hello())
            receive_until(websocket, "backend.ready")
            session = client.post("/sessions", headers=headers).json()
            session_id = session["session_id"]
            captured_at_ms = int(time.time() * 1_000)

            websocket.send_json(
                {
                    "type": "client.text.submit",
                    "protocol_version": 1,
                    "session_id": session_id,
                    "input_id": "text-window",
                    "created_at_ms": captured_at_ms,
                    "text": "synchronized prompt",
                }
            )
            receive_until(websocket, "ingest.ack", input_id="text-window")

            for index in range(7):
                input_id = f"frame-{index}"
                websocket.send_bytes(
                    envelope(
                        media_type=BinaryMediaType.IMAGE,
                        input_id=input_id,
                        format_value="image/jpeg",
                        body=f"frame-body-{index}".encode(),
                        session_id=session_id,
                        captured_at_ms=captured_at_ms + index,
                    )
                )
                receive_until(websocket, "ingest.ack", input_id=input_id)

            result_message = receive_until(websocket, expected_message_type)
            stopped = client.post(
                f"/sessions/{session_id}/stop",
                headers=headers,
            )
            assert stopped.status_code == 200

    if fail_generation:
        assert result_message["code"] == "model_generation_failed"
        assert "upstream rejected" not in result_message["message"]  # type: ignore[operator]
    else:
        assert result_message["barrage"]["text"] == "window reaction"  # type: ignore[index]
    assert len(model.requests) == 1
    assert all(len(request.observation.frames) == 7 for request in model.requests)
    assert all(
        request.observation.user_context["frame_window_ms"] == "50"
        and request.observation.user_context["frame_count"] == "7"
        for request in model.requests
    )
    assert all(
        request.observation.room_events[-1].text == "synchronized prompt"
        for request in model.requests
    )


def test_realtime_rejects_unavailable_and_inactive_ingest(tmp_path: Path) -> None:
    runtime = build_runtime(local_token=LOCAL_TOKEN, data_directory=tmp_path)
    app = create_app(runtime=runtime)
    message = {
        "type": "client.text.submit",
        "protocol_version": 1,
        "session_id": "session-1",
        "input_id": "text-1",
        "created_at_ms": 100,
        "text": "private text",
    }

    with TestClient(app) as client:
        with client.websocket_connect("/ws") as websocket:
            websocket.send_json(hello())
            websocket.receive_json()
            websocket.send_json(message)
            unavailable = websocket.receive_json()

    assert unavailable["code"] == "pipeline_unavailable"
    assert "private text" not in unavailable["message"]

    runtime = build_runtime(local_token=LOCAL_TOKEN, data_directory=tmp_path / "inactive")
    runtime.ingest_gateway.configure(RecordingIngestPort(reject_inactive=True))
    app = create_app(runtime=runtime)
    with TestClient(app) as client:
        with client.websocket_connect("/ws") as websocket:
            websocket.send_json(hello())
            websocket.receive_json()
            websocket.send_json(message)
            inactive = websocket.receive_json()

    assert inactive["code"] == "session_not_active"
    assert inactive["session_id"] == "session-1"


def test_realtime_rejects_malformed_binary_without_closing_connection(tmp_path: Path) -> None:
    runtime = build_runtime(local_token=LOCAL_TOKEN, data_directory=tmp_path)
    app = create_app(runtime=runtime)

    with TestClient(app) as client:
        with client.websocket_connect("/ws") as websocket:
            websocket.send_json(hello())
            websocket.receive_json()
            websocket.send_bytes(b"private malformed media")
            rejected = websocket.receive_json()
            websocket.send_json(
                {
                    "type": "client.ping",
                    "protocol_version": 1,
                    "request_id": "after-rejection",
                }
            )
            pong = websocket.receive_json()

    assert rejected["code"] == "malformed_binary_envelope"
    assert "private malformed media" not in rejected["message"]
    assert pong["type"] == "backend.pong"


def test_realtime_distinguishes_binary_version_and_media_type_errors(tmp_path: Path) -> None:
    runtime = build_runtime(local_token=LOCAL_TOKEN, data_directory=tmp_path)
    app = create_app(runtime=runtime)
    valid = envelope(
        media_type=BinaryMediaType.AUDIO,
        input_id="audio-1",
        format_value="audio/pcm;rate=16000;channels=1;format=s16le",
        body=b"\x00\x00",
    )
    unsupported_version = bytearray(valid)
    unsupported_version[4] = 2
    unsupported_media = bytearray(valid)
    unsupported_media[5] = 99

    with TestClient(app) as client:
        with client.websocket_connect("/ws") as websocket:
            websocket.send_json(hello())
            websocket.receive_json()
            websocket.send_bytes(bytes(unsupported_version))
            version_rejection = websocket.receive_json()
            websocket.send_bytes(bytes(unsupported_media))
            media_rejection = websocket.receive_json()

    assert version_rejection["code"] == "unsupported_binary_version"
    assert media_rejection["code"] == "unsupported_media_type"
