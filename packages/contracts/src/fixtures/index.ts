import type { InferSchema, Schema, SchemaIssue } from '../schema'

export function defineValidFixture<TSchema extends Schema<unknown>>(
  schema: TSchema,
  value: unknown
): InferSchema<TSchema> {
  return schema.parse(value) as InferSchema<TSchema>
}

export function collectInvalidFixtureIssues(
  schema: Schema<unknown>,
  value: unknown
): readonly SchemaIssue[] {
  const result = schema.safeParse(value)
  if (result.success) throw new Error('Expected fixture to fail schema validation')
  return result.issues
}
