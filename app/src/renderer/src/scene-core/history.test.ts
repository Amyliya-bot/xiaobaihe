import { describe, expect, it } from 'vitest'
import { commitHistory, createHistory, redoHistory, undoHistory } from './history'

describe('scene history', () => {
  it('supports multiple undo and redo steps', () => {
    let history = createHistory({ count: 0 })
    history = commitHistory(history, { count: 1 })
    history = commitHistory(history, { count: 2 })

    history = undoHistory(history)
    expect(history.present.count).toBe(1)
    history = undoHistory(history)
    expect(history.present.count).toBe(0)
    history = redoHistory(history)
    expect(history.present.count).toBe(1)
  })

  it('clears redo states after a new change', () => {
    let history = createHistory({ count: 0 })
    history = commitHistory(history, { count: 1 })
    history = undoHistory(history)
    history = commitHistory(history, { count: 8 })

    expect(redoHistory(history).present.count).toBe(8)
  })
})
