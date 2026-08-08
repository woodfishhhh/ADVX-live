export type JsonPrimitive = string | number | boolean | null
export type SafeJsonValue =
  | JsonPrimitive
  | readonly SafeJsonValue[]
  | { readonly [key: string]: SafeJsonValue }

export type JsonSchema = {
  readonly [key: string]: unknown
}

export type SchemaIssue = {
  readonly path: readonly (string | number)[]
  readonly message: string
}

export type SafeParseResult<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly issues: readonly SchemaIssue[] }

export type Schema<T> = {
  readonly jsonSchema: JsonSchema
  check(value: unknown): value is T
  safeParse(value: unknown): SafeParseResult<T>
  parse(value: unknown): T
}

export type InferSchema<TSchema extends Schema<unknown>> =
  TSchema extends Schema<infer T> ? T : never

type ParseResult<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly issues: readonly SchemaIssue[] }

type Parser<T> = (
  value: unknown,
  path: readonly (string | number)[]
) => ParseResult<T>

type StringOptions = {
  readonly minLength?: number
  readonly maxLength?: number
  readonly pattern?: string
  readonly format?: string
  readonly description?: string
}

type NumberOptions = {
  readonly minimum?: number
  readonly maximum?: number
  readonly description?: string
}

type ArrayOptions = {
  readonly minItems?: number
  readonly maxItems?: number
  readonly description?: string
}

type ObjectOptions = {
  readonly title?: string
  readonly description?: string
}

type RecordOptions = {
  readonly minProperties?: number
  readonly maxProperties?: number
  readonly keyPattern?: string
  readonly description?: string
}

type SafeJsonOptions = {
  readonly maxDepth?: number
  readonly maxArrayItems?: number
  readonly maxObjectKeys?: number
  readonly maxStringLength?: number
  readonly forbiddenKeyPattern?: string
  readonly description?: string
}

const optionalMarker = Symbol('advx.optional-schema')

export type OptionalSchema<T> = Schema<T | undefined> & {
  readonly [optionalMarker]: true
  readonly inner: Schema<T>
}

type ObjectProperties = Readonly<Record<string, Schema<unknown>>>
type OptionalKeys<TProperties extends ObjectProperties> = {
  [TKey in keyof TProperties]: TProperties[TKey] extends OptionalSchema<unknown>
    ? TKey
    : never
}[keyof TProperties]
type RequiredKeys<TProperties extends ObjectProperties> = Exclude<
  keyof TProperties,
  OptionalKeys<TProperties>
>
type ObjectOutput<TProperties extends ObjectProperties> = {
  [TKey in RequiredKeys<TProperties>]: InferSchema<TProperties[TKey]>
} & {
  [TKey in OptionalKeys<TProperties>]?: TProperties[TKey] extends OptionalSchema<
    infer TValue
  >
    ? TValue
    : never
}

export class SchemaParseError extends Error {
  readonly issues: readonly SchemaIssue[]

  constructor(issues: readonly SchemaIssue[]) {
    super(issues.map(formatIssue).join('; '))
    this.name = 'SchemaParseError'
    this.issues = issues
  }
}

class RuntimeSchema<T> implements Schema<T> {
  readonly jsonSchema: JsonSchema
  readonly #parser: Parser<T>

  constructor(jsonSchema: JsonSchema, parser: Parser<T>) {
    this.jsonSchema = deepFreeze(jsonSchema)
    this.#parser = parser
  }

  check(value: unknown): value is T {
    return this.#parser(value, []).success
  }

  safeParse(value: unknown): SafeParseResult<T> {
    return this.#parser(value, [])
  }

  parse(value: unknown): T {
    const result = this.safeParse(value)
    if (!result.success) throw new SchemaParseError(result.issues)
    return result.data
  }
}

function define<T>(jsonSchema: JsonSchema, parser: Parser<T>): Schema<T> {
  return new RuntimeSchema(jsonSchema, parser)
}

function issue(
  path: readonly (string | number)[],
  message: string
): { readonly success: false; readonly issues: readonly SchemaIssue[] } {
  return { success: false, issues: [{ path, message }] }
}

function string(options: StringOptions = {}): Schema<string> {
  const jsonSchema: JsonSchema = { type: 'string', ...options }
  let expression: RegExp | undefined
  if (options.pattern !== undefined) expression = new RegExp(options.pattern)
  return define(jsonSchema, (value, path) => {
    if (typeof value !== 'string') return issue(path, 'Expected string')
    const length = Array.from(value).length
    if (options.minLength !== undefined && length < options.minLength) {
      return issue(path, `Expected at least ${options.minLength} characters`)
    }
    if (options.maxLength !== undefined && length > options.maxLength) {
      return issue(path, `Expected at most ${options.maxLength} characters`)
    }
    if (expression !== undefined && !expression.test(value)) {
      return issue(path, `Expected string to match ${options.pattern}`)
    }
    return { success: true, data: value }
  })
}

function number(options: NumberOptions = {}): Schema<number> {
  return numericSchema('number', options, false)
}

function integer(options: NumberOptions = {}): Schema<number> {
  return numericSchema('integer', options, true)
}

function numericSchema(
  type: 'number' | 'integer',
  options: NumberOptions,
  integersOnly: boolean
): Schema<number> {
  return define({ type, ...options }, (value, path) => {
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      (integersOnly && !Number.isInteger(value))
    ) {
      return issue(path, `Expected finite ${type}`)
    }
    if (options.minimum !== undefined && value < options.minimum) {
      return issue(path, `Expected number greater than or equal to ${options.minimum}`)
    }
    if (options.maximum !== undefined && value > options.maximum) {
      return issue(path, `Expected number less than or equal to ${options.maximum}`)
    }
    return { success: true, data: value }
  })
}

function boolean(): Schema<boolean> {
  return define({ type: 'boolean' }, (value, path) =>
    typeof value === 'boolean'
      ? { success: true, data: value }
      : issue(path, 'Expected boolean')
  )
}

function literal<TValue extends JsonPrimitive>(value: TValue): Schema<TValue> {
  return define({ const: value }, (candidate, path) =>
    Object.is(candidate, value)
      ? { success: true, data: value }
      : issue(path, `Expected literal ${JSON.stringify(value)}`)
  )
}

function enumeration<const TValues extends readonly [JsonPrimitive, ...JsonPrimitive[]]>(
  values: TValues
): Schema<TValues[number]> {
  const accepted = new Set<JsonPrimitive>(values)
  return define({ enum: [...values] }, (value, path) =>
    accepted.has(value as JsonPrimitive)
      ? { success: true, data: value as TValues[number] }
      : issue(path, `Expected one of ${values.map(String).join(', ')}`)
  )
}

function optional<T>(inner: Schema<T>): OptionalSchema<T> {
  const optionalSchema = define<T | undefined>(inner.jsonSchema, (value, path) =>
    value === undefined
      ? { success: true, data: undefined }
      : parseWith(inner, value, path)
  ) as OptionalSchema<T>
  Object.defineProperties(optionalSchema, {
    [optionalMarker]: { value: true },
    inner: { value: inner, enumerable: true }
  })
  return optionalSchema
}

function object<const TProperties extends ObjectProperties>(
  properties: TProperties,
  options: ObjectOptions = {}
): Schema<ObjectOutput<TProperties>> {
  const required = Object.entries(properties)
    .filter(([, property]) => !isOptional(property))
    .map(([key]) => key)
  const jsonProperties = Object.fromEntries(
    Object.entries(properties).map(([key, property]) => [
      key,
      isOptional(property) ? property.inner.jsonSchema : property.jsonSchema
    ])
  )
  return define(
    {
      type: 'object',
      properties: jsonProperties,
      required,
      additionalProperties: false,
      ...options
    },
    (value, path) => {
      if (!isPlainObject(value)) return issue(path, 'Expected object')
      const unknownKeys = Object.keys(value).filter(
        (key) => !Object.hasOwn(properties, key)
      )
      if (unknownKeys.length > 0) {
        return {
          success: false,
          issues: unknownKeys.map((key) => ({
            path: [...path, key],
            message: 'Unknown object key'
          }))
        }
      }
      const output: Record<string, unknown> = {}
      const issues: SchemaIssue[] = []
      for (const [key, property] of Object.entries(properties)) {
        if (!Object.hasOwn(value, key)) {
          if (!isOptional(property)) {
            issues.push({ path: [...path, key], message: 'Required value is missing' })
          }
          continue
        }
        const result = parseWith(property, value[key], [...path, key])
        if (result.success) output[key] = result.data
        else issues.push(...result.issues)
      }
      return issues.length > 0
        ? { success: false, issues }
        : { success: true, data: output as ObjectOutput<TProperties> }
    }
  )
}

function array<TItem>(
  item: Schema<TItem>,
  options: ArrayOptions = {}
): Schema<TItem[]> {
  return define({ type: 'array', items: item.jsonSchema, ...options }, (value, path) => {
    if (!Array.isArray(value)) return issue(path, 'Expected array')
    if (options.minItems !== undefined && value.length < options.minItems) {
      return issue(path, `Expected at least ${options.minItems} items`)
    }
    if (options.maxItems !== undefined && value.length > options.maxItems) {
      return issue(path, `Expected at most ${options.maxItems} items`)
    }
    const output: TItem[] = []
    const issues: SchemaIssue[] = []
    value.forEach((candidate, index) => {
      const result = parseWith(item, candidate, [...path, index])
      if (result.success) output.push(result.data)
      else issues.push(...result.issues)
    })
    return issues.length > 0
      ? { success: false, issues }
      : { success: true, data: output }
  })
}

function union<const TMembers extends readonly [Schema<unknown>, ...Schema<unknown>[]]>(
  members: TMembers
): Schema<InferSchema<TMembers[number]>> {
  return define({ oneOf: members.map((member) => member.jsonSchema) }, (value, path) => {
    for (const member of members) {
      const result = parseWith(member, value, path)
      if (result.success) {
        return { success: true, data: result.data as InferSchema<TMembers[number]> }
      }
    }
    return issue(path, 'Expected value to match one union member')
  })
}

function nullable<T>(inner: Schema<T>): Schema<T | null> {
  return union([inner, literal(null)])
}

function record<TValue>(
  valueSchema: Schema<TValue>,
  options: RecordOptions = {}
): Schema<Record<string, TValue>> {
  const keyExpression =
    options.keyPattern === undefined ? undefined : new RegExp(options.keyPattern)
  return define(
    {
      type: 'object',
      additionalProperties: valueSchema.jsonSchema,
      ...(options.minProperties === undefined
        ? {}
        : { minProperties: options.minProperties }),
      ...(options.maxProperties === undefined
        ? {}
        : { maxProperties: options.maxProperties }),
      ...(options.keyPattern === undefined
        ? {}
        : { propertyNames: { pattern: options.keyPattern } }),
      ...(options.description === undefined
        ? {}
        : { description: options.description })
    },
    (value, path) => {
      if (!isPlainObject(value)) return issue(path, 'Expected object')
      const entries = Object.entries(value)
      if (
        options.minProperties !== undefined &&
        entries.length < options.minProperties
      ) {
        return issue(path, `Expected at least ${options.minProperties} properties`)
      }
      if (
        options.maxProperties !== undefined &&
        entries.length > options.maxProperties
      ) {
        return issue(path, `Expected at most ${options.maxProperties} properties`)
      }
      const output: Record<string, TValue> = {}
      const issues: SchemaIssue[] = []
      for (const [key, candidate] of entries) {
        if (keyExpression !== undefined && !keyExpression.test(key)) {
          issues.push({ path: [...path, key], message: 'Invalid record key' })
          continue
        }
        const result = parseWith(valueSchema, candidate, [...path, key])
        if (result.success) output[key] = result.data
        else issues.push(...result.issues)
      }
      return issues.length > 0
        ? { success: false, issues }
        : { success: true, data: output }
    }
  )
}

function refine<T>(
  inner: Schema<T>,
  predicate: (value: T) => boolean,
  message: string,
  description?: string
): Schema<T> {
  return define(
    {
      ...inner.jsonSchema,
      ...(description === undefined ? {} : { description }),
      'x-advx-refinement': message
    },
    (value, path) => {
      const result = parseWith(inner, value, path)
      if (!result.success) return result
      return predicate(result.data) ? result : issue(path, message)
    }
  )
}

function safeJson(options: SafeJsonOptions = {}): Schema<SafeJsonValue> {
  const limits = {
    maxDepth: options.maxDepth ?? 8,
    maxArrayItems: options.maxArrayItems ?? 256,
    maxObjectKeys: options.maxObjectKeys ?? 256,
    maxStringLength: options.maxStringLength ?? 16_384
  }
  const forbidden = new RegExp(
    options.forbiddenKeyPattern ??
      '(^|_)(api[_-]?key|authorization|credential|password|secret|token|raw[_-]?(image|audio))($|_)',
    'i'
  )
  return define(
    {
      oneOf: [
        { type: 'null' },
        { type: 'boolean' },
        { type: 'number' },
        { type: 'string', maxLength: limits.maxStringLength },
        { type: 'array', maxItems: limits.maxArrayItems },
        { type: 'object', maxProperties: limits.maxObjectKeys }
      ],
      description:
        options.description ??
        'Bounded redacted JSON; credentials and raw image/audio fields are forbidden',
      'x-advx-max-depth': limits.maxDepth,
      'x-advx-forbidden-key-pattern': forbidden.source
    },
    (value, path) => parseSafeJson(value, path, 0, limits, forbidden)
  )
}

function parseSafeJson(
  value: unknown,
  path: readonly (string | number)[],
  depth: number,
  limits: {
    readonly maxDepth: number
    readonly maxArrayItems: number
    readonly maxObjectKeys: number
    readonly maxStringLength: number
  },
  forbidden: RegExp
): ParseResult<SafeJsonValue> {
  if (value === null || typeof value === 'boolean') {
    return { success: true, data: value }
  }
  if (typeof value === 'number') {
    return Number.isFinite(value)
      ? { success: true, data: value }
      : issue(path, 'Expected finite JSON number')
  }
  if (typeof value === 'string') {
    return value.length <= limits.maxStringLength
      ? { success: true, data: value }
      : issue(path, `Expected at most ${limits.maxStringLength} characters`)
  }
  if (depth >= limits.maxDepth) return issue(path, 'Safe JSON depth exceeded')
  if (Array.isArray(value)) {
    if (value.length > limits.maxArrayItems) {
      return issue(path, `Expected at most ${limits.maxArrayItems} items`)
    }
    const output: SafeJsonValue[] = []
    const issues: SchemaIssue[] = []
    value.forEach((candidate, index) => {
      const result = parseSafeJson(
        candidate,
        [...path, index],
        depth + 1,
        limits,
        forbidden
      )
      if (result.success) output.push(result.data)
      else issues.push(...result.issues)
    })
    return issues.length > 0
      ? { success: false, issues }
      : { success: true, data: output }
  }
  if (!isPlainObject(value)) return issue(path, 'Expected JSON value')
  const entries = Object.entries(value)
  if (entries.length > limits.maxObjectKeys) {
    return issue(path, `Expected at most ${limits.maxObjectKeys} properties`)
  }
  const output: Record<string, SafeJsonValue> = {}
  const issues: SchemaIssue[] = []
  for (const [key, candidate] of entries) {
    if (forbidden.test(key)) {
      issues.push({ path: [...path, key], message: 'Forbidden sensitive JSON key' })
      continue
    }
    const result = parseSafeJson(
      candidate,
      [...path, key],
      depth + 1,
      limits,
      forbidden
    )
    if (result.success) output[key] = result.data
    else issues.push(...result.issues)
  }
  return issues.length > 0
    ? { success: false, issues }
    : { success: true, data: output }
}

function parseWith<T>(
  schema: Schema<T>,
  value: unknown,
  path: readonly (string | number)[]
): ParseResult<T> {
  const result = schema.safeParse(value)
  if (result.success) return result
  return {
    success: false,
    issues: result.issues.map((entry) => ({
      path: [...path, ...entry.path],
      message: entry.message
    }))
  }
}

function isOptional(schema: Schema<unknown>): schema is OptionalSchema<unknown> {
  return optionalMarker in schema
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function formatIssue(issue: SchemaIssue): string {
  const path =
    issue.path.length === 0
      ? '$'
      : `$${issue.path
          .map((part) => (typeof part === 'number' ? `[${part}]` : `.${part}`))
          .join('')}`
  return `${path}: ${issue.message}`
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

export const schema = {
  string,
  number,
  integer,
  boolean,
  literal,
  enum: enumeration,
  optional,
  object,
  array,
  union,
  nullable,
  record,
  refine,
  safeJson
} as const
