import type { CacheEntry, RiskLevel } from "./types"

export class ScopeCache {
  private store = new Map<string, CacheEntry>()

  get(key: string): CacheEntry | undefined {
    return this.store.get(key)
  }

  set(key: string, entry: CacheEntry): void {
    this.store.set(key, entry)
  }

  approve(key: string): boolean {
    const entry = this.store.get(key)
    if (!entry) return false
    entry.approved = true
    entry.approvedAt = Date.now()
    return true
  }

  revoke(key: string): boolean {
    return this.store.delete(key)
  }

  reset(): void {
    this.store.clear()
  }

  entries(): [string, CacheEntry][] {
    return Array.from(this.store.entries())
  }

  stats(): { total: number; approved: number; blocked: number } {
    let approved = 0
    let blocked = 0
    for (const entry of this.store.values()) {
      if (entry.approved) approved++
      else blocked++
    }
    return { total: this.store.size, approved, blocked }
  }
}
