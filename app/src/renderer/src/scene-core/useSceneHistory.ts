import { useCallback, useState } from 'react'
import { commitHistory, createHistory, redoHistory, undoHistory } from './history'
import { createInitialScene, type SceneState } from './scene'

export interface SceneHistoryController {
  scene: SceneState
  canUndo: boolean
  canRedo: boolean
  commit: (update: (scene: SceneState) => SceneState) => void
  undo: () => void
  redo: () => void
  reset: (scene?: SceneState) => void
}

export function useSceneHistory(): SceneHistoryController {
  const [history, setHistory] = useState(() => createHistory(createInitialScene()))

  const commit = useCallback((update: (scene: SceneState) => SceneState): void => {
    setHistory((current) => commitHistory(current, update(current.present)))
  }, [])

  const undo = useCallback((): void => setHistory((current) => undoHistory(current)), [])
  const redo = useCallback((): void => setHistory((current) => redoHistory(current)), [])
  const reset = useCallback(
    (scene: SceneState = createInitialScene()): void => setHistory(createHistory(scene)),
    []
  )

  return {
    scene: history.present,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    commit,
    undo,
    redo,
    reset
  }
}
