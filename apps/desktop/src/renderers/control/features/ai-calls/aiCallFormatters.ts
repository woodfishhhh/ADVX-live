import type { AiCallTrace } from '../../../../shared/backend-client'

export type ViewerTrigger =
  | 'user_text'
  | 'final_voice'
  | 'system_audio'
  | 'screen_change'
  | 'ambient_tick'
export type ViewerTriggerContext = Readonly<{
  triggers: readonly ViewerTrigger[]
  screen_change_score?: number | null
  selection_reason_codes?: readonly string[]
  target_viewer_id?: string | null
  target_persona_id?: string | null
  target_ambiguous?: boolean
  trigger_event_ids?: readonly string[]
  trigger_frame_ids?: readonly string[]
}>
type ViewerOutputDelivery = NonNullable<AiCallTrace['viewer_output_delivery']>

const timestampFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  fractionalSecondDigits: 3,
  hour12: false
})

export const aiCallRoleLabels = {
  viewer: '观众',
  visual_summary: '视觉摘要',
  history_summary: '历史摘要',
  memory: '记忆',
  asr: '语音识别'
} as const

export const aiCallStatusLabels = {
  preparing: '准备中',
  sent: '已发送',
  streaming: '流式接收',
  received: '已接收',
  succeeded: '成功',
  failed: '失败',
  blocked: '已阻止',
  cancelled: '已取消',
  interrupted: '已中断'
} as const

export const viewerTriggerLabels: Record<ViewerTrigger, string> = {
  user_text: '主播/用户文本',
  final_voice: '主播最终语音',
  system_audio: '系统音频',
  screen_change: '画面变化',
  ambient_tick: '静默暖场'
}

const viewerTriggers = new Set<string>(Object.keys(viewerTriggerLabels))

function optionalString(value: unknown): string | null | undefined {
  return value === null || typeof value === 'string' ? value : undefined
}

function stringList(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? value
    : undefined
}

export function parseViewerTriggerContext(value: unknown): ViewerTriggerContext | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const rawTriggers = stringList(record.triggers)
  const triggers = rawTriggers?.filter((trigger): trigger is ViewerTrigger =>
    viewerTriggers.has(trigger)
  )
  if (!triggers || triggers.length === 0) return null

  return {
    triggers,
    screen_change_score:
      record.screen_change_score === null || typeof record.screen_change_score === 'number'
        ? record.screen_change_score
        : undefined,
    selection_reason_codes: stringList(record.selection_reason_codes),
    target_viewer_id: optionalString(record.target_viewer_id),
    target_persona_id: optionalString(record.target_persona_id),
    target_ambiguous:
      typeof record.target_ambiguous === 'boolean' ? record.target_ambiguous : undefined,
    trigger_event_ids: stringList(record.trigger_event_ids),
    trigger_frame_ids: stringList(record.trigger_frame_ids)
  }
}

const viewerSelectionReasonLabels: Record<string, string> = {
  per_viewer_independent_decision: '独立观众调度'
}

export function formatViewerTriggerLabel(trigger: ViewerTrigger): string {
  return viewerTriggerLabels[trigger]
}

export function formatViewerTriggerLabels(triggers: readonly ViewerTrigger[]): string {
  return triggers.map(formatViewerTriggerLabel).join(' + ')
}

export function formatScreenChangeScore(score: number | null | undefined): string {
  if (score === null || score === undefined) return '—'
  return `${score.toFixed(2)} (${Math.round(score * 100)}%)`
}

export function formatViewerTriggerReasons(context: ViewerTriggerContext): string[] {
  return context.triggers.map((trigger) => {
    switch (trigger) {
      case 'user_text':
        return '收到主播/用户文本'
      case 'final_voice':
        return '主播最终语音转写完成'
      case 'system_audio':
        return '检测到系统音频转写'
      case 'screen_change':
        return context.screen_change_score === null || context.screen_change_score === undefined
          ? '检测到画面变化'
          : `检测到画面变化，变化分数 ${formatScreenChangeScore(context.screen_change_score)}`
      case 'ambient_tick':
        return '静默暖场定时触发'
    }
  })
}

export function formatViewerSelectionReasons(context: ViewerTriggerContext): string[] {
  const reasons = (context.selection_reason_codes ?? []).map(
    (code) => viewerSelectionReasonLabels[code] ?? code
  )
  if (context.target_viewer_id) {
    reasons.unshift(`定向观众：${context.target_viewer_id}`)
  } else if (context.target_persona_id) {
    reasons.unshift(`定向人设：${context.target_persona_id}`)
  } else if (context.target_ambiguous) {
    reasons.unshift('点名对象不明确，按普通观众调度')
  }
  return reasons.length > 0 ? [...new Set(reasons)] : ['本波触发后由观众调度器选中']
}

export function formatViewerTriggerTarget(context: ViewerTriggerContext): string {
  if (context.target_viewer_id) return `观众 ${context.target_viewer_id}`
  if (context.target_persona_id) return `人设 ${context.target_persona_id}`
  if (context.target_ambiguous) return '普通观众调度'
  return '普通观众调度'
}

export function formatJson(value: unknown): string {
  if (value === undefined || value === null) return '暂无数据'
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2)
}

export function formatTimestamp(timestampMs: number | null | undefined): string {
  if (timestampMs === null || timestampMs === undefined) return '—'
  return timestampFormatter.format(new Date(timestampMs))
}

export function formatDuration(durationMs: number | null | undefined): string {
  if (durationMs === null || durationMs === undefined) return '—'
  if (durationMs < 1_000) return `${durationMs} ms`
  return `${(durationMs / 1_000).toFixed(durationMs < 10_000 ? 2 : 1)} s`
}

export function formatViewerOutputProgress(delivery: ViewerOutputDelivery): string {
  return `${delivery.published_event_count}/${delivery.event_count} 条`
}

export function retainSelectedCallId<T extends { call_id: string }>(
  items: readonly T[],
  selectedCallId: string | null
): string | null {
  if (selectedCallId && items.some((item) => item.call_id === selectedCallId)) {
    return selectedCallId
  }
  return items[0]?.call_id ?? null
}

export function collectCorrelationIds(trace: AiCallTrace): Array<{
  label: string
  value: string
}> {
  return [
    ['调用 ID', trace.call_id],
    ['关联 ID', trace.correlation_id],
    ['会话 ID', trace.session_id],
    ['房间 ID', trace.room_id],
    ['观众 Epoch', trace.audience_epoch === undefined || trace.audience_epoch === null
      ? null
      : String(trace.audience_epoch)],
    ['观察 ID', trace.observation_id],
    ['生成请求 ID', trace.generation_request_id],
    ['Viewer ID', trace.viewer_instance_id],
    ['话语 ID', trace.utterance_id],
    ['供应商请求 ID', trace.response?.provider_request_id],
    ['请求 SHA-256', trace.request?.wire_sha256],
    ['响应 SHA-256', trace.response?.body_sha256]
  ].flatMap(([label, value]) => value ? [{ label: label as string, value }] : [])
}
