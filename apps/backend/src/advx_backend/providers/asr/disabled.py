import asyncio
from collections.abc import AsyncIterator

from advx_backend.application.ports.asr import AudioChunk, TranscriptSegment


class DisabledAsrProvider:
    async def start(self) -> None:
        return None

    async def push_audio(self, chunk: AudioChunk) -> None:
        del chunk
        raise RuntimeError("ASR is not configured")

    async def commit(self) -> None:
        raise RuntimeError("ASR is not configured")

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
