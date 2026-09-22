type Turn = {
  engineModel?: string
  decision: Promise<string | undefined>
}

export class Turns {
  private readonly turns = new Map<string, Turn>()

  start(turnId: string, decision: Promise<string | undefined>): void {
    this.turns.set(turnId, { decision })
  }

  async resolveStep(step: { turnId: string; index: number; model: string }): Promise<string | undefined> {
    const turn = this.turns.get(step.turnId)
    if (turn === undefined) return undefined
    if (turn.engineModel === undefined && step.index === 0) turn.engineModel = step.model
    if (turn.engineModel === undefined) return undefined
    const id = await turn.decision
    return step.model === turn.engineModel ? id : undefined
  }

  complete(turnId: string): void {
    this.turns.delete(turnId)
  }

  get size(): number {
    return this.turns.size
  }
}
