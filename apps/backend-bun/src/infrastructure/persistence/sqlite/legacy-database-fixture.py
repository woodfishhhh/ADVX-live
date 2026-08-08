from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

from sqlalchemy import text

from advx_backend.infrastructure.persistence.sqlite.database import (
    DatabaseConfig,
    SQLiteDatabase,
)


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-directory", type=Path, required=True)
    args = parser.parse_args()
    database = SQLiteDatabase(DatabaseConfig(args.data_directory.resolve()))
    await database.start()
    try:
        async with database.session_factory() as session:
            await session.execute(
                text(
                    """
                    INSERT INTO audience_profiles (
                      audience_id, display_name, avatar_ref, personality_json,
                      preferences_json, speaking_style_json, enabled, origin,
                      preset_id, preset_version, revision, created_at_ms,
                      updated_at_ms
                    ) VALUES (
                      'audience-legacy', 'Legacy Viewer', NULL, '{}', '{}', '{}',
                      1, 'custom', NULL, NULL, 1, 1, 1
                    )
                    """
                )
            )
            await session.execute(
                text(
                    """
                    INSERT INTO rooms (
                      room_id, display_name, state, revision, created_at_ms,
                      updated_at_ms
                    ) VALUES ('room-legacy', 'Legacy Room', 'active', 0, 1, 1)
                    """
                )
            )
            await session.execute(
                text(
                    """
                    INSERT INTO session_records (
                      session_id, room_id, state, audience_epoch,
                      active_config_hash, recovery_json, started_at_ms,
                      ended_at_ms, outcome, app_version
                    ) VALUES (
                      'session-legacy', 'room-legacy', 'running', 1, NULL, NULL,
                      2, NULL, NULL, 'python-legacy'
                    )
                    """
                )
            )
            await session.execute(
                text(
                    """
                    INSERT INTO room_events (
                      event_id, room_id, session_id, sequence, source_type,
                      source_id, audience_epoch, content_json, content_hash,
                      occurred_at_ms
                    ) VALUES (
                      'event-legacy', 'room-legacy', 'session-legacy', 1,
                      'user_text', 'user', 1, '{"text":"legacy hello"}',
                      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                      3
                    )
                    """
                )
            )
            await session.commit()
            print(
                json.dumps(
                    {
                        "status": "ready",
                        "databasePath": str(database.path),
                    },
                    sort_keys=True,
                ),
                flush=True,
            )
            await asyncio.to_thread(sys.stdin.readline)
    finally:
        await database.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
