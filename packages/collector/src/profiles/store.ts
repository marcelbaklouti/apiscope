import type { FlameNode } from '@apiscope/core'

export interface StoredProfile {
  id: string
  appName: string
  capturedAt: number
  flamegraph: FlameNode
  pprofBase64: string
}

const MAX_STORED_PROFILES = 50

export class ProfileResultStore {
  private readonly profilesById = new Map<string, StoredProfile>()

  put(profile: StoredProfile): void {
    this.profilesById.set(profile.id, profile)
    if (this.profilesById.size > MAX_STORED_PROFILES) {
      const oldestId = this.profilesById.keys().next().value
      if (oldestId !== undefined) this.profilesById.delete(oldestId)
    }
  }

  get(id: string): StoredProfile | null {
    return this.profilesById.get(id) ?? null
  }
}
