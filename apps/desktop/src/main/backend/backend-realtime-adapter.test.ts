import { afterEach, describe, expect, it } from "vitest";
import {
  normalizeLegacyRealtimeMessage,
  realtimeMessageRegistry
} from "@advx/contracts";
import { BackendRealtimeAdapter } from "./backend-realtime-adapter";

const session = {
  session_id: "session-1",
  state: "running" as const,
  started_at_ms: 1_000,
  updated_at_ms: 1_001,
  revision: 2
};

const barrage = {
  barrage_id: "barrage-1",
  room_id: "room-1",
  session_id: "session-1",
  audience_epoch: 3,
  observation_id: "observation-1",
  generation_request_id: "generation-1",
  viewer_instance_id: "viewer-1",
  persona_id: "persona-1",
  display_name: "Viewer",
  viewer_sequence: 1,
  reaction_type: "agree",
  intent: "agree" as const,
  target: null,
  evidence_refs: [],
  text: "hello",
  created_at_ms: 1_000,
  expires_at_ms: 2_000
};

afterEach(() => {
  // Keep the test suite explicit about not leaving timers or globals behind.
});

describe("desktop realtime compatibility adapter", () => {
  it("keeps the authenticated legacy hello while normalizing canonical Bun envelopes", () => {
    const adapter = new BackendRealtimeAdapter({
      backendStartId: "backend-start-1"
    });
    const hello = JSON.parse(
      adapter.encodeClientMessage({
        type: "client.hello",
        protocol_version: 4,
        supported_protocol_versions: [4, 3],
        token: "local-token"
      })
    );
    expect(hello).toMatchObject({ type: "client.hello", token: "local-token" });

    const canonical = normalizeLegacyRealtimeMessage(
      { protocol_version: 4, type: "backend.ready", session },
      { message_id: "message-1", created_at_ms: 1_001 }
    );
    const parsed = adapter.parseServerWire(canonical, 4);
    expect(parsed.wireFamily).toBe("canonical-envelope");
    expect(parsed.messageId).toBe("message-1");
    expect(parsed.sessionId).toBe("session-1");
    expect(parsed.legacyMessage).toMatchObject({ type: "backend.ready", session });
  });

  it("deduplicates event identities and rejects stale connection generations", () => {
    const adapter = new BackendRealtimeAdapter({
      backendStartId: "backend-start-1"
    });
    const identity = adapter.beginConnection();
    expect(adapter.isCurrentConnection(identity)).toBe(true);

    const parsed = adapter.parseServerWire(
      { protocol_version: 4, type: "barrage.event", barrage },
      4
    );
    expect(adapter.acceptMessage(parsed.messageId)).toBe(true);
    expect(adapter.acceptMessage(parsed.messageId)).toBe(false);

    expect(adapter.setBackendStartId("backend-start-2")).toBe(true);
    expect(adapter.isCurrentConnection(identity)).toBe(false);
    expect(adapter.acceptMessage(parsed.messageId)).toBe(true);
  });

  it("normalizes clean shutdown messages from either wire family", () => {
    const adapter = new BackendRealtimeAdapter({
      backendStartId: "backend-start-1"
    });
    const canonical = realtimeMessageRegistry["backend.shutdown"].schema.parse({
      protocol_version: 4,
      message_type: "backend.shutdown",
      message_id: "shutdown-1",
      created_at_ms: 2_000,
      payload: { reason: "restart", deadline_at_ms: 2_500 }
    });
    expect(adapter.parseServerWire(canonical, 4).shutdown).toEqual({
      reason: "restart",
      deadlineAtMs: 2_500
    });
    expect(
      adapter.parseServerWire(
        {
          protocol_version: 4,
          type: "backend.shutdown",
          reason: "requested"
        },
        4
      ).shutdown
    ).toEqual({ reason: "requested" });
  });
});
