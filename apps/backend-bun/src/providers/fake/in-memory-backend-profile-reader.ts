import type { BackendProfileReader } from '../../application'
import type { BackendProfile } from '../../domain'

export class InMemoryBackendProfileReader implements BackendProfileReader {
  readCount = 0

  constructor(private readonly profile: BackendProfile) {}

  read(): BackendProfile {
    this.readCount += 1
    return this.profile
  }
}
