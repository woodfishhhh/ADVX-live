import {
  legacyRealtimeMessageSchema,
  parseCanonicalRealtimeEnvelope,
  type RealtimeEnvelope
} from "@advx/contracts";

export type RealtimeWireFamily = "legacy" | "canonical-envelope";

export type RealtimeShutdown = {
  reason: "requested" | "restart" | "fatal_error";
  deadlineAtMs?: number;
};

export type ParsedRealtimeServerWire = {
  legacyMessage: unknown | null;
  messageId: string;
  wireFamily: RealtimeWireFamily;
  sessionId: string | null;
  audienceEpoch: number | null;
  shutdown: RealtimeShutdown | null;
};

type RealtimeConnectionIdentity = {
  backendStartId: string;
  generation: number;
};

const MAX_SEEN_MESSAGE_IDS = 1_024;

/**
 * Keeps durable realtime v3/v4 compatibility while accepting the canonical
 * Bun envelope. The native Electron WebSocket API cannot attach arbitrary HTTP
 * headers, so the authenticated legacy hello token remains the connection
 * bootstrap; all inbound wire families are normalized at this boundary.
 */
export class BackendRealtimeAdapter {
  readonly wireFamily: RealtimeWireFamily = "legacy";
  private backendStartId: string;
  private connectionGeneration = 0;
  private readonly seenMessageIds = new Set<string>();

  constructor(options: { backendStartId: string }) {
    this.backendStartId = options.backendStartId;
  }

  setBackendStartId(backendStartId: string): boolean {
    if (backendStartId === this.backendStartId) return false;
    this.backendStartId = backendStartId;
    this.connectionGeneration += 1;
    this.seenMessageIds.clear();
    return true;
  }

  beginConnection(): RealtimeConnectionIdentity {
    this.connectionGeneration += 1;
    return {
      backendStartId: this.backendStartId,
      generation: this.connectionGeneration
    };
  }

  isCurrentConnection(identity: RealtimeConnectionIdentity): boolean {
    return (
      identity.backendStartId === this.backendStartId &&
      identity.generation === this.connectionGeneration
    );
  }

  encodeClientMessage(message: object): string {
    return JSON.stringify(message);
  }

  acceptMessage(messageId: string): boolean {
    if (this.seenMessageIds.has(messageId)) return false;
    this.seenMessageIds.add(messageId);
    if (this.seenMessageIds.size > MAX_SEEN_MESSAGE_IDS) {
      const oldest = this.seenMessageIds.values().next().value as string | undefined;
      if (oldest !== undefined) this.seenMessageIds.delete(oldest);
    }
    return true;
  }

  parseServerWire(value: unknown, expectedProtocolVersion: 3 | 4 | null): ParsedRealtimeServerWire {
    if (isRecord(value) && typeof value.message_type === "string") {
      const envelope = parseCanonicalRealtimeEnvelope(value);
      assertExpectedProtocolVersion(envelope, expectedProtocolVersion);
      return canonicalToLegacy(envelope);
    }

    if (isRecord(value) && value.type === "backend.shutdown") {
      return parseLegacyShutdown(value, expectedProtocolVersion);
    }

    const legacy = legacyRealtimeMessageSchema.parse(value) as Record<string, unknown>;
    assertExpectedProtocolVersion(legacy, expectedProtocolVersion);
    return {
      legacyMessage: legacy,
      messageId: legacyMessageId(legacy),
      wireFamily: "legacy",
      sessionId: scopedSessionId(legacy),
      audienceEpoch: scopedAudienceEpoch(legacy),
      shutdown: null
    };
  }
}

function canonicalToLegacy(envelope: RealtimeEnvelope): ParsedRealtimeServerWire {
  const payload = envelope.payload as Record<string, unknown>;
  let legacyMessage: Record<string, unknown>;

  switch (envelope.message_type) {
    case "backend.ready":
    case "session.status":
      legacyMessage = {
        protocol_version: envelope.protocol_version,
        type: envelope.message_type,
        session: payload.session
      };
      break;
    case "backend.pong":
      legacyMessage = {
        protocol_version: envelope.protocol_version,
        type: envelope.message_type,
        request_id: payload.request_id
      };
      break;
    case "barrage.event":
      legacyMessage = {
        protocol_version: envelope.protocol_version,
        type: envelope.message_type,
        barrage: payload.barrage
      };
      break;
    case "protocol.error":
      legacyMessage = {
        protocol_version: envelope.protocol_version,
        type: envelope.message_type,
        code: payload.code,
        message: payload.message,
        supported_version: payload.supported_version
      };
      break;
    case "ingest.ack":
      legacyMessage = {
        protocol_version: envelope.protocol_version,
        type: envelope.message_type,
        session_id: envelope.session_id,
        ...payload
      };
      break;
    case "ingest.rejected":
      legacyMessage = {
        protocol_version: envelope.protocol_version,
        type: envelope.message_type,
        ...(envelope.session_id === undefined ? {} : { session_id: envelope.session_id }),
        ...payload
      };
      break;
    case "asr.transcript":
      legacyMessage = {
        protocol_version: envelope.protocol_version,
        type: envelope.message_type,
        ...payload
      };
      break;
    case "viewer.joined":
    case "viewer.left":
    case "viewer.rejoined":
    case "viewer.muted":
    case "viewer.unmuted":
    case "viewer.kicked":
      legacyMessage = {
        protocol_version: envelope.protocol_version,
        type: envelope.message_type,
        session_id: envelope.session_id,
        audience_epoch: envelope.audience_epoch,
        ...payload
      };
      break;
    case "backend.shutdown":
      return {
        legacyMessage: null,
        messageId: envelope.message_id,
        wireFamily: "canonical-envelope",
        sessionId: envelope.session_id ?? null,
        audienceEpoch: envelope.audience_epoch ?? null,
        shutdown: parseShutdownPayload(payload)
      };
    default:
      throw new Error(`不支持的后端实时消息类型：${envelope.message_type}。`);
  }

  return {
    legacyMessage,
    messageId: canonicalMessageId(envelope, legacyMessage),
    wireFamily: "canonical-envelope",
    sessionId: envelope.session_id ?? scopedSessionId(legacyMessage),
    audienceEpoch: envelope.audience_epoch ?? scopedAudienceEpoch(legacyMessage),
    shutdown: null
  };
}

function canonicalMessageId(
  envelope: RealtimeEnvelope,
  legacyMessage: Record<string, unknown>
): string {
  if (
    envelope.message_type === "barrage.event" ||
    envelope.message_type.startsWith("viewer.") ||
    envelope.message_type === "asr.transcript"
  ) {
    return legacyMessageId(legacyMessage);
  }
  return envelope.message_id;
}

function parseLegacyShutdown(
  value: Record<string, unknown>,
  expectedProtocolVersion: 3 | 4 | null
): ParsedRealtimeServerWire {
  assertExpectedProtocolVersion(value, expectedProtocolVersion);
  const reason = value.reason;
  if (reason !== "requested" && reason !== "restart" && reason !== "fatal_error") {
    throw new Error("backend.shutdown reason 无效。");
  }
  const deadlineAtMs = value.deadline_at_ms;
  if (
    deadlineAtMs !== undefined &&
    (!Number.isSafeInteger(deadlineAtMs) || (deadlineAtMs as number) < 0)
  ) {
    throw new Error("backend.shutdown deadline_at_ms 无效。");
  }
  return {
    legacyMessage: null,
    messageId: legacyMessageId(value),
    wireFamily: "legacy",
    sessionId: null,
    audienceEpoch: null,
    shutdown: {
      reason,
      ...(deadlineAtMs === undefined ? {} : { deadlineAtMs: deadlineAtMs as number })
    }
  };
}

function parseShutdownPayload(payload: Record<string, unknown>): RealtimeShutdown {
  const reason = payload.reason;
  if (reason !== "requested" && reason !== "restart" && reason !== "fatal_error") {
    throw new Error("backend.shutdown reason 无效。");
  }
  const deadlineAtMs = payload.deadline_at_ms;
  if (
    deadlineAtMs !== undefined &&
    (!Number.isSafeInteger(deadlineAtMs) || (deadlineAtMs as number) < 0)
  ) {
    throw new Error("backend.shutdown deadline_at_ms 无效。");
  }
  return {
    reason,
    ...(deadlineAtMs === undefined ? {} : { deadlineAtMs: deadlineAtMs as number })
  };
}

function assertExpectedProtocolVersion(
  value: { protocol_version?: unknown },
  expectedProtocolVersion: 3 | 4 | null
): void {
  if (
    expectedProtocolVersion !== null &&
    value.protocol_version !== expectedProtocolVersion
  ) {
    throw new Error(
      `后端实时协议版本漂移：需要 v${expectedProtocolVersion}，收到 v${String(value.protocol_version)}。`
    );
  }
}

function legacyMessageId(value: Record<string, unknown>): string {
  const type = typeof value.type === "string" ? value.type : "unknown";
  if (type === "barrage.event" && isRecord(value.barrage)) {
    return `barrage:${String(value.barrage.barrage_id)}`;
  }
  if (type.startsWith("viewer.") && isRecord(value.viewer)) {
    return [
      type,
      String(value.session_id),
      String(value.audience_epoch),
      String(value.viewer.viewer_instance_id),
      String(value.population_revision)
    ].join(":");
  }
  if (type === "asr.transcript") {
    return [type, String(value.source), String(value.utterance_id), String(value.revision), String(value.final)].join(":");
  }
  if (type === "ingest.ack" || type === "ingest.rejected") {
    return [type, String(value.input_id), String(value.stage), String(value.code)].join(":");
  }
  if (type === "session.status" || type === "backend.ready") {
    const session = isRecord(value.session) ? value.session : null;
    return [type, String(session?.session_id), String(session?.revision)].join(":");
  }
  return `${type}:${JSON.stringify(value)}`;
}

function scopedSessionId(value: Record<string, unknown>): string | null {
  if (typeof value.session_id === "string") return value.session_id;
  if ((value.type === "backend.ready" || value.type === "session.status") && isRecord(value.session)) {
    return typeof value.session.session_id === "string" ? value.session.session_id : null;
  }
  if (value.type === "barrage.event" && isRecord(value.barrage)) {
    return typeof value.barrage.session_id === "string" ? value.barrage.session_id : null;
  }
  return null;
}

function scopedAudienceEpoch(value: Record<string, unknown>): number | null {
  if (Number.isSafeInteger(value.audience_epoch)) return value.audience_epoch as number;
  if (value.type === "barrage.event" && isRecord(value.barrage) && Number.isSafeInteger(value.barrage.audience_epoch)) {
    return value.barrage.audience_epoch as number;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
