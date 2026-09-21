import type { Model } from './config'

export function selectCandidates(
  models: readonly Model[],
  contextTokens: number | undefined,
): Model[] {
  if (contextTokens === undefined) return [...models]
  return models.filter((m) => m.contextWindow >= contextTokens)
}
