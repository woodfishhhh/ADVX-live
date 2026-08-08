import type { BackendProfile } from '../../domain'

export interface BackendProfileReader {
  read(): BackendProfile
}
