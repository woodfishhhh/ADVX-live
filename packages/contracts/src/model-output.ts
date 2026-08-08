import { schema, type InferSchema } from './schema'
import {
  evidenceRefSchema,
  viewerReactionIntentSchema,
  viewerReactionTargetSchema
} from './realtime/payloads'
import {
  pythonUnicodeCaseFold,
  truncateUnicodeCodePoints,
  unicodeCodePointLength
} from './unicode-casefold'

export const VIEWER_GENERATION_SCHEMA_NAME = 'viewer_generation_v1'
export const VIEWER_BARRAGE_TEXT_INPUT_LIMIT = 4_000
export const VIEWER_BARRAGE_TEXT_PRODUCT_LIMIT = 160

const viewerBarrageTextSchema = unicodeBoundedString(
  1,
  VIEWER_BARRAGE_TEXT_INPUT_LIMIT
)
const viewerReactionTypeSchema = unicodeBoundedString(1, 64)
const viewerDecisionReasonSchema = unicodeBoundedString(1, 160)

export const viewerModelOutputSchema = schema.refine(
  schema.object({
    action: schema.enum(['barrage', 'silence']),
    intent: viewerReactionIntentSchema,
    target: schema.nullable(viewerReactionTargetSchema),
    texts: schema.nullable(schema.array(viewerBarrageTextSchema, { minItems: 1 })),
    reaction_type: viewerReactionTypeSchema,
    decision_reason: schema.nullable(viewerDecisionReasonSchema),
    evidence_refs: schema.array(evidenceRefSchema, { maxItems: 128 })
  }),
  (value) => {
    if (value.action === 'silence') {
      return value.intent === 'silence' &&
        value.target === null &&
        value.texts === null &&
        value.reaction_type === 'silence'
    }
    if (value.texts === null) return false
    const normalized = value.texts.map((text) => text.trim())
    if (normalized.some((text) => text.length === 0)) return false
    const displayed = normalized.map((text) => pythonUnicodeCaseFold(
      truncateViewerBarrageText(text)
    ))
    return new Set(displayed).size === displayed.length
  },
  'viewer output action, texts, and reaction type must be publication-safe'
)

export type ViewerModelOutput = InferSchema<typeof viewerModelOutputSchema>

export function truncateViewerBarrageText(value: string): string {
  return truncateUnicodeCodePoints(value, VIEWER_BARRAGE_TEXT_PRODUCT_LIMIT)
}

function unicodeBoundedString(minimum: number, maximum: number) {
  return schema.refine(
    schema.string(),
    (value) => {
      const length = unicodeCodePointLength(value)
      return length >= minimum && length <= maximum
    },
    `string must contain ${minimum} to ${maximum} Unicode code points`
  )
}
