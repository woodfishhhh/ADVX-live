/**
 * Legacy compatibility types generated from the Python/FastAPI OpenAPI document.
 *
 * @deprecated New canonical contracts must be declared with the runtime schema
 * API exported from this package root.
 */
export type { components, operations, paths } from './generated/openapi'

import type { components } from './generated/openapi'

/** @deprecated Use a canonical runtime schema once its owning CON task ports it. */
export type SessionSnapshot = components['schemas']['SessionSnapshot']
/** @deprecated Use a canonical runtime schema once its owning CON task ports it. */
export type RealtimeBarrageEvent = components['schemas']['BarrageSnapshot']
/** @deprecated Use a canonical runtime schema once its owning CON task ports it. */
export type RealtimeClientMessage =
  components['schemas']['ClientMessageEnvelope']
/** @deprecated Use a canonical runtime schema once its owning CON task ports it. */
export type RealtimeServerMessage =
  components['schemas']['ServerMessageEnvelope']
/** @deprecated Use a canonical runtime schema once its owning CON task ports it. */
export type RealtimeBinaryInputHeader =
  components['schemas']['BinaryEnvelopeHeader']
/** @deprecated Use a canonical runtime schema once its owning CON task ports it. */
export type RealtimeIngestAck = components['schemas']['IngestAck']
/** @deprecated Use a canonical runtime schema once its owning CON task ports it. */
export type RealtimeIngestRejected = components['schemas']['IngestRejected']
/** @deprecated Use a canonical runtime schema once its owning CON task ports it. */
export type CanonicalRuntimeSpec =
  components['schemas']['CanonicalRuntimeSpec']
/** @deprecated Use a canonical runtime schema once its owning CON task ports it. */
export type PersonaTemplate = components['schemas']['PersonaTemplate']
/** @deprecated Use a canonical runtime schema once its owning CON task ports it. */
export type PersonaOverride = components['schemas']['PersonaOverride']
/** @deprecated Use a canonical runtime schema once its owning CON task ports it. */
export type ModeDefinition = components['schemas']['ModeDefinition']
/** @deprecated Use a canonical runtime schema once its owning CON task ports it. */
export type RuntimeSettings = components['schemas']['RuntimeSettings']
/** @deprecated Use a canonical runtime schema once its owning CON task ports it. */
export type RuntimeSessionSnapshot =
  components['schemas']['RuntimeSessionSnapshot']
/** @deprecated Use a canonical runtime schema once its owning CON task ports it. */
export type ProviderCapabilityProbeResult =
  components['schemas']['ProviderCapabilityProbeResult']
/** @deprecated Use a canonical runtime schema once its owning CON task ports it. */
export type ViewerRequestTrace = components['schemas']['ViewerRequestTrace']
/** @deprecated Use a canonical runtime schema once its owning CON task ports it. */
export type TraceQueryResponse = components['schemas']['TraceQueryResponse']
