import roomSessionRuntimeSql from './0001_room_session_runtime.sql' with { type: 'text' }
import sessionViewerInstancesSql from './0002_session_viewer_instances.sql' with { type: 'text' }
import roomEventsSql from './0003_room_events.sql' with { type: 'text' }
import roomLongTermMemoriesSql from './0004_room_long_term_memories.sql' with { type: 'text' }
import modeMemesSql from './0005_mode_memes.sql' with { type: 'text' }
import durableOutboxSql from './0006_durable_outbox.sql' with { type: 'text' }

import type { SqliteMigration } from '../migration-runner'

export const ADVX_SQLITE_MIGRATIONS: readonly SqliteMigration[] = [
  {
    version: 1,
    name: '0001_room_session_runtime',
    sql: roomSessionRuntimeSql,
    checksum: '7c3f8db5621bbf084957aadbfc61bd2cfce1f692d8343bf0f187815f22839fe0',
    destructive: false
  },
  {
    version: 2,
    name: '0002_session_viewer_instances',
    sql: sessionViewerInstancesSql,
    checksum: 'bad615bf09eb3e0903b6cfe9cc5256ac416dcfb84715cd6fe97322dc4cdc8596',
    destructive: false
  },
  {
    version: 3,
    name: '0003_room_events',
    sql: roomEventsSql,
    checksum: '42f60ef0c5efcfcf9ee647f9071627d05ca78a0924ed91be69eaa4f773343138',
    destructive: false
  },
  {
    version: 4,
    name: '0004_room_long_term_memories',
    sql: roomLongTermMemoriesSql,
    checksum: '8c89909366e5e3fb826c1c53b96975306bf8257fb1389b3d4e135309fe3c4ef2',
    destructive: false
  },
  {
    version: 5,
    name: '0005_mode_memes',
    sql: modeMemesSql,
    checksum: 'a4dcf643f51c51bd5a9098ff63a6664d0d7c2828ddf6c41dda83433b415e2da7',
    destructive: false
  },
  {
    version: 6,
    name: '0006_durable_outbox',
    sql: durableOutboxSql,
    checksum: 'd9e3a75bdf3faf3234c8f664ebf58ade4b100c06982492c7f77da3fac0e0b5d1',
    destructive: false
  }
]
