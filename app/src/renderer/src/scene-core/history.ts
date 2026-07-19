export interface HistoryState<T> {
  past: T[]
  present: T
  future: T[]
}

const historyLimit = 100

export function createHistory<T>(initialState: T): HistoryState<T> {
  return { past: [], present: initialState, future: [] }
}

export function commitHistory<T>(history: HistoryState<T>, nextState: T): HistoryState<T> {
  if (Object.is(history.present, nextState)) return history

  return {
    past: [...history.past, history.present].slice(-historyLimit),
    present: nextState,
    future: []
  }
}

export function undoHistory<T>(history: HistoryState<T>): HistoryState<T> {
  const previous = history.past.at(-1)
  if (previous === undefined) return history

  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future]
  }
}

export function redoHistory<T>(history: HistoryState<T>): HistoryState<T> {
  const next = history.future[0]
  if (next === undefined) return history

  return {
    past: [...history.past, history.present].slice(-historyLimit),
    present: next,
    future: history.future.slice(1)
  }
}
