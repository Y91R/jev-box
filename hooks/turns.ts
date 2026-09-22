type Turn = {
  engineModel?: string
  decision: Promise<string | undefined>
}

export type StepReason = 'switched' | 'fallback' | 'no_decision' | 'step0_missing' | 'unknown_turn'

export type StepResolution = { id?: string; reason: StepReason }

export class Turns {
  private readonly turns = new Map<string, Turn>()

  start(turnId: string, decision: Promise<string | undefined>): void {
    this.turns.set(turnId, { decision })
  }

  async resolveStep(step: { turnId: string; index: number; model: string }): Promise<StepResolution> {
    const turn = this.turns.get(step.turnId)
    if (turn === undefined) return { reason: 'unknown_turn' }
    if (turn.engineModel === undefined && step.index === 0) turn.engineModel = step.model
    if (turn.engineModel === undefined) return { reason: 'step0_missing' }
    const id = await turn.decision
    if (id === undefined) return { reason: 'no_decision' }
    if (step.model !== turn.engineModel) return { reason: 'fallback' }
    return { id, reason: 'switched' }
  }

  complete(turnId: string): void {
    this.turns.delete(turnId)
  }

  get size(): number {
    return this.turns.size
  }
}
