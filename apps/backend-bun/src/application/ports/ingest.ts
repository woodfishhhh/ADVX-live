import type {
  AdvxBinaryAudioSource,
  AdvxBinaryVersion,
  SessionSnapshot
} from '@advx/contracts'
import type { TraceContext } from './observability'

export type BinaryIngestInputKind = 'audio' | 'frame'

export type IngestInputKind = 'text' | BinaryIngestInputKind

type BinaryIngestCommandBase = Readonly<{
  sessionId: string
  inputId: string
  capturedAtMs: number | bigint
  format: string
  binaryVersion: AdvxBinaryVersion
  connectionId: string
  traceContext?: TraceContext
  body: Readonly<Uint8Array>
}>

export type AudioIngestCommand = BinaryIngestCommandBase & Readonly<{
  kind: 'audio'
  source: AdvxBinaryAudioSource
  turnId?: string
  systemAudioRequired: boolean
}>

export type FrameIngestCommand = BinaryIngestCommandBase & Readonly<{
  kind: 'frame'
}>

export type BinaryIngestCommand = AudioIngestCommand | FrameIngestCommand

export type BinaryIngestReceipt = Readonly<{
  sessionId: string
  inputId: string
  inputKind: BinaryIngestInputKind
  stage: 'received' | 'committed'
  acceptedAtMs: number
}>

export type TextIngestCommand = Readonly<{
  sessionId: string
  inputId: string
  createdAtMs: number
  text: string
  targetViewerId?: string
  targetPersonaId?: string
  connectionId: string
  traceContext?: TraceContext
}>

export type TextIngestReceipt = Readonly<{
  sessionId: string
  inputId: string
  inputKind: 'text'
  stage: 'received'
  acceptedAtMs: number
}>

export type VoiceActivityCommand = Readonly<{
  sessionId: string
  occurredAtMs: number
  source: AdvxBinaryAudioSource
  traceContext?: TraceContext
}>

export interface BinaryIngestPort {
  dispatch(command: BinaryIngestCommand): Promise<BinaryIngestReceipt>
  clearConnection?(connectionId: string): void | Promise<void>
}

export interface BinaryIngestCommandSink {
  dispatch(command: BinaryIngestCommand): void | Promise<void>
  clearConnection?(connectionId: string): void | Promise<void>
}

export interface TextIngestCommandSink {
  dispatch(command: TextIngestCommand): void | Promise<void>
  clearConnection?(connectionId: string): void | Promise<void>
}

export interface VoiceActivitySink {
  notify(command: VoiceActivityCommand): void | Promise<void>
}

export interface BinaryIngestSessionReader {
  currentSession(): SessionSnapshot | Promise<SessionSnapshot>
}

export interface TextIngestPort {
  submitText(command: TextIngestCommand): Promise<TextIngestReceipt>
  clearConnection?(connectionId: string): void | Promise<void>
}

export interface VoiceActivityPort {
  notifyVoiceActivity(command: VoiceActivityCommand): Promise<void>
}

type AudioCommandInput = Omit<AudioIngestCommand, 'body'> & {
  readonly body: Uint8Array
}

type FrameCommandInput = Omit<FrameIngestCommand, 'body'> & {
  readonly body: Uint8Array
}

export function createAudioIngestCommand(input: AudioCommandInput): AudioIngestCommand {
  return commandWithPrivateBody(input)
}

export function createFrameIngestCommand(input: FrameCommandInput): FrameIngestCommand {
  return commandWithPrivateBody(input)
}

function commandWithPrivateBody<T extends { readonly body: Uint8Array }>(input: T): T {
  const { body, ...metadata } = input
  const command = { ...metadata } as T
  Object.defineProperty(command, 'body', {
    value: body,
    enumerable: false,
    configurable: false,
    writable: false
  })
  return Object.freeze(command)
}
