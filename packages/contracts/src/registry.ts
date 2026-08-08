import type { JsonSchema, Schema } from './schema'
import { ADVX_JSON_SCHEMA_DIALECT } from './versions'

export type SchemaReference = {
  readonly $ref: string
}

export type JsonSchemaRegistryDocument = {
  readonly $schema: typeof ADVX_JSON_SCHEMA_DIALECT
  readonly $defs: Readonly<Record<string, JsonSchema>>
}

export type OpenApiSchemaComponents = {
  readonly schemas: Readonly<Record<string, JsonSchema>>
}

export class SchemaRegistry {
  readonly #schemas = new Map<string, Schema<unknown>>()

  register(name: string, schema: Schema<unknown>): this {
    assertSchemaName(name)
    if (this.#schemas.has(name)) {
      throw new Error(`Schema "${name}" is already registered`)
    }
    this.#schemas.set(name, schema)
    return this
  }

  get(name: string): Schema<unknown> {
    const schema = this.#schemas.get(name)
    if (schema === undefined) throw new Error(`Schema "${name}" is not registered`)
    return schema
  }

  jsonSchemaReference(name: string): SchemaReference {
    this.get(name)
    return { $ref: `#/$defs/${name}` }
  }

  openApiReference(name: string): SchemaReference {
    this.get(name)
    return { $ref: `#/components/schemas/${name}` }
  }

  toJsonSchemaDocument(): JsonSchemaRegistryDocument {
    return {
      $schema: ADVX_JSON_SCHEMA_DIALECT,
      $defs: this.sortedSchemas()
    }
  }

  toOpenApiComponents(): OpenApiSchemaComponents {
    return { schemas: this.sortedSchemas() }
  }

  private sortedSchemas(): Readonly<Record<string, JsonSchema>> {
    return Object.fromEntries(
      [...this.#schemas.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, schema]) => [name, schema.jsonSchema])
    )
  }
}

export function createSchemaRegistry(
  entries: readonly (readonly [string, Schema<unknown>])[] = []
): SchemaRegistry {
  const registry = new SchemaRegistry()
  for (const [name, schema] of entries) registry.register(name, schema)
  return registry
}

function assertSchemaName(name: string): void {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Invalid schema name "${name}"`)
  }
}
