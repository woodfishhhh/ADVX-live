import type { BackendProfileReader } from '../application'
import type { BackendProfile } from '../domain'

const backendProfile: BackendProfile = {
  name: '@advx/backend-bun',
  runtime: 'bun'
}

export class StaticBackendProfileReader implements BackendProfileReader {
  read(): BackendProfile {
    return backendProfile
  }
}
