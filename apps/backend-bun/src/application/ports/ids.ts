export interface IdGenerator<TId extends string> {
  nextId(): TId
}
