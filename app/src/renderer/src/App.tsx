import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  ArrowDownToLine,
  Box,
  BrickWall,
  Camera,
  Check,
  ChevronDown,
  ChevronUp,
  Circle,
  CircleDot,
  CircleHelp,
  Clock3,
  Copy,
  Download,
  Eye,
  EyeOff,
  Film,
  FilePlus2,
  Focus,
  FolderOpen,
  Group,
  HardDrive,
  History,
  Images,
  Lightbulb,
  Lock,
  LockOpen,
  Magnet,
  Maximize2,
  Monitor,
  Moon,
  Move3d,
  PackageOpen,
  PanelTop,
  Pause,
  Pencil,
  PersonStanding,
  Play,
  Plus,
  Redo2,
  Rotate3d,
  Route,
  Save,
  SaveAll,
  ScanSearch,
  Scaling,
  Scissors,
  Shapes,
  Sun,
  Trash2,
  Undo2,
  Ungroup,
  Upload,
  X
} from 'lucide-react'
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { APP_NAME, APP_VERSION } from '../../shared/app-meta'
import type {
  ExportModelFormat,
  OpenProjectResult,
  RecentProjectEntry,
  RecoverySnapshot
} from '../../shared/desktop-api'
import { PLATFORM_PROFILE_RULES, validateVideoProfile } from '../../shared/platform-profiles'
import {
  createProjectDocument,
  type BasicPrimitiveKind,
  type CameraState,
  type CameraTransition,
  type MannequinJointId,
  type MannequinPose,
  type MannequinPresetId,
  type MeshCutData,
  type ObjectDisplayMode,
  type ObjectInterpolation,
  type PrimitiveKind,
  type ProjectDocument,
  type SceneLightData,
  type SceneLightKind,
  type SceneLightingState,
  type SceneObjectData,
  type TimelineState,
  type Vector3Value
} from '../../shared/project-document'
import SceneViewport, {
  type CutAxis,
  type ObjectTransformBatchUpdate,
  type SceneViewportHandle,
  type TransformMode
} from './components/SceneViewport'
import {
  closeModelingDraft,
  createSurfaceModelingDraft,
  createSurfaceModelingDraftFromPlane,
  draftFromCustomObject,
  extrudeModelingFace,
  finalizeModelingDraft,
  type CanvasModelingDraft,
  type MeshElementMode,
  type ModelingPlaneMode,
  type SketchPlane
} from './scene-core/canvas-modeling'
import {
  alignObjects,
  distributeObjects,
  placeNewObject,
  placeOnGround,
  snapSelectionToObjectEdges
} from './scene-core/layout'
import { inspectSceneQuality, type SceneQualityReport } from './scene-core/quality'
import { objectLocalBounds } from './scene-core/geometry'
import { faceColorKey } from './scene-core/face-paint'
import {
  quickBuildMeasurement,
  quickBuildTransform,
  type QuickBuildDraft,
  type QuickBuildKind
} from './scene-core/quick-build'
import {
  cloneSceneObject,
  createCustomSceneObject,
  createImportedSceneObject,
  createInitialScene,
  createSceneLight,
  createMannequinSceneObject,
  createSceneObject
} from './scene-core/scene'
import {
  MANNEQUIN_JOINTS,
  MANNEQUIN_PRESETS,
  cloneMannequinPose,
  constrainMannequinJoint,
  mannequinJointLabel
} from './mannequin/mannequin'
import type { LightweightPreviewReport } from './optimizer/lightweight-preview'
import { assessModelPerformanceRisk } from './optimizer/performance-risk'
import { useSceneHistory } from './scene-core/useSceneHistory'
import {
  duplicateCameraShot,
  evaluateCameraShots,
  moveCameraShot,
  sortedCameraShots,
  updateCameraShotTransition,
  upsertCameraShot
} from './timeline/camera-timeline'
import {
  evaluateTimelineAtTime,
  evaluateTimelineFrame,
  timeToFrameIndex
} from './timeline/frame-state'
import {
  applyObjectKeyframePreview,
  duplicateObjectKeyframe,
  evaluateObjectKeyframes,
  moveObjectKeyframe,
  sortedObjectKeyframes,
  updateObjectKeyframeInterpolation,
  upsertObjectKeyframe
} from './timeline/object-timeline'
import { snapTimelineTime, TIMELINE_FRAME_RATE } from './timeline/timeline-edit'
import { createVideoFramePlan } from './video/frame-plan'
import { canEncodeH264Video, createMp4VideoEncoder } from './video/mp4-video-encoder'
import { outputSize } from './video/output-size'

type Theme = 'light' | 'dark'
type Notice = { kind: 'success' | 'error' | 'info'; message: string }
type ObjectMenu = { objectId: string; x: number; y: number }
type PendingAction = 'new' | 'open' | 'open-recent' | 'close'
type AutosaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error'
type InspectorTarget = 'selection' | 'camera' | 'ambient' | 'light'
type CameraViewMode = 'none' | 'monitor' | 'fullscreen'
type ImageExportFormat = 'png' | 'jpg'
type WorkspaceMode = 'scene' | 'camera' | 'animation'
type MannequinEditMode = 'placement' | 'pose'
type ModelingHistoryState = {
  past: CanvasModelingDraft[]
  future: CanvasModelingDraft[]
}
type CutKeepMode = 'both' | 'positive' | 'negative'
type PaintScope = 'object' | 'face'
type TimelineMarkerKind = 'camera' | 'object'
type TimelineMarkerDrag = {
  kind: TimelineMarkerKind
  id: string
  pointerId: number
  startTimeSeconds: number
  timeSeconds: number
  moved: boolean
}
type ImageSequenceProgress = {
  current: number
  total: number
  directoryPath: string
  cancelling: boolean
}
type VideoExportProgress = {
  current: number
  total: number
  filePath: string
  cancelling: boolean
}
type CutToolState = {
  objectId: string
  axis: CutAxis
  offset: number
  keep: CutKeepMode
}

const themeStorageKey = 'whitebox-studio-theme'
const onboardingStorageKey = 'whitebox-studio-onboarding-complete-v1'
const vectorAxes: Array<keyof Vector3Value> = ['x', 'y', 'z']
const axisLabels: Record<keyof Vector3Value, string> = {
  x: '左右 X',
  y: '高度 Y',
  z: '前后 Z'
}
const rotationAxisLabels: Record<keyof Vector3Value, string> = {
  x: '前后倾 X',
  y: '左右转 Y',
  z: '侧倾 Z'
}
const displayModeLabels: Record<ObjectDisplayMode, string> = {
  solid: '实体显示',
  transparent: '半透明显示',
  wireframe: '线框显示'
}
const videoVerificationLabels = {
  generic: '通用建议',
  partial: '部分核对',
  'official-format': '官方格式',
  official: '官方规则'
} as const

function readStoredTheme(): Theme {
  return window.localStorage.getItem(themeStorageKey) === 'dark' ? 'dark' : 'light'
}

function shouldShowOnboarding(): boolean {
  return window.localStorage.getItem(onboardingStorageKey) !== 'true'
}

function formatLocalDateTime(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '时间未知'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date)
}

function formatFileSize(value: number | undefined): string {
  if (!Number.isFinite(value) || value === undefined || value < 0) return '大小未知'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function cloneCamera(camera: CameraState): CameraState {
  return {
    position: { ...camera.position },
    target: { ...camera.target },
    fovDegrees: camera.fovDegrees,
    aspectWidth: camera.aspectWidth,
    aspectHeight: camera.aspectHeight
  }
}

function sceneFingerprint(
  objects: SceneObjectData[],
  camera: CameraState,
  lighting: SceneLightingState,
  timeline: TimelineState
): string {
  const round = (value: number): number => Math.round(value * 1_000_000) / 1_000_000
  return JSON.stringify({
    objects,
    camera: {
      position: {
        x: round(camera.position.x),
        y: round(camera.position.y),
        z: round(camera.position.z)
      },
      target: {
        x: round(camera.target.x),
        y: round(camera.target.y),
        z: round(camera.target.z)
      },
      fovDegrees: round(camera.fovDegrees),
      aspectWidth: round(camera.aspectWidth),
      aspectHeight: round(camera.aspectHeight)
    },
    lighting,
    timeline
  })
}

function cameraFingerprint(camera: CameraState): string {
  return JSON.stringify(camera)
}

function objectIcon(kind: PrimitiveKind): React.JSX.Element {
  if (kind === 'cylinder') return <CircleDot aria-hidden="true" />
  if (kind === 'sphere') return <Circle aria-hidden="true" />
  if (kind === 'wall') return <BrickWall aria-hidden="true" />
  if (kind === 'floor') return <PanelTop aria-hidden="true" />
  if (kind === 'mannequin') return <PersonStanding aria-hidden="true" />
  return <Box aria-hidden="true" />
}

interface CommandButtonProps {
  label: string
  children: React.ReactNode
  disabled?: boolean
  active?: boolean
  text?: string
  onClick?: () => void
}

function CommandButton({
  label,
  children,
  disabled = false,
  active = false,
  text,
  onClick
}: CommandButtonProps): React.JSX.Element {
  return (
    <button
      className={`icon-button${text ? ' has-text' : ''}${active ? ' is-active' : ''}`}
      type="button"
      aria-label={label}
      title={disabled ? `${label}（当前不可用）` : label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
      {text ? <span>{text}</span> : null}
    </button>
  )
}

interface CommitNumberInputProps {
  label: string
  value: number
  disabled?: boolean
  minimum?: number
  maximum?: number
  suffix?: string
  onCommit: (value: number) => void
}

function CommitNumberInput({
  label,
  value,
  disabled = false,
  minimum,
  maximum,
  suffix = '',
  onCommit
}: CommitNumberInputProps): React.JSX.Element {
  const [draft, setDraft] = useState(value.toFixed(2))

  const commit = (): void => {
    const parsed = Number(draft)
    if (!Number.isFinite(parsed)) {
      setDraft(value.toFixed(2))
      return
    }
    const minimumValue = minimum === undefined ? parsed : Math.max(parsed, minimum)
    const nextValue = maximum === undefined ? minimumValue : Math.min(minimumValue, maximum)
    setDraft(nextValue.toFixed(2))
    if (nextValue !== value) onCommit(nextValue)
  }

  return (
    <input
      aria-label={label}
      value={`${draft}${suffix}`}
      disabled={disabled}
      inputMode="decimal"
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setDraft(event.target.value.replace(suffix, ''))}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') {
          setDraft(value.toFixed(2))
          event.currentTarget.blur()
        }
      }}
    />
  )
}

interface CommitRangeInputProps {
  label: string
  value: number
  minimum: number
  maximum: number
  step: number
  disabled?: boolean
  onPreview?: (value: number) => void
  onPreviewEnd?: () => void
  onCommit: (value: number) => void
}

function CommitRangeInput({
  label,
  value,
  minimum,
  maximum,
  step,
  disabled = false,
  onPreview,
  onPreviewEnd,
  onCommit
}: CommitRangeInputProps): React.JSX.Element {
  const [draft, setDraft] = useState(value)
  const draftRef = useRef(value)
  const committedRef = useRef(value)

  const preview = (nextValue: number): void => {
    const clamped = Math.min(Math.max(nextValue, minimum), maximum)
    draftRef.current = clamped
    setDraft(clamped)
    onPreview?.(clamped)
  }

  const commit = (): void => {
    const nextValue = draftRef.current
    onPreviewEnd?.()
    if (nextValue === committedRef.current) return
    committedRef.current = nextValue
    onCommit(nextValue)
  }

  return (
    <input
      aria-label={label}
      type="range"
      min={minimum}
      max={maximum}
      step={step}
      value={draft}
      disabled={disabled}
      onChange={(event) => preview(Number(event.target.value))}
      onPointerUp={commit}
      onPointerCancel={commit}
      onBlur={commit}
      onKeyUp={(event) => {
        if (
          [
            'ArrowLeft',
            'ArrowRight',
            'ArrowUp',
            'ArrowDown',
            'Home',
            'End',
            'PageUp',
            'PageDown'
          ].includes(event.key)
        ) {
          commit()
        }
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.preventDefault()
        draftRef.current = value
        committedRef.current = value
        setDraft(value)
        onPreview?.(value)
        onPreviewEnd?.()
        event.currentTarget.blur()
      }}
    />
  )
}

interface CommitTextInputProps {
  value: string
  disabled?: boolean
  onCommit: (value: string) => void
}

function CommitTextInput({
  value,
  disabled = false,
  onCommit
}: CommitTextInputProps): React.JSX.Element {
  const [draft, setDraft] = useState(value)

  const commit = (): void => {
    const nextValue = draft.trim() || value
    setDraft(nextValue)
    if (nextValue !== value) onCommit(nextValue)
  }

  return (
    <input
      className="object-name-input"
      aria-label="对象名称"
      value={draft}
      disabled={disabled}
      maxLength={60}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') {
          setDraft(value)
          event.currentTarget.blur()
        }
      }}
    />
  )
}

function App(): React.JSX.Element {
  const sceneHistory = useSceneHistory()
  const [theme, setTheme] = useState<Theme>(readStoredTheme)
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('scene')
  const [onboardingOpen, setOnboardingOpen] = useState(shouldShowOnboarding)
  const [transformMode, setTransformMode] = useState<TransformMode>('translate')
  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    sceneHistory.scene.objects[0]?.id ? [sceneHistory.scene.objects[0].id] : []
  )
  const [selectedMannequinJoint, setSelectedMannequinJoint] = useState<MannequinJointId | null>(
    null
  )
  const [mannequinEditMode, setMannequinEditMode] = useState<MannequinEditMode>('placement')
  const [selectedLightId, setSelectedLightId] = useState<string | null>(null)
  const [inspectorTarget, setInspectorTarget] = useState<InspectorTarget>('selection')
  const [projectName, setProjectName] = useState('未命名场景')
  const [projectPath, setProjectPath] = useState<string | null>(null)
  const [savedFingerprint, setSavedFingerprint] = useState(() =>
    sceneFingerprint(
      sceneHistory.scene.objects,
      sceneHistory.scene.camera,
      sceneHistory.scene.lighting,
      sceneHistory.scene.timeline
    )
  )
  const [notice, setNotice] = useState<Notice | null>(null)
  const [objectMenu, setObjectMenu] = useState<ObjectMenu | null>(null)
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const [pendingRecentPath, setPendingRecentPath] = useState<string | null>(null)
  const [pendingDeleteProject, setPendingDeleteProject] = useState<RecentProjectEntry | null>(null)
  const [recoverySnapshot, setRecoverySnapshot] = useState<RecoverySnapshot | null>(null)
  const [recentProjects, setRecentProjects] = useState<RecentProjectEntry[]>([])
  const [recentProjectsOpen, setRecentProjectsOpen] = useState(false)
  const [recentProjectsLoading, setRecentProjectsLoading] = useState(false)
  const [autosaveState, setAutosaveState] = useState<AutosaveState>('idle')
  const [modelingDraft, setModelingDraft] = useState<CanvasModelingDraft | null>(null)
  const [modelingHistory, setModelingHistory] = useState<ModelingHistoryState>({
    past: [],
    future: []
  })
  const [modelingElementMode, setModelingElementMode] = useState<MeshElementMode>('vertex')
  const [modelingError, setModelingError] = useState<string | null>(null)
  const [quickBuildTool, setQuickBuildTool] = useState<QuickBuildKind | null>(null)
  const [quickBuildDraft, setQuickBuildDraft] = useState<QuickBuildDraft | null>(null)
  const [quickBuildIssue, setQuickBuildIssue] = useState<string | null>(null)
  const [surfacePickObjectId, setSurfacePickObjectId] = useState<string | null>(null)
  const [cutTool, setCutTool] = useState<CutToolState | null>(null)
  const [snappingEnabled, setSnappingEnabled] = useState(true)
  const [paintScope, setPaintScope] = useState<PaintScope>('object')
  const [paintColor, setPaintColor] = useState('#f2f4f3')
  const [cameraViewMode, setCameraViewMode] = useState<CameraViewMode>('none')
  const [firstPersonCameraControl, setFirstPersonCameraControl] = useState(false)
  const [firstPersonHintVisible, setFirstPersonHintVisible] = useState(false)
  const [cameraControlPreview, setCameraControlPreview] = useState<CameraState | null>(null)
  const [lightControlPreview, setLightControlPreview] = useState<{
    id: string
    update: Partial<SceneLightData>
  } | null>(null)
  const [timelineOpen, setTimelineOpen] = useState(false)
  const [timelineTime, setTimelineTime] = useState(0)
  const [selectedShotId, setSelectedShotId] = useState<string | null>(null)
  const [selectedObjectKeyframeId, setSelectedObjectKeyframeId] = useState<string | null>(null)
  const [timelinePreviewCamera, setTimelinePreviewCamera] = useState<CameraState | null>(null)
  const [timelinePreviewObjects, setTimelinePreviewObjects] = useState<ReturnType<
    typeof evaluateObjectKeyframes
  > | null>(null)
  const [timelinePlaying, setTimelinePlaying] = useState(false)
  const [timelineDrag, setTimelineDrag] = useState<TimelineMarkerDrag | null>(null)
  const [groupConfirmationOpen, setGroupConfirmationOpen] = useState(false)
  const [qualityReport, setQualityReport] = useState<SceneQualityReport | null>(null)
  const [exportHubOpen, setExportHubOpen] = useState(false)
  const [imageExportFormat, setImageExportFormat] = useState<ImageExportFormat>('png')
  const [imageExportDimension, setImageExportDimension] = useState(1280)
  const [modelExportOpen, setModelExportOpen] = useState(false)
  const [videoExportOpen, setVideoExportOpen] = useState(false)
  const [selectedVideoProfileId, setSelectedVideoProfileId] = useState('general-ai-720')
  const [busy, setBusy] = useState(false)
  const [imageSequenceProgress, setImageSequenceProgress] = useState<ImageSequenceProgress | null>(
    null
  )
  const [videoExportProgress, setVideoExportProgress] = useState<VideoExportProgress | null>(null)
  const [pendingOptimizationObjectId, setPendingOptimizationObjectId] = useState<string | null>(
    null
  )
  const [optimizationReports, setOptimizationReports] = useState(
    () => new Map<string, LightweightPreviewReport>()
  )
  const viewportRef = useRef<SceneViewportHandle>(null)
  const rightPanelRef = useRef<HTMLElement>(null)
  const objectMenuRef = useRef<HTMLDivElement>(null)
  const modelingDraftRef = useRef<CanvasModelingDraft | null>(null)
  const modelingHistoryRef = useRef<ModelingHistoryState>({ past: [], future: [] })
  const timelineTimeRef = useRef(0)
  const timelineDragRef = useRef<TimelineMarkerDrag | null>(null)
  const imageSequenceCancelRef = useRef(false)
  const videoExportCancelRef = useRef(false)
  const autosaveTimerRef = useRef<number | null>(null)
  const autosaveRevisionRef = useRef(0)
  const recoveryCheckedRef = useRef(false)
  const lastNonDialogFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const rememberFocus = (event: FocusEvent): void => {
      const target = event.target
      if (!(target instanceof HTMLElement) || target.closest('[role="dialog"]')) return
      lastNonDialogFocusRef.current = target
    }
    document.addEventListener('focusin', rememberFocus)
    return () => document.removeEventListener('focusin', rememberFocus)
  }, [])
  const cameraPreview = cameraViewMode === 'fullscreen'
  const cameraMonitor = cameraViewMode === 'monitor'
  const displayedCamera = cameraControlPreview
    ? {
        ...cameraControlPreview,
        aspectWidth: sceneHistory.scene.camera.aspectWidth,
        aspectHeight: sceneHistory.scene.camera.aspectHeight
      }
    : (timelinePreviewCamera ?? sceneHistory.scene.camera)
  const displayedLighting = useMemo(
    () =>
      lightControlPreview
        ? {
            lights: sceneHistory.scene.lighting.lights.map((light) =>
              light.id === lightControlPreview.id
                ? { ...light, ...lightControlPreview.update }
                : light
            )
          }
        : sceneHistory.scene.lighting,
    [lightControlPreview, sceneHistory.scene.lighting]
  )

  const replaceModelingHistory = (history: ModelingHistoryState): void => {
    modelingHistoryRef.current = history
    setModelingHistory(history)
  }

  const resetModelingDraft = (draft: CanvasModelingDraft | null): void => {
    modelingDraftRef.current = draft
    setModelingDraft(draft)
    replaceModelingHistory({ past: [], future: [] })
  }

  const changeModelingDraft = (
    draft: CanvasModelingDraft,
    historyMode: 'push' | 'replace' = 'push'
  ): void => {
    const current = modelingDraftRef.current
    if (historyMode === 'push' && current) {
      replaceModelingHistory({
        past: [...modelingHistoryRef.current.past, structuredClone(current)].slice(-100),
        future: []
      })
    }
    modelingDraftRef.current = draft
    setModelingDraft(draft)
  }

  const undoModelingDraft = (): void => {
    const current = modelingDraftRef.current
    const previous = modelingHistoryRef.current.past.at(-1)
    if (!current || !previous) return
    replaceModelingHistory({
      past: modelingHistoryRef.current.past.slice(0, -1),
      future: [structuredClone(current), ...modelingHistoryRef.current.future].slice(0, 100)
    })
    modelingDraftRef.current = previous
    setModelingDraft(previous)
  }

  const redoModelingDraft = (): void => {
    const current = modelingDraftRef.current
    const next = modelingHistoryRef.current.future[0]
    if (!current || !next) return
    replaceModelingHistory({
      past: [...modelingHistoryRef.current.past, structuredClone(current)].slice(-100),
      future: modelingHistoryRef.current.future.slice(1)
    })
    modelingDraftRef.current = next
    setModelingDraft(next)
  }

  const displayedObjects = applyObjectKeyframePreview(
    sceneHistory.scene.objects,
    timelinePreviewObjects
  )
  const selectedObjects = displayedObjects.filter((object) => selectedIds.includes(object.id))
  const selectedObject = selectedObjects.length === 1 ? selectedObjects[0] : null
  const selectedOptimizationReport = selectedObject
    ? optimizationReports.get(selectedObject.id)
    : undefined
  const selectedLightweightUnavailable = selectedOptimizationReport?.simplifiedMeshes === 0
  const selectedObjectPaintColor = selectedObject?.colorOverride ?? selectedObject?.color
  const selectedLight = selectedLightId
    ? (sceneHistory.scene.lighting.lights.find((light) => light.id === selectedLightId) ?? null)
    : null
  const inspectorContentKey = `${inspectorTarget}:${selectedIds.join(',')}:${selectedLightId ?? ''}`
  const cameraShots = sortedCameraShots(sceneHistory.scene.timeline.cameraShots)
  const objectKeyframes = sortedObjectKeyframes(sceneHistory.scene.timeline.objectKeyframes)
  const animatedObjects = sceneHistory.scene.objects.filter((object) =>
    objectKeyframes.some((keyframe) => keyframe.objectId === object.id)
  )
  const hasMannequinAction = sceneHistory.scene.objects.some(
    (object) => object.kind === 'mannequin' && Boolean(object.mannequin?.presetId)
  )
  const selectedVideoProfile =
    PLATFORM_PROFILE_RULES.profiles.find((profile) => profile.id === selectedVideoProfileId) ??
    PLATFORM_PROFILE_RULES.profiles[0]
  const selectedVideoValidation = validateVideoProfile(
    selectedVideoProfile,
    sceneHistory.scene.timeline.durationSeconds,
    sceneHistory.scene.camera.aspectWidth,
    sceneHistory.scene.camera.aspectHeight
  )
  const pendingOptimizationObject = pendingOptimizationObjectId
    ? (sceneHistory.scene.objects.find((object) => object.id === pendingOptimizationObjectId) ??
      null)
    : null
  const pendingPerformanceRisk = pendingOptimizationObject?.importedAsset
    ? assessModelPerformanceRisk(
        pendingOptimizationObject.importedAsset.report,
        inspectSceneQuality(
          sceneHistory.scene.objects.filter((object) => object.id !== pendingOptimizationObject.id)
        ).triangleCount
      )
    : null
  const selectedShot = selectedShotId
    ? (cameraShots.find((shot) => shot.id === selectedShotId) ?? null)
    : null
  const selectedShotIndex = selectedShot
    ? cameraShots.findIndex((shot) => shot.id === selectedShot.id)
    : -1
  const selectedObjectKeyframe = selectedObjectKeyframeId
    ? (objectKeyframes.find((keyframe) => keyframe.id === selectedObjectKeyframeId) ?? null)
    : null
  const selectedObjectTrack = selectedObjectKeyframe
    ? objectKeyframes.filter((keyframe) => keyframe.objectId === selectedObjectKeyframe.objectId)
    : []
  const selectedObjectKeyframeIndex = selectedObjectKeyframe
    ? selectedObjectTrack.findIndex((keyframe) => keyframe.id === selectedObjectKeyframe.id)
    : -1
  const cutObject = cutTool
    ? (sceneHistory.scene.objects.find((object) => object.id === cutTool.objectId) ?? null)
    : null
  const cutBounds = cutObject ? objectLocalBounds(cutObject) : null
  const cutMinimum = cutTool && cutBounds ? cutBounds.min[cutTool.axis] : -0.5
  const cutMaximum = cutTool && cutBounds ? cutBounds.max[cutTool.axis] : 0.5
  const menuObject = objectMenu
    ? (sceneHistory.scene.objects.find((object) => object.id === objectMenu.objectId) ?? null)
    : null
  const menuObjects = menuObject
    ? selectedIds.includes(menuObject.id) && selectedObjects.length > 1
      ? selectedObjects
      : [menuObject]
    : []
  const currentFingerprint = useMemo(
    () =>
      sceneFingerprint(
        sceneHistory.scene.objects,
        sceneHistory.scene.camera,
        sceneHistory.scene.lighting,
        sceneHistory.scene.timeline
      ),
    [
      sceneHistory.scene.objects,
      sceneHistory.scene.camera,
      sceneHistory.scene.lighting,
      sceneHistory.scene.timeline
    ]
  )
  const isDirty = currentFingerprint !== savedFingerprint
  const fileStateLabel = projectPath
    ? isDirty
      ? '有未保存更改'
      : '已保存'
    : isDirty
      ? '未保存到文件 · 有更改'
      : '未保存到文件'
  const autosaveStateLabel: Record<AutosaveState, string> = {
    idle: '本地自动恢复',
    pending: '等待自动恢复',
    saving: '正在更新恢复',
    saved: '恢复副本已更新',
    error: '自动恢复失败'
  }
  const facePaintObjectId =
    paintScope === 'face' &&
    selectedObject &&
    selectedObject.visible &&
    !selectedObject.locked &&
    !modelingDraft &&
    !quickBuildTool &&
    !surfacePickObjectId &&
    !cutTool &&
    !cameraPreview &&
    !timelinePlaying &&
    !timelinePreviewObjects
      ? selectedObject.id
      : null

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    window.localStorage.setItem(themeStorageKey, theme)
  }, [theme])

  useEffect(() => {
    if (!selectedObjectPaintColor) return
    setPaintColor(selectedObjectPaintColor)
  }, [selectedObject?.id, selectedObjectPaintColor])

  useEffect(() => {
    setSelectedMannequinJoint((current) => {
      if (selectedObject?.kind !== 'mannequin') return null
      return current ?? 'spine'
    })
    if (selectedObject?.kind === 'mannequin' && transformMode === 'scale') {
      setTransformMode('translate')
    }
  }, [selectedObject?.id, selectedObject?.kind, transformMode])

  useEffect(() => {
    void window.desktopApi.app.setDirty(isDirty).catch(() => {
      setNotice({ kind: 'error', message: '无法同步工程状态，请先手动保存工程。' })
    })
  }, [isDirty])

  useEffect(() => {
    if (recoveryCheckedRef.current) return
    recoveryCheckedRef.current = true
    void window.desktopApi.project
      .loadRecovery()
      .then((result) => {
        if (result.status === 'found') setRecoverySnapshot(result.snapshot)
        else if (result.status === 'error') {
          setNotice({ kind: 'error', message: result.message })
          void window.desktopApi.project.clearRecovery()
        }
      })
      .catch((error) => {
        console.error('Failed to inspect recovery snapshot', error)
        setNotice({ kind: 'error', message: '无法检查本地恢复副本，请先手动保存重要工程。' })
      })
  }, [])

  useEffect(() => {
    autosaveRevisionRef.current += 1
    const revision = autosaveRevisionRef.current
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current)
      autosaveTimerRef.current = null
    }
    if (!isDirty || recoverySnapshot) {
      if (!isDirty) setAutosaveState('idle')
      return undefined
    }

    setAutosaveState('pending')
    autosaveTimerRef.current = window.setTimeout(() => {
      autosaveTimerRef.current = null
      setAutosaveState('saving')
      const document = createProjectDocument({
        name: projectName,
        objects: sceneHistory.scene.objects,
        camera: sceneHistory.scene.camera,
        lighting: sceneHistory.scene.lighting,
        timeline: sceneHistory.scene.timeline
      })
      void window.desktopApi.project
        .autosave({ document, currentPath: projectPath })
        .then((result) => {
          if (revision !== autosaveRevisionRef.current) return
          if (result.status === 'ok') setAutosaveState('saved')
          else {
            setAutosaveState('error')
            setNotice({ kind: 'error', message: result.message })
          }
        })
        .catch((error) => {
          if (revision !== autosaveRevisionRef.current) return
          console.error('Failed to update recovery snapshot', error)
          setAutosaveState('error')
          setNotice({ kind: 'error', message: '自动恢复副本更新失败，请立即手动保存工程。' })
        })
    }, 2500)

    return () => {
      if (autosaveTimerRef.current !== null) {
        window.clearTimeout(autosaveTimerRef.current)
        autosaveTimerRef.current = null
      }
    }
  }, [
    currentFingerprint,
    isDirty,
    projectName,
    projectPath,
    recoverySnapshot,
    sceneHistory.scene.camera,
    sceneHistory.scene.lighting,
    sceneHistory.scene.objects,
    sceneHistory.scene.timeline
  ])

  useEffect(() => window.desktopApi.app.onCloseRequested(() => setPendingAction('close')), [])

  useEffect(() => {
    if (!notice) return undefined
    const timeout = window.setTimeout(() => setNotice(null), 3600)
    return () => window.clearTimeout(timeout)
  }, [notice])

  useEffect(() => {
    if (!firstPersonHintVisible) return undefined
    const timeout = window.setTimeout(() => setFirstPersonHintVisible(false), 5000)
    return () => window.clearTimeout(timeout)
  }, [firstPersonHintVisible])

  useLayoutEffect(() => {
    if (rightPanelRef.current) rightPanelRef.current.scrollTop = 0
  }, [inspectorContentKey])

  useEffect(() => {
    if (cameraPreview && inspectorTarget !== 'camera') setCameraViewMode('none')
  }, [cameraPreview, inspectorTarget])

  useEffect(() => {
    if (inspectorTarget === 'camera' && transformMode === 'scale') {
      setTransformMode('translate')
    }
  }, [inspectorTarget, transformMode])

  useEffect(() => {
    if (!objectMenu) return undefined
    const closeMenu = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Element && target.closest('.object-context-menu')) return
      setObjectMenu(null)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setObjectMenu(null)
    }
    const closeOnBlur = (): void => setObjectMenu(null)
    window.addEventListener('pointerdown', closeMenu)
    window.addEventListener('keydown', closeOnEscape)
    window.addEventListener('blur', closeOnBlur)
    return () => {
      window.removeEventListener('pointerdown', closeMenu)
      window.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('blur', closeOnBlur)
    }
  }, [objectMenu])

  useLayoutEffect(() => {
    if (!objectMenu || !objectMenuRef.current) return
    const bounds = objectMenuRef.current.getBoundingClientRect()
    const x = Math.max(8, Math.min(objectMenu.x, window.innerWidth - bounds.width - 8))
    const y = Math.max(8, Math.min(objectMenu.y, window.innerHeight - bounds.height - 8))
    if (x === objectMenu.x && y === objectMenu.y) return
    setObjectMenu((current) => (current ? { ...current, x, y } : null))
  }, [objectMenu])

  useEffect(() => {
    setSelectedIds((current) =>
      current.filter((id) => sceneHistory.scene.objects.some((object) => object.id === id))
    )
  }, [sceneHistory.scene.objects])

  useEffect(() => {
    if (
      selectedLightId &&
      !sceneHistory.scene.lighting.lights.some((light) => light.id === selectedLightId)
    ) {
      setSelectedLightId(null)
      setInspectorTarget('ambient')
    }
  }, [sceneHistory.scene.lighting.lights, selectedLightId])

  useEffect(() => {
    if (
      selectedShotId &&
      !sceneHistory.scene.timeline.cameraShots.some((shot) => shot.id === selectedShotId)
    ) {
      setSelectedShotId(null)
    }
  }, [sceneHistory.scene.timeline.cameraShots, selectedShotId])

  useEffect(() => {
    if (
      selectedObjectKeyframeId &&
      !sceneHistory.scene.timeline.objectKeyframes.some(
        (keyframe) => keyframe.id === selectedObjectKeyframeId
      )
    ) {
      setSelectedObjectKeyframeId(null)
    }
  }, [sceneHistory.scene.timeline.objectKeyframes, selectedObjectKeyframeId])

  const updateObject = useCallback(
    (id: string, update: Partial<SceneObjectData>): void => {
      setTimelinePlaying(false)
      setTimelinePreviewObjects(null)
      sceneHistory.commit((scene) => ({
        ...scene,
        objects: scene.objects.map((object) =>
          object.id === id ? { ...object, ...update } : object
        )
      }))
    },
    [sceneHistory]
  )

  const applyWholeObjectColor = (id: string, color: string): void => {
    updateObject(id, { colorOverride: color, faceColors: undefined })
  }

  const paintObjectFaces = useCallback(
    (id: string, meshKey: string, triangles: readonly number[], color: string): void => {
      if (triangles.length === 0) return
      sceneHistory.commit((scene) => {
        let changed = false
        const objects = scene.objects.map((object) => {
          if (object.id !== id || object.locked) return object
          const faceColors = { ...(object.faceColors ?? {}) }
          for (const triangle of triangles) {
            const key = faceColorKey(meshKey, triangle)
            if (faceColors[key] === color) continue
            faceColors[key] = color
            changed = true
          }
          return changed ? { ...object, faceColors } : object
        })
        return changed ? { ...scene, objects } : scene
      })
      setNotice({ kind: 'success', message: '表面颜色已更新，可撤销。' })
    },
    [sceneHistory]
  )

  const restoreObjectColors = (object: SceneObjectData): void => {
    updateObject(object.id, { colorOverride: undefined, faceColors: undefined })
    setPaintColor(object.color)
    setNotice({ kind: 'success', message: '已恢复模型原有颜色。' })
  }

  const updateObjects = (ids: string[], update: Partial<SceneObjectData>): void => {
    setTimelinePlaying(false)
    setTimelinePreviewObjects(null)
    const selected = new Set(ids)
    sceneHistory.commit((scene) => ({
      ...scene,
      objects: scene.objects.map((object) =>
        selected.has(object.id) ? { ...object, ...update } : object
      )
    }))
  }

  const addObject = (kind: BasicPrimitiveKind): void => {
    setQuickBuildTool(null)
    setQuickBuildDraft(null)
    setQuickBuildIssue(null)
    const object = placeNewObject(
      createSceneObject(kind, sceneHistory.scene.objects),
      sceneHistory.scene.objects
    )
    sceneHistory.commit((scene) => ({ ...scene, objects: [...scene.objects, object] }))
    setSelectedIds([object.id])
    setSelectedLightId(null)
    setInspectorTarget('selection')
    setNotice({ kind: 'success', message: `${object.name} 已添加` })
  }

  const addMannequin = (): void => {
    setQuickBuildTool(null)
    setQuickBuildDraft(null)
    setQuickBuildIssue(null)
    resetModelingDraft(null)
    const object = placeNewObject(
      createMannequinSceneObject(sceneHistory.scene.objects),
      sceneHistory.scene.objects
    )
    sceneHistory.commit((scene) => ({ ...scene, objects: [...scene.objects, object] }))
    setSelectedIds([object.id])
    setSelectedMannequinJoint('spine')
    setSelectedLightId(null)
    setInspectorTarget('selection')
    setTransformMode('translate')
    setNotice({
      kind: 'success',
      message: '人台已添加；先整体摆放，需要改动作时再点“调整姿势”。'
    })
  }

  const updateMannequinPose = useCallback(
    (id: string, pose: MannequinPose, jointId?: MannequinJointId): void => {
      setTimelinePlaying(false)
      setTimelinePreviewObjects(null)
      sceneHistory.commit((scene) => {
        let changed = false
        const objects = scene.objects.map((object) => {
          if (object.id !== id || object.kind !== 'mannequin' || !object.mannequin) return object
          if (JSON.stringify(object.mannequin.pose) === JSON.stringify(pose)) return object
          changed = true
          return {
            ...object,
            mannequin: {
              ...object.mannequin,
              pose: cloneMannequinPose(pose),
              manualJoints: jointId
                ? [...new Set([...(object.mannequin.manualJoints ?? []), jointId])]
                : object.mannequin.manualJoints
            }
          }
        })
        return changed ? { ...scene, objects } : scene
      })
    },
    [sceneHistory]
  )

  const applyMannequinPreset = (
    id: string,
    presetId: MannequinPresetId,
    pose: MannequinPose,
    label: string
  ): void => {
    setTimelinePlaying(false)
    setTimelinePreviewObjects(null)
    sceneHistory.commit((scene) => ({
      ...scene,
      objects: scene.objects.map((object) =>
        object.id === id && object.kind === 'mannequin' && object.mannequin
          ? {
              ...object,
              mannequin: {
                ...object.mannequin,
                pose: cloneMannequinPose(pose),
                presetId,
                manualJoints: []
              }
            }
          : object
      )
    }))
    setNotice({
      kind: 'success',
      message: `已应用“${label}”动作，可继续拖动关节调整。`
    })
  }

  const updateMannequinHeight = (id: string, requestedHeight: number): void => {
    const object = sceneHistory.scene.objects.find((item) => item.id === id)
    if (object?.kind !== 'mannequin' || !object.mannequin) return
    const heightMeters = Math.min(Math.max(requestedHeight, 1.2), 2.2)
    const groundY = object.position.y - object.mannequin.heightMeters / 2
    updateObject(id, {
      position: { ...object.position, y: groundY + heightMeters / 2 },
      size: { x: heightMeters, y: heightMeters, z: heightMeters },
      mannequin: { ...object.mannequin, heightMeters }
    })
  }

  const updateMannequinJointAxis = (
    object: SceneObjectData,
    jointId: MannequinJointId,
    axis: keyof Vector3Value,
    value: number
  ): void => {
    if (!object.mannequin) return
    const pose = cloneMannequinPose(object.mannequin.pose)
    pose[jointId] = constrainMannequinJoint(jointId, {
      ...pose[jointId],
      [axis]: value
    })
    updateMannequinPose(object.id, pose, jointId)
  }

  const beginQuickBuild = (kind: QuickBuildKind): void => {
    resetModelingDraft(null)
    setSurfacePickObjectId(null)
    setCutTool(null)
    setPaintScope('object')
    setCameraViewMode((current) => (current === 'fullscreen' ? 'none' : current))
    setQuickBuildTool(kind)
    setQuickBuildDraft(null)
    setQuickBuildIssue(null)
    setSelectedIds([])
    setSelectedLightId(null)
    setInspectorTarget('selection')
  }

  const finishQuickBuild = (): void => {
    setQuickBuildTool(null)
    setQuickBuildDraft(null)
    setQuickBuildIssue(null)
  }

  const commitQuickBuild = (draft: QuickBuildDraft): void => {
    const transform = quickBuildTransform(draft)
    if (!transform) {
      setQuickBuildIssue(
        draft.kind === 'wall' ? '墙体长度需要至少 0.2。' : '地面的长和宽都需要至少 0.2。'
      )
      return
    }
    const object = { ...createSceneObject(draft.kind, sceneHistory.scene.objects), ...transform }
    sceneHistory.commit((scene) => ({ ...scene, objects: [...scene.objects, object] }))
    setSelectedIds([object.id])
    setInspectorTarget('selection')
    setNotice({ kind: 'success', message: `${object.name} 已铺设` })
  }

  const duplicateObject = (id: string): void => {
    const source = sceneHistory.scene.objects.find((object) => object.id === id)
    if (!source) return
    const duplicate = cloneSceneObject(source, sceneHistory.scene.objects)
    duplicate.groupId = undefined
    sceneHistory.commit((scene) => ({ ...scene, objects: [...scene.objects, duplicate] }))
    setSelectedIds([duplicate.id])
    setInspectorTarget('selection')
    setNotice({ kind: 'success', message: `${duplicate.name} 已创建` })
  }

  const duplicateObjects = (ids: string[]): void => {
    const selected = new Set(ids)
    const duplicates: SceneObjectData[] = []
    let workingObjects = [...sceneHistory.scene.objects]
    for (const object of sceneHistory.scene.objects) {
      if (!selected.has(object.id)) continue
      const duplicate = cloneSceneObject(object, workingObjects)
      duplicate.groupId = undefined
      duplicates.push(duplicate)
      workingObjects = [...workingObjects, duplicate]
    }
    if (duplicates.length === 0) return
    sceneHistory.commit((scene) => ({ ...scene, objects: [...scene.objects, ...duplicates] }))
    setSelectedIds(duplicates.map((object) => object.id))
    setNotice({ kind: 'success', message: `已复制 ${duplicates.length} 个对象` })
  }

  const deleteObjects = (deletingIds: string[]): void => {
    const deletingSet = new Set(deletingIds)
    if (!sceneHistory.scene.objects.some((object) => deletingSet.has(object.id))) return
    sceneHistory.commit((scene) => ({
      ...scene,
      objects: scene.objects.filter((object) => !deletingSet.has(object.id)),
      timeline: {
        ...scene.timeline,
        objectKeyframes: scene.timeline.objectKeyframes.filter(
          (keyframe) => !deletingSet.has(keyframe.objectId)
        )
      }
    }))
    setTimelinePreviewObjects(null)
    setSelectedObjectKeyframeId(null)
    setSelectedIds([])
    setNotice({
      kind: 'info',
      message:
        deletingIds.length > 1 ? '所选对象已删除，可使用撤销恢复' : '对象已删除，可使用撤销恢复'
    })
  }

  const deleteSelected = (): void => {
    if (selectedIds.length > 0) deleteObjects(selectedIds)
  }

  const showObjectMenu = (objectId: string | null, clientX: number, clientY: number): void => {
    if (!objectId) {
      setObjectMenu(null)
      return
    }
    if (!selectedIds.includes(objectId)) setSelectedIds([objectId])
    setSelectedLightId(null)
    setInspectorTarget('selection')
    setObjectMenu({
      objectId,
      x: Math.max(8, clientX),
      y: Math.max(8, clientY)
    })
  }

  const beginRename = (id: string): void => {
    setSelectedIds([id])
    setInspectorTarget('selection')
    setObjectMenu(null)
    window.setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>('.object-name-input')
      input?.focus()
      input?.select()
    })
  }

  const handleTransformMany = (updates: ObjectTransformBatchUpdate[]): void => {
    if (updates.length === 0) return
    setTimelinePlaying(false)
    setTimelinePreviewObjects(null)
    const updateMap = new Map(updates.map(({ id, ...transform }) => [id, transform]))
    const previewObjects = sceneHistory.scene.objects.map((object) => {
      const transform = updateMap.get(object.id)
      return transform ? { ...object, ...transform } : object
    })
    const previewSnap = snappingEnabled
      ? snapSelectionToObjectEdges(previewObjects, new Set(updateMap.keys()))
      : null
    sceneHistory.commit((scene) => {
      const transformed = scene.objects.map((object) => {
        const transform = updateMap.get(object.id)
        return transform ? { ...object, ...transform } : object
      })
      if (!snappingEnabled) return { ...scene, objects: transformed }
      const snapped = snapSelectionToObjectEdges(transformed, new Set(updateMap.keys()))
      return { ...scene, objects: snapped.objects }
    })
    if (previewSnap && previewSnap.axes.length > 0) {
      setNotice({ kind: 'info', message: '已吸附到相邻模型边缘' })
    }
  }

  const handleCanvasSelection = (ids: string[]): void => {
    setSelectedLightId(null)
    if (ids.length === 1) {
      const selected = sceneHistory.scene.objects.find((object) => object.id === ids[0])
      if (selected?.groupId) {
        setSelectedIds(
          sceneHistory.scene.objects
            .filter((object) => object.groupId === selected.groupId)
            .map((object) => object.id)
        )
      } else {
        setSelectedIds(ids)
      }
    } else {
      setSelectedIds(ids)
    }
    setInspectorTarget('selection')
  }

  const selectFromList = (id: string, toggle: boolean): void => {
    finishQuickBuild()
    setSelectedLightId(null)
    setInspectorTarget('selection')
    setSelectedIds((current) => {
      if (!toggle) return [id]
      return current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    })
  }

  const applyLayout = (
    operation: 'align-x' | 'align-z' | 'distribute-x' | 'distribute-z' | 'ground'
  ): void => {
    const selection = new Set(selectedIds)
    sceneHistory.commit((scene) => {
      if (operation === 'align-x') {
        return { ...scene, objects: alignObjects(scene.objects, selection, 'x', 'center') }
      }
      if (operation === 'align-z') {
        return { ...scene, objects: alignObjects(scene.objects, selection, 'z', 'center') }
      }
      if (operation === 'distribute-x') {
        return { ...scene, objects: distributeObjects(scene.objects, selection, 'x') }
      }
      if (operation === 'distribute-z') {
        return { ...scene, objects: distributeObjects(scene.objects, selection, 'z') }
      }
      return { ...scene, objects: placeOnGround(scene.objects, selection) }
    })
  }

  const groupSelectedObjects = (): void => {
    if (selectedIds.length < 2) return
    const groupId = crypto.randomUUID()
    const selected = new Set(selectedIds)
    sceneHistory.commit((scene) => ({
      ...scene,
      objects: scene.objects.map((object) =>
        selected.has(object.id) ? { ...object, groupId } : object
      )
    }))
    setGroupConfirmationOpen(false)
    setObjectMenu(null)
    setNotice({ kind: 'success', message: '已保存为组合，模型仍保持独立并可撤销' })
  }

  const ungroupSelectedObjects = (): void => {
    const selected = new Set(selectedIds)
    const selectedGroupIds = new Set(
      sceneHistory.scene.objects
        .filter((object) => selected.has(object.id) && object.groupId)
        .map((object) => object.groupId)
    )
    sceneHistory.commit((scene) => ({
      ...scene,
      objects: scene.objects.map((object) =>
        selected.has(object.id) || (object.groupId && selectedGroupIds.has(object.groupId))
          ? { ...object, groupId: undefined }
          : object
      )
    }))
    setObjectMenu(null)
    setNotice({ kind: 'info', message: '组合已解除' })
  }

  const beginCanvasModeling = (planeMode: ModelingPlaneMode = 'ground'): void => {
    finishQuickBuild()
    const draft = viewportRef.current?.createModelingDraft(planeMode)
    if (!draft) {
      setNotice({ kind: 'error', message: '三维画布还没有准备好，请稍后重试。' })
      return
    }
    resetModelingDraft(draft)
    setPaintScope('object')
    setSurfacePickObjectId(null)
    setCutTool(null)
    setModelingElementMode('vertex')
    setModelingError(null)
    setSelectedIds([])
    setSelectedLightId(null)
    setInspectorTarget('selection')
  }

  const editCustomObject = (object: SceneObjectData): void => {
    try {
      finishQuickBuild()
      resetModelingDraft(draftFromCustomObject(object))
      setPaintScope('object')
      setSurfacePickObjectId(null)
      setCutTool(null)
      setModelingElementMode('vertex')
      setModelingError(null)
      setSelectedLightId(null)
    } catch (error) {
      setNotice({
        kind: 'error',
        message: error instanceof Error ? error.message : '无法编辑这个自定义模型。'
      })
    }
  }

  const closeDraftFace = (): void => {
    if (!modelingDraft) return
    try {
      changeModelingDraft(closeModelingDraft(modelingDraft), 'push')
      setModelingElementMode('face')
      setModelingError(null)
    } catch (error) {
      setModelingError(error instanceof Error ? error.message : '轮廓暂时不能闭合。')
    }
  }

  const finishCanvasModeling = (): void => {
    if (!modelingDraft) return
    try {
      const finalized = finalizeModelingDraft(modelingDraft)
      const createdObject = modelingDraft.objectId
        ? null
        : createCustomSceneObject(finalized.mesh, sceneHistory.scene.objects, {
            position: finalized.position,
            rotation: finalized.rotation,
            size: finalized.size
          })
      const surfaceGroupId = modelingDraft.surfaceSourceId
        ? (sceneHistory.scene.objects.find((item) => item.id === modelingDraft.surfaceSourceId)
            ?.groupId ?? crypto.randomUUID())
        : null
      if (createdObject && surfaceGroupId) createdObject.groupId = surfaceGroupId
      const resolvedId = modelingDraft.objectId ?? createdObject?.id
      sceneHistory.commit((scene) => {
        if (modelingDraft.objectId) {
          return {
            ...scene,
            objects: scene.objects.map((object) =>
              object.id === modelingDraft.objectId
                ? {
                    ...object,
                    customMesh: finalized.mesh,
                    customProfile: undefined,
                    faceColors: undefined,
                    position: finalized.position,
                    rotation: finalized.rotation,
                    size: finalized.size
                  }
                : object
            )
          }
        }
        if (!createdObject) return scene
        if (modelingDraft.surfaceSourceId && surfaceGroupId) {
          return {
            ...scene,
            objects: [
              ...scene.objects.map((item) =>
                item.id === modelingDraft.surfaceSourceId
                  ? { ...item, groupId: surfaceGroupId }
                  : item
              ),
              createdObject
            ]
          }
        }
        return { ...scene, objects: [...scene.objects, createdObject] }
      })
      resetModelingDraft(null)
      setModelingError(null)
      setSelectedIds(resolvedId ? [resolvedId] : [])
      setInspectorTarget('selection')
      setNotice({
        kind: 'success',
        message: modelingDraft.surfaceSourceId
          ? '贴面部件已生成，并与原模型保存为非破坏组合。'
          : '自定义模型已生成，可继续移动和编辑顶面。'
      })
    } catch (error) {
      setModelingError(error instanceof Error ? error.message : '模型暂时无法生成。')
    }
  }

  const beginSurfaceModeling = (): void => {
    if (!modelingDraft) return
    try {
      resetModelingDraft(createSurfaceModelingDraft(modelingDraft))
      setModelingElementMode('vertex')
      setModelingError(null)
    } catch (error) {
      setModelingError(error instanceof Error ? error.message : '无法在这个面上继续绘制。')
    }
  }

  const beginSurfacePick = (object: SceneObjectData): void => {
    if (!object.visible) {
      setNotice({ kind: 'info', message: '请先显示这个模型，再选择要继续绘制的面。' })
      return
    }
    finishQuickBuild()
    resetModelingDraft(null)
    setPaintScope('object')
    setCutTool(null)
    setCameraViewMode((current) => (current === 'fullscreen' ? 'none' : current))
    setSurfacePickObjectId(object.id)
    setSelectedIds([object.id])
    setSelectedLightId(null)
    setInspectorTarget('selection')
  }

  const handleSurfacePick = (objectId: string, plane: SketchPlane): void => {
    resetModelingDraft(createSurfaceModelingDraftFromPlane(plane, objectId))
    setSurfacePickObjectId(null)
    setModelingElementMode('vertex')
    setModelingError(null)
    setNotice({ kind: 'info', message: '已选定模型表面，可直接落点并生成新的贴面部件。' })
  }

  const extrudeSelectedModelingFace = (): void => {
    if (!modelingDraft || modelingDraft.selectedFace === null) return
    try {
      changeModelingDraft(
        extrudeModelingFace(modelingDraft, modelingDraft.selectedFace, modelingDraft.extrusion),
        'push'
      )
      setModelingElementMode('face')
      setModelingError(null)
    } catch (error) {
      setModelingError(error instanceof Error ? error.message : '这个面暂时无法拉伸。')
    }
  }

  const openCutTool = (object: SceneObjectData): void => {
    finishQuickBuild()
    if (object.kind === 'imported') {
      setNotice({
        kind: 'info',
        message: '导入模型暂不直接切割，避免丢失材质、骨骼或动画数据。'
      })
      return
    }
    const bounds = objectLocalBounds(object)
    setPaintScope('object')
    setCutTool({
      objectId: object.id,
      axis: 'x',
      offset: (bounds.min.x + bounds.max.x) / 2,
      keep: 'both'
    })
    setSurfacePickObjectId(null)
    resetModelingDraft(null)
  }

  const applyCut = (): void => {
    if (!cutTool) return
    const requestedKeep = cutTool.keep
    const source = sceneHistory.scene.objects.find((object) => object.id === cutTool.objectId)
    if (!source || source.kind === 'imported') return
    if ((source.cuts?.length ?? 0) >= 12) {
      setNotice({ kind: 'error', message: '这个模型的切割层数已经过多，请先完成其他编辑。' })
      return
    }
    const normal: Vector3Value = {
      x: cutTool.axis === 'x' ? 1 : 0,
      y: cutTool.axis === 'y' ? 1 : 0,
      z: cutTool.axis === 'z' ? 1 : 0
    }
    const makeCut = (keep: 'positive' | 'negative'): MeshCutData => ({
      normal: { ...normal },
      offset: cutTool.offset,
      keep
    })
    const groupId = source.groupId ?? crypto.randomUUID()
    const second = requestedKeep === 'both' ? structuredClone(source) : null
    if (second) {
      second.id = crypto.randomUUID()
      second.name = `${source.name} 切面 B`
      second.groupId = groupId
      second.cuts = [...(source.cuts ?? []), makeCut('negative')]
      second.faceColors = undefined
    }
    const nextSelection = second ? [source.id, second.id] : [source.id]
    sceneHistory.commit((scene) => {
      if (requestedKeep !== 'both') {
        return {
          ...scene,
          objects: scene.objects.map((object) =>
            object.id === source.id
              ? {
                  ...object,
                  cuts: [...(object.cuts ?? []), makeCut(requestedKeep)],
                  faceColors: undefined
                }
              : object
          )
        }
      }
      if (!second) return scene
      return {
        ...scene,
        objects: [
          ...scene.objects.map((object) =>
            object.id === source.id
              ? {
                  ...object,
                  name: `${source.name} 切面 A`,
                  groupId,
                  cuts: [...(object.cuts ?? []), makeCut('positive')],
                  faceColors: undefined
                }
              : object
          ),
          second
        ]
      }
    })
    setSelectedIds(nextSelection)
    setCutTool(null)
    setNotice({
      kind: 'success',
      message:
        requestedKeep === 'both' ? '模型已切成两个独立部分，可一起移动或分别编辑。' : '切割已应用。'
    })
  }

  const updateLight = (id: string, update: Partial<SceneLightData>): void => {
    setLightControlPreview(null)
    sceneHistory.commit((scene) => ({
      ...scene,
      lighting: {
        lights: scene.lighting.lights.map((light) =>
          light.id === id ? { ...light, ...update } : light
        )
      }
    }))
  }

  const changeWorkspaceMode = (mode: WorkspaceMode): void => {
    setWorkspaceMode(mode)
    if (mode === 'animation') {
      setTimelineOpen(true)
      return
    }
    if (mode === 'scene') {
      setTimelineOpen(false)
      if (inspectorTarget === 'camera') setInspectorTarget('selection')
      return
    }
    setSelectedIds([])
    setSelectedLightId(null)
    setInspectorTarget('camera')
    setTimelinePreviewCamera(null)
    setCameraViewMode('monitor')
  }

  const addLight = (kind: SceneLightKind): void => {
    if (sceneHistory.scene.lighting.lights.length >= 8) {
      setNotice({ kind: 'error', message: '当前场景最多使用 8 盏可编辑灯光。' })
      return
    }
    const light = createSceneLight(kind, sceneHistory.scene.lighting.lights)
    sceneHistory.commit((scene) => ({
      ...scene,
      lighting: { lights: [...scene.lighting.lights, light] }
    }))
    setSelectedIds([])
    setSelectedLightId(light.id)
    setInspectorTarget('light')
    setNotice({ kind: 'success', message: `${light.name} 已添加` })
  }

  const deleteLight = (id: string): void => {
    sceneHistory.commit((scene) => ({
      ...scene,
      lighting: { lights: scene.lighting.lights.filter((light) => light.id !== id) }
    }))
    setSelectedLightId(null)
    setInspectorTarget('ambient')
    setNotice({ kind: 'info', message: '灯光已删除，可使用撤销恢复。' })
  }

  const importModel = async (): Promise<void> => {
    finishQuickBuild()
    setBusy(true)
    try {
      const opened = await window.desktopApi.model.open()
      if (opened.status === 'cancelled') return
      if (opened.status === 'error') {
        setNotice({ kind: 'error', message: opened.message })
        return
      }
      const asset = await viewportRef.current?.prepareImportedModel(opened)
      if (!asset) {
        setNotice({ kind: 'error', message: '三维画布还没有准备好，请稍后重试。' })
        return
      }
      const object = placeNewObject(
        createImportedSceneObject(asset, sceneHistory.scene.objects),
        sceneHistory.scene.objects
      )
      const performanceRisk = assessModelPerformanceRisk(
        asset.report,
        inspectSceneQuality(sceneHistory.scene.objects).triangleCount
      )
      sceneHistory.commit((scene) => ({ ...scene, objects: [...scene.objects, object] }))
      setSelectedIds([object.id])
      setInspectorTarget('selection')
      const warningCount = asset.report.issues.filter((issue) => issue.severity !== 'info').length
      setNotice({
        kind: warningCount > 0 ? 'info' : 'success',
        message:
          warningCount > 0
            ? `${object.name} 已导入，质量检查发现 ${warningCount} 项提示`
            : `${object.name} 已导入并通过基础检查`
      })
      if (performanceRisk.level !== 'normal') setPendingOptimizationObjectId(object.id)
    } catch (error) {
      console.error('Failed to import model', error)
      setNotice({
        kind: 'error',
        message: error instanceof Error ? error.message : '模型导入失败。'
      })
    } finally {
      setBusy(false)
    }
  }

  const setImportedPreviewQuality = (
    objectId: string,
    quality: 'original' | 'lightweight'
  ): void => {
    updateObject(objectId, { previewQuality: quality })
    setOptimizationReports((current) => {
      const next = new Map(current)
      next.delete(objectId)
      return next
    })
    setNotice({
      kind: 'info',
      message:
        quality === 'lightweight'
          ? '正在生成轻量预览。原始模型和默认导出精度不会改变。'
          : '已切回原始模型预览。'
    })
  }

  const setImportedExportQuality = (
    objectId: string,
    quality: 'original' | 'lightweight'
  ): void => {
    updateObject(objectId, { exportQuality: quality })
    setNotice({
      kind: 'info',
      message:
        quality === 'lightweight'
          ? '最终图片、视频和模型将使用轻量精度；可随时切回原始精度。'
          : '最终图片、视频和模型将使用原始精度。'
    })
  }

  const inspectQuality = (): SceneQualityReport => {
    const report = inspectSceneQuality(sceneHistory.scene.objects)
    setQualityReport(report)
    return report
  }

  const exportReferenceImages = async (): Promise<void> => {
    const report = inspectSceneQuality(sceneHistory.scene.objects)
    if (report.status === 'error' || report.objectCount === 0) {
      setQualityReport(report)
      setNotice({
        kind: 'error',
        message:
          report.objectCount === 0
            ? '请先添加模型再导出参考图。'
            : '模型存在错误，请先查看质量检查。'
      })
      return
    }
    const images = viewportRef.current?.captureReferenceImages()
    if (!images) {
      setNotice({ kind: 'error', message: '参考图还没有准备好，请稍后重试。' })
      return
    }
    setBusy(true)
    try {
      const result = await window.desktopApi.image.saveBundle({
        suggestedBaseName: projectName,
        images: [
          { kind: 'white', base64Data: images.white },
          { kind: 'depth', base64Data: images.depth },
          { kind: 'normal', base64Data: images.normal },
          { kind: 'objectId', base64Data: images.objectId },
          { kind: 'mask', base64Data: images.mask },
          { kind: 'outline', base64Data: images.outline }
        ]
      })
      if (result.status === 'saved') {
        setNotice({
          kind: report.status === 'warning' ? 'info' : 'success',
          message:
            report.status === 'warning'
              ? `六张控制参考图已导出，同时保留 ${report.issueCount} 项质量提示`
              : '白模、深度、法线、物体分色、遮罩和轮廓图已导出'
        })
      } else if (result.status === 'error') {
        setNotice({ kind: 'error', message: result.message })
      }
    } catch (error) {
      console.error('Failed to export reference images', error)
      setNotice({ kind: 'error', message: '参考图导出失败，请更换保存位置后重试。' })
    } finally {
      setBusy(false)
    }
  }

  const exportSceneModel = async (format: ExportModelFormat): Promise<void> => {
    const quality = inspectSceneQuality(sceneHistory.scene.objects)
    if (quality.status === 'error' || quality.objectCount === 0) {
      setModelExportOpen(false)
      setQualityReport(quality)
      setNotice({
        kind: 'error',
        message:
          quality.objectCount === 0
            ? '请先添加模型再导出模型文件。'
            : '模型存在错误，请先查看质量检查。'
      })
      return
    }

    setModelExportOpen(false)
    setBusy(true)
    try {
      const exported = await viewportRef.current?.exportSceneModel(format)
      if (!exported) throw new Error('三维场景还没有准备好，请稍后重试。')
      const data =
        exported.data instanceof ArrayBuffer ? new Uint8Array(exported.data) : exported.data
      const result = await window.desktopApi.model.save({
        format,
        data,
        suggestedName: projectName
      })
      if (result.status === 'saved') {
        const warning = exported.report.issues.find((issue) => issue.severity !== 'info')
        setNotice({
          kind: warning || format === 'obj' ? 'info' : 'success',
          message:
            format === 'obj'
              ? 'OBJ 已导出。它适合静态形体，不保留动画、骨骼和完整现代材质。'
              : `${format.toUpperCase()} 模型已导出，共 ${exported.report.triangleCount.toLocaleString()} 个三角面。`
        })
      } else if (result.status === 'error') {
        setNotice({ kind: 'error', message: result.message })
      }
    } catch (error) {
      console.error('Failed to export scene model', error)
      setNotice({
        kind: 'error',
        message: error instanceof Error ? error.message : '模型导出失败，请稍后重试。'
      })
    } finally {
      setBusy(false)
    }
  }

  const activateModelCamera = (objectId: string): void => {
    const nextCamera = viewportRef.current?.activateImportedCamera(objectId)
    if (!nextCamera) {
      setNotice({ kind: 'error', message: '导入相机尚未准备好，请稍后重试。' })
      return
    }
    handleCameraChange(nextCamera)
    setInspectorTarget('camera')
    setSelectedIds([])
    setSelectedLightId(null)
    setNotice({ kind: 'success', message: '已切换到模型中保存的相机视角' })
  }

  const handleCameraChange = (nextCamera: CameraState): void => {
    setCameraControlPreview(null)
    setTimelinePreviewCamera(null)
    sceneHistory.commit((scene) =>
      cameraFingerprint(scene.camera) === cameraFingerprint(nextCamera)
        ? scene
        : { ...scene, camera: cloneCamera(nextCamera) }
    )
  }

  const enterFirstPersonCameraControl = (): void => {
    const alignedCamera = viewportRef.current?.alignSceneCameraToView()
    if (!alignedCamera) {
      setNotice({ kind: 'error', message: '画布视角尚未准备好，请稍后再试。' })
      return
    }
    handleCameraChange(alignedCamera)
    setPaintScope('object')
    setSelectedIds([])
    setSelectedLightId(null)
    setInspectorTarget('camera')
    setTimelinePlaying(false)
    setTimelinePreviewCamera(null)
    setTimelinePreviewObjects(null)
    setCameraControlPreview(null)
    setCameraViewMode('monitor')
    setFirstPersonCameraControl(true)
    setFirstPersonHintVisible(true)
    setNotice({
      kind: 'info',
      message: '已接管当前画布视角；可继续编辑物体，取景窗显示最终画幅。'
    })
  }

  const exitFirstPersonCameraControl = (): void => {
    const finalCamera = viewportRef.current?.alignSceneCameraToView()
    if (finalCamera) handleCameraChange(finalCamera)
    setFirstPersonCameraControl(false)
    setFirstPersonHintVisible(false)
    setCameraControlPreview(null)
  }

  const showTimelineState = (
    timeline: TimelineState,
    baseCamera: CameraState,
    timeSeconds: number
  ): number => {
    const evaluated = evaluateTimelineAtTime(timeline, baseCamera, timeSeconds)
    timelineTimeRef.current = evaluated.timeSeconds
    setTimelineTime(evaluated.timeSeconds)
    setTimelinePreviewCamera(timeline.cameraShots.length > 0 ? evaluated.camera : null)
    setTimelinePreviewObjects(evaluated.objectTransforms)
    return evaluated.timeSeconds
  }

  const setTimelineCursor = (timeSeconds: number): void => {
    showTimelineState(sceneHistory.scene.timeline, sceneHistory.scene.camera, timeSeconds)
  }

  const toggleTimelinePlayback = (): void => {
    if (!timelinePlaying && timelineTime >= sceneHistory.scene.timeline.durationSeconds) {
      setTimelineCursor(0)
    }
    setTimelinePlaying((current) => !current)
  }

  const recordCameraShot = (): void => {
    setTimelineOpen(true)
    setTimelinePlaying(false)
    const recordTime = snapTimelineTime(
      timelineTimeRef.current,
      sceneHistory.scene.timeline.durationSeconds
    )
    const recordedCamera = timelinePreviewCamera ?? sceneHistory.scene.camera
    const result = upsertCameraShot(
      sceneHistory.scene.timeline.cameraShots,
      recordTime,
      recordedCamera
    )
    const timeline = { ...sceneHistory.scene.timeline, cameraShots: result.shots }
    sceneHistory.commit((scene) => ({ ...scene, timeline }))
    setSelectedShotId(result.selectedId)
    setSelectedObjectKeyframeId(null)
    showTimelineState(timeline, sceneHistory.scene.camera, recordTime)
    setNotice({ kind: 'success', message: `已记录 ${recordTime.toFixed(1)} 秒的摄影机镜头` })
  }

  const setSelectedShotTransition = (transition: CameraTransition): void => {
    if (!selectedShotId) return
    const cameraShots = updateCameraShotTransition(
      sceneHistory.scene.timeline.cameraShots,
      selectedShotId,
      transition
    )
    sceneHistory.commit((scene) => ({
      ...scene,
      timeline: { ...scene.timeline, cameraShots }
    }))
    setTimelinePreviewCamera(
      evaluateCameraShots(cameraShots, timelineTimeRef.current, {
        aspectWidth: sceneHistory.scene.camera.aspectWidth,
        aspectHeight: sceneHistory.scene.camera.aspectHeight
      })
    )
  }

  const duplicateSelectedShot = (): void => {
    if (!selectedShotId) return
    const result = duplicateCameraShot(
      sceneHistory.scene.timeline.cameraShots,
      selectedShotId,
      sceneHistory.scene.timeline.durationSeconds
    )
    if (!result) return
    const timeline = { ...sceneHistory.scene.timeline, cameraShots: result.shots }
    const duplicate = result.shots.find((shot) => shot.id === result.selectedId)
    sceneHistory.commit((scene) => ({ ...scene, timeline }))
    setSelectedShotId(result.selectedId)
    setSelectedObjectKeyframeId(null)
    if (duplicate) showTimelineState(timeline, sceneHistory.scene.camera, duplicate.timeSeconds)
    setNotice({ kind: 'success', message: '镜头记录点已复制，可继续左右拖动调整时间。' })
  }

  const deleteSelectedShot = (): void => {
    if (!selectedShotId) return
    sceneHistory.commit((scene) => ({
      ...scene,
      timeline: {
        ...scene.timeline,
        cameraShots: scene.timeline.cameraShots.filter((shot) => shot.id !== selectedShotId)
      }
    }))
    setSelectedShotId(null)
    setTimelinePreviewCamera(null)
    setNotice({ kind: 'info', message: '镜头节点已删除，可使用撤销恢复。' })
  }

  const recordObjectKeyframe = (): void => {
    if (!selectedObject || selectedObject.locked) return
    setTimelineOpen(true)
    const recordTime = snapTimelineTime(
      timelineTimeRef.current,
      sceneHistory.scene.timeline.durationSeconds
    )
    const updatesExisting = sceneHistory.scene.timeline.objectKeyframes.some(
      (keyframe) =>
        keyframe.objectId === selectedObject.id &&
        Math.abs(keyframe.timeSeconds - recordTime) < 0.025
    )
    if (sceneHistory.scene.timeline.objectKeyframes.length >= 1000 && !updatesExisting) {
      setNotice({ kind: 'error', message: '物体状态记录已达到上限，请删除不再需要的节点。' })
      return
    }
    setTimelinePlaying(false)
    const result = upsertObjectKeyframe(
      sceneHistory.scene.timeline.objectKeyframes,
      recordTime,
      selectedObject
    )
    const timeline = { ...sceneHistory.scene.timeline, objectKeyframes: result.keyframes }
    sceneHistory.commit((scene) => ({ ...scene, timeline }))
    setSelectedObjectKeyframeId(result.selectedId)
    setSelectedShotId(null)
    showTimelineState(timeline, sceneHistory.scene.camera, recordTime)
    setNotice({
      kind: 'success',
      message: `已记录 ${recordTime.toFixed(1)} 秒的 ${selectedObject.name} 状态`
    })
  }

  const setSelectedObjectInterpolation = (interpolation: ObjectInterpolation): void => {
    if (!selectedObjectKeyframeId) return
    const keyframes = updateObjectKeyframeInterpolation(
      sceneHistory.scene.timeline.objectKeyframes,
      selectedObjectKeyframeId,
      interpolation
    )
    sceneHistory.commit((scene) => ({
      ...scene,
      timeline: { ...scene.timeline, objectKeyframes: keyframes }
    }))
    setTimelinePreviewObjects(evaluateObjectKeyframes(keyframes, timelineTimeRef.current))
  }

  const duplicateSelectedObjectKeyframe = (): void => {
    if (!selectedObjectKeyframeId) return
    if (sceneHistory.scene.timeline.objectKeyframes.length >= 1000) {
      setNotice({ kind: 'error', message: '物体状态记录已达到上限，请删除不再需要的节点。' })
      return
    }
    const result = duplicateObjectKeyframe(
      sceneHistory.scene.timeline.objectKeyframes,
      selectedObjectKeyframeId,
      sceneHistory.scene.timeline.durationSeconds
    )
    if (!result) return
    const timeline = { ...sceneHistory.scene.timeline, objectKeyframes: result.keyframes }
    const duplicate = result.keyframes.find((keyframe) => keyframe.id === result.selectedId)
    sceneHistory.commit((scene) => ({ ...scene, timeline }))
    setSelectedObjectKeyframeId(result.selectedId)
    setSelectedShotId(null)
    if (duplicate) {
      setSelectedIds([duplicate.objectId])
      setInspectorTarget('selection')
      showTimelineState(timeline, sceneHistory.scene.camera, duplicate.timeSeconds)
    }
    setNotice({ kind: 'success', message: '物体状态记录点已复制，可继续左右拖动调整时间。' })
  }

  const deleteSelectedObjectKeyframe = (): void => {
    if (!selectedObjectKeyframeId) return
    const keyframes = sceneHistory.scene.timeline.objectKeyframes.filter(
      (keyframe) => keyframe.id !== selectedObjectKeyframeId
    )
    sceneHistory.commit((scene) => ({
      ...scene,
      timeline: { ...scene.timeline, objectKeyframes: keyframes }
    }))
    setSelectedObjectKeyframeId(null)
    setTimelinePreviewObjects(evaluateObjectKeyframes(keyframes, timelineTimeRef.current))
    setNotice({ kind: 'info', message: '物体状态节点已删除，可使用撤销恢复。' })
  }

  const timelineTimeFromPointer = (event: ReactPointerEvent<HTMLButtonElement>): number => {
    const trackArea = event.currentTarget.closest('.track-area')
    if (!trackArea) return timelineTimeRef.current
    const bounds = trackArea.getBoundingClientRect()
    if (bounds.width <= 0) return timelineTimeRef.current
    return (
      ((event.clientX - bounds.left) / bounds.width) * sceneHistory.scene.timeline.durationSeconds
    )
  }

  const selectTimelineMarker = (kind: TimelineMarkerKind, id: string): number | null => {
    setTimelinePlaying(false)
    if (kind === 'camera') {
      const shot = sceneHistory.scene.timeline.cameraShots.find((item) => item.id === id)
      if (!shot) return null
      setSelectedShotId(id)
      setSelectedObjectKeyframeId(null)
      setTimelineCursor(shot.timeSeconds)
      return shot.timeSeconds
    }
    const keyframe = sceneHistory.scene.timeline.objectKeyframes.find((item) => item.id === id)
    if (!keyframe) return null
    setSelectedObjectKeyframeId(id)
    setSelectedShotId(null)
    setSelectedIds([keyframe.objectId])
    setInspectorTarget('selection')
    setTimelineCursor(keyframe.timeSeconds)
    return keyframe.timeSeconds
  }

  const beginTimelineMarkerDrag = (
    event: ReactPointerEvent<HTMLButtonElement>,
    kind: TimelineMarkerKind,
    id: string
  ): void => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const timeSeconds = selectTimelineMarker(kind, id)
    if (timeSeconds === null) return
    const drag: TimelineMarkerDrag = {
      kind,
      id,
      pointerId: event.pointerId,
      startTimeSeconds: timeSeconds,
      timeSeconds,
      moved: false
    }
    timelineDragRef.current = drag
    setTimelineDrag(drag)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const updateTimelineMarkerDrag = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const drag = timelineDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    const requestedTime = timelineTimeFromPointer(event)
    let timeline = sceneHistory.scene.timeline
    let timeSeconds = drag.timeSeconds
    if (drag.kind === 'camera') {
      const cameraShots = moveCameraShot(
        timeline.cameraShots,
        drag.id,
        requestedTime,
        timeline.durationSeconds
      )
      timeSeconds = cameraShots.find((shot) => shot.id === drag.id)?.timeSeconds ?? timeSeconds
      timeline = { ...timeline, cameraShots }
    } else {
      const objectKeyframes = moveObjectKeyframe(
        timeline.objectKeyframes,
        drag.id,
        requestedTime,
        timeline.durationSeconds
      )
      timeSeconds =
        objectKeyframes.find((keyframe) => keyframe.id === drag.id)?.timeSeconds ?? timeSeconds
      timeline = { ...timeline, objectKeyframes }
    }
    const nextDrag = {
      ...drag,
      timeSeconds,
      moved:
        drag.moved || Math.abs(timeSeconds - drag.startTimeSeconds) >= 0.5 / TIMELINE_FRAME_RATE
    }
    timelineDragRef.current = nextDrag
    setTimelineDrag(nextDrag)
    showTimelineState(timeline, sceneHistory.scene.camera, timeSeconds)
  }

  const finishTimelineMarkerDrag = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const drag = timelineDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (drag.moved) {
      sceneHistory.commit((scene) => ({
        ...scene,
        timeline:
          drag.kind === 'camera'
            ? {
                ...scene.timeline,
                cameraShots: moveCameraShot(
                  scene.timeline.cameraShots,
                  drag.id,
                  drag.timeSeconds,
                  scene.timeline.durationSeconds
                )
              }
            : {
                ...scene.timeline,
                objectKeyframes: moveObjectKeyframe(
                  scene.timeline.objectKeyframes,
                  drag.id,
                  drag.timeSeconds,
                  scene.timeline.durationSeconds
                )
              }
      }))
      setNotice({ kind: 'success', message: `记录点已移动到 ${drag.timeSeconds.toFixed(2)} 秒` })
    }
    timelineDragRef.current = null
    setTimelineDrag(null)
  }

  const cancelTimelineMarkerDrag = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const drag = timelineDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    timelineDragRef.current = null
    setTimelineDrag(null)
    setTimelineCursor(drag.startTimeSeconds)
  }

  const moveTimelineMarkerWithKeyboard = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    kind: TimelineMarkerKind,
    id: string
  ): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    event.stopPropagation()
    const direction = event.key === 'ArrowRight' ? 1 : -1
    const step = event.shiftKey ? 0.5 : 1 / TIMELINE_FRAME_RATE
    const timeline = sceneHistory.scene.timeline
    if (kind === 'camera') {
      const source = timeline.cameraShots.find((shot) => shot.id === id)
      if (!source) return
      const cameraShots = moveCameraShot(
        timeline.cameraShots,
        id,
        source.timeSeconds + direction * step,
        timeline.durationSeconds
      )
      const timeSeconds =
        cameraShots.find((shot) => shot.id === id)?.timeSeconds ?? source.timeSeconds
      const nextTimeline = { ...timeline, cameraShots }
      sceneHistory.commit((scene) => ({ ...scene, timeline: nextTimeline }))
      showTimelineState(nextTimeline, sceneHistory.scene.camera, timeSeconds)
      return
    }
    const source = timeline.objectKeyframes.find((keyframe) => keyframe.id === id)
    if (!source) return
    const objectKeyframes = moveObjectKeyframe(
      timeline.objectKeyframes,
      id,
      source.timeSeconds + direction * step,
      timeline.durationSeconds
    )
    const timeSeconds =
      objectKeyframes.find((keyframe) => keyframe.id === id)?.timeSeconds ?? source.timeSeconds
    const nextTimeline = { ...timeline, objectKeyframes }
    sceneHistory.commit((scene) => ({ ...scene, timeline: nextTimeline }))
    showTimelineState(nextTimeline, sceneHistory.scene.camera, timeSeconds)
  }

  const undoScene = (): void => {
    setTimelinePlaying(false)
    setTimelinePreviewCamera(null)
    setTimelinePreviewObjects(null)
    sceneHistory.undo()
  }

  const redoScene = (): void => {
    setTimelinePlaying(false)
    setTimelinePreviewCamera(null)
    setTimelinePreviewObjects(null)
    sceneHistory.redo()
  }

  const cancelScheduledAutosave = (): void => {
    autosaveRevisionRef.current += 1
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current)
      autosaveTimerRef.current = null
    }
  }

  const replaceEditorProject = (
    document: ProjectDocument,
    displayName: string,
    filePath: string | null,
    recovered: boolean
  ): void => {
    const nextScene = {
      objects: document.scene.objects,
      camera: cloneCamera(document.scene.camera),
      lighting: structuredClone(document.scene.lighting),
      timeline: structuredClone(document.scene.timeline)
    }
    sceneHistory.reset(nextScene)
    setSelectedIds(nextScene.objects[0]?.id ? [nextScene.objects[0].id] : [])
    setSelectedLightId(null)
    resetModelingDraft(null)
    setSurfacePickObjectId(null)
    setCutTool(null)
    finishQuickBuild()
    setCameraViewMode('none')
    setFirstPersonCameraControl(false)
    setFirstPersonHintVisible(false)
    setCameraControlPreview(null)
    setPaintScope('object')
    timelineTimeRef.current = 0
    setTimelineTime(0)
    setSelectedShotId(null)
    setSelectedObjectKeyframeId(null)
    setTimelinePreviewCamera(null)
    setTimelinePreviewObjects(null)
    setTimelinePlaying(false)
    setInspectorTarget('selection')
    setProjectName(displayName)
    setProjectPath(filePath)
    setSavedFingerprint(
      recovered
        ? ''
        : sceneFingerprint(
            nextScene.objects,
            nextScene.camera,
            nextScene.lighting,
            nextScene.timeline
          )
    )
  }

  const applyOpenedProject = (result: Extract<OpenProjectResult, { status: 'opened' }>): void => {
    cancelScheduledAutosave()
    replaceEditorProject(result.document, result.displayName, result.filePath, false)
    setAutosaveState('idle')
    setRecentProjectsOpen(false)
    setNotice({ kind: 'success', message: `已打开：${result.displayName}` })
  }

  const performNewProject = async (): Promise<void> => {
    cancelScheduledAutosave()
    const nextScene = createInitialScene()
    sceneHistory.reset(nextScene)
    setSelectedIds(nextScene.objects[0]?.id ? [nextScene.objects[0].id] : [])
    setSelectedLightId(null)
    resetModelingDraft(null)
    setSurfacePickObjectId(null)
    setCutTool(null)
    finishQuickBuild()
    setCameraViewMode('none')
    setFirstPersonCameraControl(false)
    setFirstPersonHintVisible(false)
    setCameraControlPreview(null)
    setPaintScope('object')
    timelineTimeRef.current = 0
    setTimelineTime(0)
    setSelectedShotId(null)
    setSelectedObjectKeyframeId(null)
    setTimelinePreviewCamera(null)
    setTimelinePreviewObjects(null)
    setTimelinePlaying(false)
    setInspectorTarget('selection')
    setProjectName('未命名场景')
    setProjectPath(null)
    setSavedFingerprint(
      sceneFingerprint(nextScene.objects, nextScene.camera, nextScene.lighting, nextScene.timeline)
    )
    try {
      await window.desktopApi.project.resetPath()
      setAutosaveState('idle')
      setNotice({ kind: 'success', message: '已新建本地场景' })
    } catch (error) {
      console.error('Failed to reset project path', error)
      setNotice({ kind: 'error', message: '新工程已建立，但无法重置保存路径，请另存为后继续。' })
    }
  }

  const saveProject = async (saveAs = false): Promise<boolean> => {
    setBusy(true)
    try {
      const document = createProjectDocument({
        name: projectName,
        objects: sceneHistory.scene.objects,
        camera: sceneHistory.scene.camera,
        lighting: sceneHistory.scene.lighting,
        timeline: sceneHistory.scene.timeline
      })
      const result = await window.desktopApi.project.save({ document, saveAs })
      if (result.status === 'saved') {
        setProjectName(result.displayName)
        setProjectPath(result.filePath)
        setSavedFingerprint(currentFingerprint)
        setAutosaveState('idle')
        setNotice({
          kind: result.warning ? 'info' : 'success',
          message: result.warning
            ? `工程已保存，但本地记录需要检查：${result.warning}`
            : `工程已保存：${result.displayName}`
        })
        return true
      } else if (result.status === 'error') {
        setNotice({ kind: 'error', message: result.message })
      }
      return false
    } catch (error) {
      console.error('Failed to save project', error)
      setNotice({ kind: 'error', message: '保存工程时发生意外错误，当前场景仍保留在编辑器中。' })
      return false
    } finally {
      setBusy(false)
    }
  }

  const performOpenProject = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.desktopApi.project.open()
      if (result.status === 'opened') {
        applyOpenedProject(result)
      } else if (result.status === 'error') {
        setNotice({ kind: 'error', message: result.message })
      }
    } catch (error) {
      console.error('Failed to open project', error)
      setNotice({ kind: 'error', message: '打开工程时发生意外错误，当前场景没有被替换。' })
    } finally {
      setBusy(false)
    }
  }

  const performOpenRecentProject = async (filePath: string): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.desktopApi.project.openRecent(filePath)
      if (result.status === 'opened') applyOpenedProject(result)
      else if (result.status === 'error') {
        setNotice({ kind: 'error', message: result.message })
        const recentResult = await window.desktopApi.project.listRecent()
        if (recentResult.status === 'loaded') setRecentProjects(recentResult.entries)
      }
    } catch (error) {
      console.error('Failed to open recent project', error)
      setNotice({ kind: 'error', message: '打开最近工程时发生意外错误。' })
    } finally {
      setBusy(false)
    }
  }

  const openRecentProjects = async (): Promise<void> => {
    setRecentProjectsOpen(true)
    setRecentProjectsLoading(true)
    try {
      const result = await window.desktopApi.project.listRecent()
      if (result.status === 'loaded') setRecentProjects(result.entries)
      else setNotice({ kind: 'error', message: result.message })
    } catch (error) {
      console.error('Failed to list recent projects', error)
      setNotice({ kind: 'error', message: '无法读取最近工程记录。' })
    } finally {
      setRecentProjectsLoading(false)
    }
  }

  const requestRecentProject = (filePath: string): void => {
    setRecentProjectsOpen(false)
    if (isDirty) {
      setPendingRecentPath(filePath)
      setPendingAction('open-recent')
    } else void performOpenRecentProject(filePath)
  }

  const removeRecentProjectRecord = async (filePath: string): Promise<void> => {
    setRecentProjectsLoading(true)
    try {
      const result = await window.desktopApi.project.removeRecent(filePath)
      if (result.status === 'loaded') {
        setRecentProjects(result.entries)
        setNotice({ kind: 'info', message: '已移除最近记录，原工程文件仍保留在原位置。' })
      } else setNotice({ kind: 'error', message: result.message })
    } catch (error) {
      console.error('Failed to remove recent project record', error)
      setNotice({ kind: 'error', message: '无法移除最近工程记录。' })
    } finally {
      setRecentProjectsLoading(false)
    }
  }

  const showRecentProjectInFolder = async (filePath: string): Promise<void> => {
    try {
      const result = await window.desktopApi.project.showInFolder(filePath)
      if (result.status === 'error') setNotice({ kind: 'error', message: result.message })
    } catch (error) {
      console.error('Failed to show recent project in folder', error)
      setNotice({ kind: 'error', message: '无法打开工程所在文件夹。' })
    }
  }

  const trashRecentProject = async (): Promise<void> => {
    if (!pendingDeleteProject) return
    setRecentProjectsLoading(true)
    try {
      const result = await window.desktopApi.project.trashRecent(pendingDeleteProject.filePath)
      if (result.status === 'loaded') {
        setRecentProjects(result.entries)
        setPendingDeleteProject(null)
        setNotice({ kind: 'success', message: '工程文件已移入 Windows 回收站，可从回收站恢复。' })
      } else setNotice({ kind: 'error', message: result.message })
    } catch (error) {
      console.error('Failed to trash recent project', error)
      setNotice({ kind: 'error', message: '无法把工程移入 Windows 回收站。' })
    } finally {
      setRecentProjectsLoading(false)
    }
  }

  const clearRecoveryCache = async (): Promise<void> => {
    try {
      const result = await window.desktopApi.project.clearRecovery()
      setNotice(
        result.status === 'ok'
          ? { kind: 'success', message: '自动恢复缓存已清理，不会影响已保存工程。' }
          : { kind: 'error', message: result.message }
      )
    } catch (error) {
      console.error('Failed to clear recovery cache', error)
      setNotice({ kind: 'error', message: '无法清理自动恢复缓存。' })
    }
  }

  const restoreRecovery = async (): Promise<void> => {
    if (!recoverySnapshot) return
    setBusy(true)
    try {
      const result = await window.desktopApi.project.restoreRecovery()
      if (result.status === 'error') {
        setNotice({ kind: 'error', message: result.message })
        return
      }
      cancelScheduledAutosave()
      replaceEditorProject(
        recoverySnapshot.document,
        recoverySnapshot.document.name,
        recoverySnapshot.currentPath,
        true
      )
      setRecoverySnapshot(null)
      setAutosaveState('saved')
      setNotice({ kind: 'success', message: '已恢复上次未保存的工程，请确认后保存。' })
    } catch (error) {
      console.error('Failed to restore recovery snapshot', error)
      setNotice({ kind: 'error', message: '恢复工程时发生意外错误，恢复副本仍然保留。' })
    } finally {
      setBusy(false)
    }
  }

  const discardRecovery = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.desktopApi.project.clearRecovery()
      if (result.status === 'error') {
        setNotice({ kind: 'error', message: result.message })
        return
      }
      setRecoverySnapshot(null)
      setAutosaveState('idle')
      setNotice({ kind: 'info', message: '已放弃未保存的恢复副本。' })
    } catch (error) {
      console.error('Failed to discard recovery snapshot', error)
      setNotice({ kind: 'error', message: '无法清除恢复副本，请重试。' })
    } finally {
      setBusy(false)
    }
  }

  const runPendingAction = async (
    action: PendingAction,
    recentFilePath: string | null = null
  ): Promise<void> => {
    if (action === 'new') await performNewProject()
    else if (action === 'open') await performOpenProject()
    else if (action === 'open-recent') {
      if (recentFilePath) await performOpenRecentProject(recentFilePath)
    } else await window.desktopApi.app.confirmClose()
  }

  const requestProjectAction = (action: PendingAction): void => {
    if (isDirty) setPendingAction(action)
    else void runPendingAction(action)
  }

  const resolvePendingAction = async (saveFirst: boolean): Promise<void> => {
    if (!pendingAction) return
    if (saveFirst && !(await saveProject(false))) return
    const action = pendingAction
    const recentFilePath = pendingRecentPath
    setPendingAction(null)
    setPendingRecentPath(null)
    if (!saveFirst) {
      const clearResult = await window.desktopApi.project.clearRecovery()
      if (clearResult.status === 'error') {
        setNotice({ kind: 'error', message: clearResult.message })
      }
    }
    await runPendingAction(action, recentFilePath)
  }

  const cancelPendingAction = useCallback((): void => {
    if (pendingAction === 'close') void window.desktopApi.app.cancelClose()
    setPendingAction(null)
    setPendingRecentPath(null)
  }, [pendingAction])

  useEffect(() => {
    if (!pendingAction) return undefined
    const cancelOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (pendingAction === 'close') void window.desktopApi.app.cancelClose()
      setPendingAction(null)
      setPendingRecentPath(null)
    }
    window.addEventListener('keydown', cancelOnEscape)
    return () => window.removeEventListener('keydown', cancelOnEscape)
  }, [pendingAction])

  const blockingDialogOpen = Boolean(
    groupConfirmationOpen ||
    onboardingOpen ||
    pendingDeleteProject ||
    qualityReport ||
    pendingOptimizationObject ||
    exportHubOpen ||
    videoExportOpen ||
    modelExportOpen ||
    recentProjectsOpen ||
    recoverySnapshot ||
    pendingAction ||
    videoExportProgress ||
    imageSequenceProgress
  )

  const activeDialogKey = videoExportProgress
    ? 'video-progress'
    : imageSequenceProgress
      ? 'sequence-progress'
      : pendingAction
        ? 'pending-action'
        : recoverySnapshot
          ? 'recovery'
          : pendingDeleteProject
            ? 'project-delete'
            : onboardingOpen
              ? 'onboarding'
              : recentProjectsOpen
                ? 'recent-projects'
                : exportHubOpen
                  ? 'export-hub'
                  : modelExportOpen
                    ? 'model-export'
                    : videoExportOpen
                      ? 'video-export'
                      : pendingOptimizationObject
                        ? 'performance-risk'
                        : qualityReport
                          ? 'quality-report'
                          : groupConfirmationOpen
                            ? 'group-confirmation'
                            : null

  useLayoutEffect(() => {
    if (!activeDialogKey) return undefined
    const dialogs = [
      ...document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')
    ]
    const dialog = dialogs.at(-1)
    if (!dialog) return undefined

    const activeElement =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previouslyFocused =
      activeElement && !activeElement.closest('[role="dialog"]')
        ? activeElement
        : lastNonDialogFocusRef.current
    const appShell = dialog.closest<HTMLElement>('.app-shell')
    const backdrop = dialog.closest<HTMLElement>('.dialog-backdrop')
    const backgroundStates = appShell
      ? [...appShell.children]
          .filter(
            (child): child is HTMLElement => child instanceof HTMLElement && child !== backdrop
          )
          .map((element) => ({
            element,
            inert: element.inert,
            ariaHidden: element.getAttribute('aria-hidden')
          }))
      : []

    for (const state of backgroundStates) {
      state.element.inert = true
      state.element.setAttribute('aria-hidden', 'true')
    }

    const focusableSelector = [
      '[autofocus]',
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])'
    ].join(',')
    const focusableElements = (): HTMLElement[] =>
      [...dialog.querySelectorAll<HTMLElement>(focusableSelector)].filter(
        (element) =>
          element.getClientRects().length > 0 && element.getAttribute('aria-hidden') !== 'true'
      )
    const initialFocus = focusableElements()[0] ?? dialog
    if (!dialog.hasAttribute('tabindex')) dialog.tabIndex = -1
    initialFocus.focus({ preventScroll: true })

    const handleDialogKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        switch (activeDialogKey) {
          case 'video-progress':
          case 'sequence-progress':
          case 'recovery':
            return
          case 'onboarding':
            window.localStorage.setItem(onboardingStorageKey, 'true')
            setOnboardingOpen(false)
            return
          case 'project-delete':
            setPendingDeleteProject(null)
            return
          case 'pending-action':
            cancelPendingAction()
            return
          case 'recent-projects':
            setRecentProjectsOpen(false)
            return
          case 'export-hub':
            setExportHubOpen(false)
            return
          case 'model-export':
            setModelExportOpen(false)
            return
          case 'video-export':
            if (!busy) setVideoExportOpen(false)
            return
          case 'performance-risk':
            setPendingOptimizationObjectId(null)
            setNotice({
              kind: 'info',
              message: '继续使用原始模型，可在右侧随时开启轻量预览。'
            })
            return
          case 'quality-report':
            setQualityReport(null)
            return
          case 'group-confirmation':
            setGroupConfirmationOpen(false)
            return
          default:
            return
        }
      }
      if (event.key !== 'Tab') return

      const elements = focusableElements()
      if (elements.length === 0) {
        event.preventDefault()
        dialog.focus({ preventScroll: true })
        return
      }
      const first = elements[0]
      const last = elements[elements.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus({ preventScroll: true })
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus({ preventScroll: true })
      } else if (!dialog.contains(document.activeElement)) {
        event.preventDefault()
        first.focus({ preventScroll: true })
      }
    }

    document.addEventListener('keydown', handleDialogKeyDown, true)
    return () => {
      document.removeEventListener('keydown', handleDialogKeyDown, true)
      for (const state of backgroundStates) {
        state.element.inert = state.inert
        if (state.ariaHidden === null) state.element.removeAttribute('aria-hidden')
        else state.element.setAttribute('aria-hidden', state.ariaHidden)
      }
      if (previouslyFocused?.isConnected) {
        window.requestAnimationFrame(() => {
          if (previouslyFocused.isConnected) previouslyFocused.focus({ preventScroll: true })
        })
      }
    }
  }, [activeDialogKey, busy, cancelPendingAction])

  const exportImage = async (): Promise<void> => {
    const report = inspectSceneQuality(sceneHistory.scene.objects)
    if (report.status === 'error' || report.objectCount === 0) {
      setExportHubOpen(false)
      setQualityReport(report)
      setNotice({
        kind: 'error',
        message:
          report.objectCount === 0 ? '请先添加模型再导出图片。' : '模型存在错误，请先查看质量检查。'
      })
      return
    }
    const captured = viewportRef.current?.captureImageBase64(
      imageExportFormat,
      imageExportDimension
    )
    if (!captured?.base64Data) {
      setNotice({ kind: 'error', message: '当前画面还没有准备好，请稍后重试。' })
      return
    }
    setBusy(true)
    try {
      const result = await window.desktopApi.image.savePng({
        base64Data: captured.base64Data,
        suggestedName: `${projectName}.${imageExportFormat}`,
        format: imageExportFormat
      })
      if (result.status === 'saved') {
        setExportHubOpen(false)
        setNotice({
          kind: report.status === 'warning' ? 'info' : 'success',
          message: `图片已导出：${result.displayName}（${captured.width}×${captured.height}）`
        })
      } else if (result.status === 'error') {
        setNotice({ kind: 'error', message: result.message })
      }
    } catch (error) {
      console.error('Failed to export PNG', error)
      setNotice({ kind: 'error', message: '导出图片时发生意外错误，请更换保存位置后重试。' })
    } finally {
      setBusy(false)
    }
  }

  const exportAnimationFrames = async (): Promise<void> => {
    const timeline = sceneHistory.scene.timeline
    if (
      timeline.cameraShots.length === 0 &&
      timeline.objectKeyframes.length === 0 &&
      !hasMannequinAction
    ) {
      setNotice({ kind: 'info', message: '请先在时间轴记录镜头或物体状态。' })
      return
    }
    const originalTime = timelineTimeRef.current
    const totalFrames =
      timeToFrameIndex(timeline.durationSeconds, timeline.durationSeconds, TIMELINE_FRAME_RATE) + 1
    const firstState = evaluateTimelineFrame(
      timeline,
      sceneHistory.scene.camera,
      0,
      TIMELINE_FRAME_RATE
    )
    const firstFrame = viewportRef.current?.captureFrameBase64(
      firstState.camera,
      firstState.objectTransforms,
      firstState.timeSeconds
    )
    if (!firstFrame?.base64Data) {
      setNotice({ kind: 'error', message: '动画画面还没有准备好，请稍后重试。' })
      return
    }

    setTimelinePlaying(false)
    setBusy(true)
    imageSequenceCancelRef.current = false
    let sessionId: string | null = null
    let sessionClosed = false
    try {
      const opened = await window.desktopApi.image.beginSequence({
        suggestedBaseName: projectName,
        frameRate: TIMELINE_FRAME_RATE,
        totalFrames,
        width: firstFrame.width,
        height: firstFrame.height
      })
      if (opened.status === 'cancelled') return
      if (opened.status === 'error') {
        setNotice({ kind: 'error', message: opened.message })
        return
      }
      sessionId = opened.sessionId
      setImageSequenceProgress({
        current: 0,
        total: totalFrames,
        directoryPath: opened.directoryPath,
        cancelling: false
      })

      for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
        if (imageSequenceCancelRef.current) {
          const cancelled = await window.desktopApi.image.cancelSequence({ sessionId })
          sessionClosed = true
          setNotice({
            kind: cancelled.status === 'error' ? 'error' : 'info',
            message:
              cancelled.status === 'error'
                ? cancelled.message
                : `已取消，保留 ${cancelled.fileCount} 张已生成画面并标记为未完成。`
          })
          return
        }

        const captured =
          frameIndex === 0
            ? firstFrame
            : (() => {
                const state = evaluateTimelineFrame(
                  timeline,
                  sceneHistory.scene.camera,
                  frameIndex,
                  TIMELINE_FRAME_RATE
                )
                return viewportRef.current?.captureFrameBase64(
                  state.camera,
                  state.objectTransforms,
                  state.timeSeconds
                )
              })()
        if (!captured?.base64Data) throw new Error(`第 ${frameIndex + 1} 张画面渲染失败。`)
        const written = await window.desktopApi.image.writeSequenceFrame({
          sessionId,
          frameIndex,
          base64Data: captured.base64Data
        })
        if (written.status === 'error') throw new Error(written.message)
        setImageSequenceProgress((current) =>
          current ? { ...current, current: frameIndex + 1 } : current
        )
      }

      const finished = await window.desktopApi.image.finishSequence({ sessionId })
      if (finished.status === 'error') throw new Error(finished.message)
      sessionClosed = true
      setNotice({
        kind: 'success',
        message: `动画帧已导出：${finished.fileCount} 张 PNG`
      })
    } catch (error) {
      if (sessionId && !sessionClosed) {
        await window.desktopApi.image.cancelSequence({ sessionId })
      }
      const detail = error instanceof Error ? error.message : '未知错误'
      setNotice({ kind: 'error', message: `导出动画帧失败：${detail}` })
    } finally {
      setImageSequenceProgress(null)
      setBusy(false)
      showTimelineState(timeline, sceneHistory.scene.camera, originalTime)
    }
  }

  const openVideoExport = (): void => {
    if (cameraShots.length === 0 && objectKeyframes.length === 0 && !hasMannequinAction) {
      setNotice({ kind: 'info', message: '请先在时间轴记录镜头或物体状态。' })
      return
    }
    setVideoExportOpen(true)
  }

  const exportAnimationVideo = async (): Promise<void> => {
    const profile = selectedVideoProfile
    const validation = validateVideoProfile(
      profile,
      sceneHistory.scene.timeline.durationSeconds,
      sceneHistory.scene.camera.aspectWidth,
      sceneHistory.scene.camera.aspectHeight
    )
    if (validation.errors.length > 0) {
      setNotice({ kind: 'error', message: validation.errors[0] })
      return
    }

    const timeline = sceneHistory.scene.timeline
    const framePlan = createVideoFramePlan(timeline.durationSeconds, profile.frameRate)
    const firstState = evaluateTimelineAtTime(timeline, sceneHistory.scene.camera, 0)
    const size = outputSize(firstState.camera, profile.maxDimension)
    setBusy(true)
    videoExportCancelRef.current = false
    let sessionId: string | null = null
    let sessionClosed = false
    let encoder: Awaited<ReturnType<typeof createMp4VideoEncoder>> | null = null
    try {
      if (!(await canEncodeH264Video(size.width, size.height, profile.bitrate))) {
        setNotice({
          kind: 'error',
          message: '当前电脑无法使用 H.264 视频编码。可先导出 PNG 动画帧，不会静默降低格式。'
        })
        return
      }

      const opened = await window.desktopApi.video.begin({
        suggestedName: `${projectName}_${profile.name}`,
        presetId: profile.id,
        frameRate: profile.frameRate,
        totalFrames: framePlan.totalFrames,
        width: size.width,
        height: size.height
      })
      if (opened.status === 'cancelled') return
      if (opened.status === 'error') throw new Error(opened.message)
      sessionId = opened.sessionId
      setVideoExportOpen(false)
      setVideoExportProgress({
        current: 0,
        total: framePlan.totalFrames,
        filePath: opened.filePath,
        cancelling: false
      })

      encoder = await createMp4VideoEncoder({
        width: size.width,
        height: size.height,
        frameRate: profile.frameRate,
        totalFrames: framePlan.totalFrames,
        bitrate: profile.bitrate,
        writeChunk: async (position, data) => {
          if (!sessionId) throw new Error('视频文件会话已经结束。')
          const written = await window.desktopApi.video.writeChunk({ sessionId, position, data })
          if (written.status === 'error') throw new Error(written.message)
        }
      })

      for (let frameIndex = 0; frameIndex < framePlan.totalFrames; frameIndex += 1) {
        if (videoExportCancelRef.current) {
          await encoder.cancel()
          const cancelled = await window.desktopApi.video.cancel({ sessionId })
          sessionClosed = true
          setNotice({
            kind: cancelled.status === 'error' ? 'error' : 'info',
            message:
              cancelled.status === 'error'
                ? cancelled.message
                : '视频导出已取消，未完成的临时文件已清理。'
          })
          return
        }

        const state = evaluateTimelineAtTime(
          timeline,
          sceneHistory.scene.camera,
          framePlan.sourceTimeSeconds(frameIndex)
        )
        const copied = viewportRef.current?.copyFrameToCanvas(
          state.camera,
          state.objectTransforms,
          encoder.canvas,
          profile.maxDimension,
          state.timeSeconds
        )
        if (!copied || copied.width !== size.width || copied.height !== size.height) {
          throw new Error(`第 ${frameIndex + 1} 帧渲染失败。`)
        }
        await encoder.addFrame(frameIndex)
        setVideoExportProgress((current) =>
          current ? { ...current, current: frameIndex + 1 } : current
        )
      }

      await encoder.finalize()
      const finished = await window.desktopApi.video.finish({ sessionId })
      sessionClosed = true
      if (finished.status === 'error') throw new Error(finished.message)
      if (finished.status !== 'saved') throw new Error('视频文件没有完成保存。')
      setNotice({
        kind: 'success',
        message: `视频已导出：${finished.displayName}（${size.width}×${size.height}，${profile.frameRate} 帧/秒）`
      })
    } catch (error) {
      if (encoder) await encoder.cancel().catch(() => undefined)
      if (sessionId && !sessionClosed) await window.desktopApi.video.cancel({ sessionId })
      const detail = error instanceof Error ? error.message : '未知错误'
      setNotice({ kind: 'error', message: `导出视频失败：${detail}` })
    } finally {
      setVideoExportProgress(null)
      setBusy(false)
    }
  }

  const focusView = (objectIds: string | string[] | null = selectedIds): void => {
    const result = viewportRef.current?.focusView(objectIds)
    if (!result) return
    if (result.scope === 'object') {
      const object = sceneHistory.scene.objects.find((item) => item.id === result.objectId)
      setNotice({ kind: 'info', message: `已聚焦查看：${object?.name ?? '当前对象'}` })
    } else if (result.scope === 'scene') {
      setNotice({ kind: 'info', message: '已显示全部可见对象' })
    } else if (result.scope === 'selection') {
      setNotice({ kind: 'info', message: '已聚焦查看所选对象' })
    } else {
      setNotice({ kind: 'info', message: '空场景已回到中心视角' })
    }
  }

  useEffect(() => {
    if (!timelinePlaying) return undefined
    const duration = sceneHistory.scene.timeline.durationSeconds
    const timeline = sceneHistory.scene.timeline
    const baseCamera = sceneHistory.scene.camera
    const startedAt = performance.now() - timelineTimeRef.current * 1000
    let animationFrame = 0
    const tick = (now: number): void => {
      const nextTime = Math.min((now - startedAt) / 1000, duration)
      const evaluated = evaluateTimelineAtTime(timeline, baseCamera, nextTime)
      timelineTimeRef.current = evaluated.timeSeconds
      setTimelineTime(evaluated.timeSeconds)
      setTimelinePreviewCamera(timeline.cameraShots.length > 0 ? evaluated.camera : null)
      setTimelinePreviewObjects(evaluated.objectTransforms)
      if (nextTime >= duration) {
        setTimelinePlaying(false)
        return
      }
      animationFrame = window.requestAnimationFrame(tick)
    }
    animationFrame = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(animationFrame)
  }, [sceneHistory.scene.camera, sceneHistory.scene.timeline, timelinePlaying])

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent): void => {
      const target = event.target
      const isTextEditing =
        target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
      const key = event.key.toLowerCase()

      if (blockingDialogOpen) return

      if (event.ctrlKey && key === 'n') {
        event.preventDefault()
        if (!busy) requestProjectAction('new')
        return
      }
      if (event.ctrlKey && key === 'o') {
        event.preventDefault()
        if (!busy) requestProjectAction('open')
        return
      }
      if (event.ctrlKey && key === 's') {
        event.preventDefault()
        if (!busy) void saveProject(event.shiftKey)
        return
      }
      if (event.key === 'Escape' && firstPersonCameraControl) {
        event.preventDefault()
        exitFirstPersonCameraControl()
        return
      }
      if (event.key === 'Escape' && cameraPreview) {
        event.preventDefault()
        setCameraViewMode('none')
        return
      }

      if (isTextEditing) return

      if (event.key === 'Escape' && quickBuildTool) {
        event.preventDefault()
        finishQuickBuild()
      } else if (event.key === 'Escape' && surfacePickObjectId) {
        event.preventDefault()
        setSurfacePickObjectId(null)
      } else if (event.key === 'Escape' && paintScope === 'face') {
        event.preventDefault()
        setPaintScope('object')
      } else if (event.key === 'Escape' && cutTool) {
        event.preventDefault()
        setCutTool(null)
      } else if (event.key === 'Escape' && modelingDraft) {
        event.preventDefault()
        resetModelingDraft(null)
        setModelingError(null)
      } else if (event.ctrlKey && key === 'z') {
        event.preventDefault()
        if (modelingDraft) {
          if (event.shiftKey) redoModelingDraft()
          else undoModelingDraft()
        } else if (event.shiftKey) redoScene()
        else undoScene()
      } else if (event.ctrlKey && key === 'y') {
        event.preventDefault()
        if (modelingDraft) redoModelingDraft()
        else redoScene()
      } else if (event.key === 'Delete' && selectedIds.length > 0) {
        event.preventDefault()
        deleteSelected()
      } else if (event.key === 'Delete' && selectedLightId) {
        event.preventDefault()
        deleteLight(selectedLightId)
      }
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  })

  return (
    <main className="app-shell" aria-label="编辑器工作区">
      <header className="command-bar" aria-label="顶部命令栏">
        <div className="brand-area">
          <div className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 1024 1024">
              <rect width="1024" height="1024" fill="#ffffff" />
              <path
                d="M512 150 804 318 804 650 512 818 220 650 220 318 512 150M220 318 512 486 804 318M512 486 512 818"
                fill="none"
                stroke="#000000"
                strokeWidth="64"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div className="brand-copy">
            <strong>{APP_NAME}</strong>
            <span title={projectPath ?? fileStateLabel}>
              {projectName}
              {isDirty ? ' *' : ''} · v{APP_VERSION}
            </span>
          </div>
        </div>

        <div className="command-group" aria-label="文件和编辑命令">
          <CommandButton
            label="新建项目 (Ctrl+N)"
            text="新建"
            disabled={busy}
            onClick={() => requestProjectAction('new')}
          >
            <FilePlus2 />
          </CommandButton>
          <CommandButton
            label="打开项目 (Ctrl+O)"
            text="打开"
            disabled={busy}
            onClick={() => requestProjectAction('open')}
          >
            <FolderOpen />
          </CommandButton>
          <CommandButton
            label="本地项目"
            text="项目"
            disabled={busy}
            onClick={() => void openRecentProjects()}
          >
            <History />
          </CommandButton>
          <CommandButton
            label="保存项目 (Ctrl+S)"
            text="保存"
            disabled={busy}
            onClick={() => void saveProject(false)}
          >
            <Save />
          </CommandButton>
          <CommandButton
            label="另存为 (Ctrl+Shift+S)"
            disabled={busy}
            onClick={() => void saveProject(true)}
          >
            <SaveAll />
          </CommandButton>
          <span className="toolbar-divider" />
          <CommandButton
            label="撤销"
            disabled={modelingDraft ? modelingHistory.past.length === 0 : !sceneHistory.canUndo}
            onClick={modelingDraft ? undoModelingDraft : undoScene}
          >
            <Undo2 />
          </CommandButton>
          <CommandButton
            label="重做"
            disabled={modelingDraft ? modelingHistory.future.length === 0 : !sceneHistory.canRedo}
            onClick={modelingDraft ? redoModelingDraft : redoScene}
          >
            <Redo2 />
          </CommandButton>
          <span className="toolbar-divider" />
          <nav className="workspace-mode-switch" aria-label="工作步骤">
            {(
              [
                ['scene', '搭场景', Shapes],
                ['camera', '调镜头', Camera],
                ['animation', '做动画', Clock3]
              ] as const
            ).map(([mode, label, Icon]) => (
              <button
                key={mode}
                type="button"
                className={workspaceMode === mode ? 'is-active' : ''}
                aria-pressed={workspaceMode === mode}
                onClick={() => changeWorkspaceMode(mode)}
              >
                <Icon aria-hidden="true" />
                <span>{label}</span>
              </button>
            ))}
          </nav>
          <span className="toolbar-divider" />
          <CommandButton
            label="导出图片、视频或三维模型"
            text="导出"
            disabled={busy}
            onClick={() => setExportHubOpen(true)}
          >
            <Download />
          </CommandButton>
        </div>

        <div className="command-actions">
          <div
            className={`local-state autosave-${autosaveState}`}
            title={projectPath ?? `${fileStateLabel}；${autosaveStateLabel[autosaveState]}`}
          >
            <HardDrive aria-hidden="true" />
            <span>
              {fileStateLabel}
              <small>{autosaveStateLabel[autosaveState]}</small>
            </span>
          </div>
          <CommandButton label="打开新手帮助" onClick={() => setOnboardingOpen(true)}>
            <CircleHelp />
          </CommandButton>
          <CommandButton
            label={theme === 'light' ? '切换到黑色主题' : '切换到白色主题'}
            onClick={() => setTheme((current) => (current === 'light' ? 'dark' : 'light'))}
          >
            {theme === 'light' ? <Moon /> : <Sun />}
          </CommandButton>
        </div>
      </header>

      <div className={`editor-body${busy ? ' is-busy' : ''}`} aria-busy={busy}>
        <aside className="left-panel" aria-label="场景对象">
          <section className="panel-section create-section">
            <div className="section-heading">
              <h2>添加</h2>
              <span>基础形状</span>
            </div>
            <div className="primitive-grid">
              <button
                type="button"
                aria-label="添加方块"
                disabled={Boolean(modelingDraft)}
                onClick={() => addObject('box')}
              >
                <Box aria-hidden="true" />
                <span>方块</span>
              </button>
              <button
                type="button"
                aria-label="添加圆柱"
                disabled={Boolean(modelingDraft)}
                onClick={() => addObject('cylinder')}
              >
                <CircleDot aria-hidden="true" />
                <span>圆柱</span>
              </button>
              <button
                type="button"
                aria-label="添加球体"
                disabled={Boolean(modelingDraft)}
                onClick={() => addObject('sphere')}
              >
                <Circle aria-hidden="true" />
                <span>球体</span>
              </button>
              <button
                type="button"
                aria-label="添加墙体"
                disabled={Boolean(modelingDraft)}
                onClick={() => addObject('wall')}
              >
                <BrickWall aria-hidden="true" />
                <span>墙体</span>
              </button>
              <button
                type="button"
                aria-label="添加地面"
                disabled={Boolean(modelingDraft)}
                onClick={() => addObject('floor')}
              >
                <PanelTop aria-hidden="true" />
                <span>地面</span>
              </button>
              <button
                type="button"
                aria-label="绘制自定义形状"
                className={modelingDraft ? 'is-active' : ''}
                onClick={() => beginCanvasModeling('ground')}
              >
                <Shapes aria-hidden="true" />
                <span>自定义</span>
              </button>
              <button
                type="button"
                aria-label="添加可摆姿势人台"
                disabled={Boolean(modelingDraft)}
                onClick={addMannequin}
              >
                <PersonStanding aria-hidden="true" />
                <span>人台</span>
              </button>
              <button
                type="button"
                aria-label="导入本地模型"
                disabled={busy || Boolean(modelingDraft)}
                onClick={() => void importModel()}
              >
                <Upload aria-hidden="true" />
                <span>导入</span>
              </button>
            </div>
            <button
              className={`quick-build-launch${quickBuildTool ? ' is-active' : ''}`}
              type="button"
              aria-pressed={Boolean(quickBuildTool)}
              disabled={Boolean(modelingDraft)}
              onClick={() => (quickBuildTool ? finishQuickBuild() : beginQuickBuild('wall'))}
            >
              <Route aria-hidden="true" />
              <span>连续铺设</span>
            </button>
          </section>

          <section className="panel-section edit-mode-section">
            <div className="section-heading">
              <h2>编辑方式</h2>
              <span>选择后直接拖动</span>
            </div>
            <div className="mode-segment" aria-label="对象编辑方式">
              <button
                type="button"
                className={transformMode === 'translate' ? 'is-active' : ''}
                aria-pressed={transformMode === 'translate'}
                onClick={() => setTransformMode('translate')}
              >
                <Move3d aria-hidden="true" />
                <span>移动</span>
              </button>
              <button
                type="button"
                className={transformMode === 'rotate' ? 'is-active' : ''}
                aria-pressed={transformMode === 'rotate'}
                onClick={() => setTransformMode('rotate')}
              >
                <Rotate3d aria-hidden="true" />
                <span>{inspectorTarget === 'camera' ? '转向' : '旋转'}</span>
              </button>
              <button
                type="button"
                className={transformMode === 'scale' ? 'is-active' : ''}
                aria-pressed={transformMode === 'scale'}
                disabled={inspectorTarget === 'camera' || selectedObject?.kind === 'mannequin'}
                title={
                  inspectorTarget === 'camera'
                    ? '摄影机使用镜头视野调整画面大小'
                    : selectedObject?.kind === 'mannequin'
                      ? '人台使用参考身高保持正常身体比例'
                      : undefined
                }
                onClick={() => setTransformMode('scale')}
              >
                <Scaling aria-hidden="true" />
                <span>拉伸</span>
              </button>
            </div>
            {inspectorTarget !== 'camera' ? (
              <button
                className={`snap-toggle${snappingEnabled ? ' is-active' : ''}`}
                type="button"
                aria-pressed={snappingEnabled}
                onClick={() => setSnappingEnabled((current) => !current)}
              >
                <Magnet aria-hidden="true" />
                <span>边缘吸附</span>
                <strong>{snappingEnabled ? '开启' : '关闭'}</strong>
              </button>
            ) : null}
          </section>

          <section className="panel-section object-section">
            <div className="section-heading">
              <h2>场景</h2>
              <span>{sceneHistory.scene.objects.length} 个模型</span>
            </div>
            <div className="object-list" role="list">
              {sceneHistory.scene.objects.map((object) => (
                <div
                  className={`object-row${selectedIds.includes(object.id) ? ' is-selected' : ''}`}
                  role="listitem"
                  key={object.id}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    showObjectMenu(object.id, event.clientX, event.clientY)
                  }}
                >
                  <button
                    className="object-select"
                    type="button"
                    aria-label={`选择 ${object.name}`}
                    onClick={(event) => selectFromList(object.id, event.ctrlKey || event.metaKey)}
                  >
                    {object.groupId ? <Group aria-hidden="true" /> : objectIcon(object.kind)}
                    <span>{object.name}</span>
                  </button>
                  <button
                    className="object-state-button"
                    type="button"
                    aria-label={`${object.visible ? '隐藏' : '显示'} ${object.name}`}
                    title={object.visible ? '隐藏' : '显示'}
                    onClick={() => updateObject(object.id, { visible: !object.visible })}
                  >
                    {object.visible ? <Eye /> : <EyeOff />}
                  </button>
                  <button
                    className="object-state-button"
                    type="button"
                    aria-label={`${object.locked ? '解锁' : '锁定'} ${object.name}`}
                    title={object.locked ? '解锁' : '锁定'}
                    onClick={() => updateObject(object.id, { locked: !object.locked })}
                  >
                    {object.locked ? <Lock /> : <LockOpen />}
                  </button>
                </div>
              ))}
              <div
                className={`object-row system-object${inspectorTarget === 'camera' ? ' is-selected' : ''}`}
                role="listitem"
                onContextMenu={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  enterFirstPersonCameraControl()
                }}
              >
                <button
                  className="object-select"
                  type="button"
                  title="右键进入第一人称控制"
                  onClick={() => {
                    setSelectedIds([])
                    setSelectedLightId(null)
                    setInspectorTarget('camera')
                    setTimelinePreviewCamera(null)
                    setCameraViewMode('monitor')
                  }}
                >
                  <Camera aria-hidden="true" />
                  <span>主相机</span>
                </button>
              </div>
              <div
                className={`object-row system-object${inspectorTarget === 'ambient' ? ' is-selected' : ''}`}
                role="listitem"
              >
                <button
                  className="object-select"
                  type="button"
                  onClick={() => {
                    setSelectedIds([])
                    setSelectedLightId(null)
                    setInspectorTarget('ambient')
                  }}
                >
                  <Lightbulb aria-hidden="true" />
                  <span>固定场景光</span>
                </button>
              </div>
              {sceneHistory.scene.lighting.lights.map((light) => (
                <div
                  className={`object-row system-object${selectedLightId === light.id ? ' is-selected' : ''}`}
                  role="listitem"
                  key={light.id}
                >
                  <button
                    className="object-select"
                    type="button"
                    onClick={() => {
                      setSelectedIds([])
                      setSelectedLightId(light.id)
                      setInspectorTarget('light')
                    }}
                  >
                    <Lightbulb aria-hidden="true" />
                    <span>{light.name}</span>
                  </button>
                  <button
                    className="object-state-button"
                    type="button"
                    aria-label={`${light.visible ? '隐藏' : '显示'} ${light.name}`}
                    onClick={() => updateLight(light.id, { visible: !light.visible })}
                  >
                    {light.visible ? <Eye /> : <EyeOff />}
                  </button>
                  <button
                    className="object-state-button"
                    type="button"
                    aria-label={`${light.locked ? '解锁' : '锁定'} ${light.name}`}
                    onClick={() => updateLight(light.id, { locked: !light.locked })}
                  >
                    {light.locked ? <Lock /> : <LockOpen />}
                  </button>
                </div>
              ))}
            </div>
          </section>
        </aside>

        <section className="viewport-panel" aria-label="三维场景">
          <SceneViewport
            ref={viewportRef}
            theme={theme}
            objects={sceneHistory.scene.objects}
            selectedIds={selectedIds}
            transformMode={transformMode}
            cameraState={displayedCamera}
            lighting={displayedLighting}
            cameraPreview={cameraPreview}
            cameraMonitor={cameraMonitor}
            firstPersonCameraControl={firstPersonCameraControl}
            cameraSelected={inspectorTarget === 'camera' && !timelinePreviewCamera}
            selectedLightId={selectedLightId}
            modelingDraft={modelingDraft}
            modelingElementMode={modelingElementMode}
            surfacePickObjectId={surfacePickObjectId}
            facePaintObjectId={facePaintObjectId}
            facePaintColor={paintColor}
            objectTransformPreview={timelinePreviewObjects}
            mannequinActionTimeSeconds={timelineTime}
            cutPreview={cutTool}
            quickBuildTool={quickBuildTool}
            quickBuildDraft={quickBuildDraft}
            mannequinPoseEditing={
              mannequinEditMode === 'pose' && selectedObject?.kind === 'mannequin'
            }
            selectedMannequinJoint={selectedMannequinJoint}
            onSelectionChange={handleCanvasSelection}
            onTransformMany={handleTransformMany}
            onModelingDraftChange={(draft, historyMode) => {
              changeModelingDraft(draft, historyMode)
              if (historyMode !== 'replace') setModelingError(null)
            }}
            onModelingIssue={setModelingError}
            onSurfacePick={handleSurfacePick}
            onFacePaint={paintObjectFaces}
            onQuickBuildDraftChange={setQuickBuildDraft}
            onQuickBuildCommit={commitQuickBuild}
            onQuickBuildIssue={setQuickBuildIssue}
            onMannequinJointSelect={setSelectedMannequinJoint}
            onMannequinPoseChange={updateMannequinPose}
            onSceneCameraChange={handleCameraChange}
            onFirstPersonCameraChange={(nextCamera, commit) => {
              if (commit) handleCameraChange(nextCamera)
              else setCameraControlPreview(nextCamera)
            }}
            onCameraPreviewRequest={() => {
              setPaintScope('object')
              setSelectedIds([])
              setSelectedLightId(null)
              setInspectorTarget('camera')
              setTimelinePreviewCamera(null)
              setCameraViewMode('monitor')
            }}
            onCameraMonitorClose={() => {
              exitFirstPersonCameraControl()
              setCameraViewMode('none')
            }}
            onLightPositionChange={(id, position) => updateLight(id, { position })}
            onObjectContextMenu={showObjectMenu}
            onImportError={(_objectId, message) => setNotice({ kind: 'error', message })}
            onOptimizationReport={(objectId, report) =>
              setOptimizationReports((current) => {
                const next = new Map(current)
                if (report) next.set(objectId, report)
                else next.delete(objectId)
                return next
              })
            }
          />
          {cameraPreview ? (
            <button
              className="camera-preview-exit"
              type="button"
              onClick={() => setCameraViewMode('none')}
            >
              <X aria-hidden="true" />
              <span>退出镜头预览</span>
            </button>
          ) : null}
          {firstPersonCameraControl && !cameraPreview ? (
            <div className="first-person-mode" aria-label="第一人称控制已开启">
              <Move3d aria-hidden="true" />
              <span>第一人称控制</span>
              <button type="button" onClick={exitFirstPersonCameraControl}>
                退出
              </button>
            </div>
          ) : null}
          {firstPersonHintVisible && firstPersonCameraControl && !cameraPreview ? (
            <div className="first-person-hint" role="status">
              <strong>第一人称控制</strong>
              <span>画布操作同步镜头 · 物体仍可选择和编辑 · Esc 退出</span>
            </div>
          ) : null}
          {quickBuildTool ? (
            <div className="quick-build-toolbar" aria-label="快速铺设工具">
              <div className="quick-build-kind" role="group" aria-label="铺设类型">
                <button
                  type="button"
                  className={quickBuildTool === 'wall' ? 'is-active' : ''}
                  aria-pressed={quickBuildTool === 'wall'}
                  onClick={() => beginQuickBuild('wall')}
                >
                  <BrickWall aria-hidden="true" />
                  <span>墙体</span>
                </button>
                <button
                  type="button"
                  className={quickBuildTool === 'floor' ? 'is-active' : ''}
                  aria-pressed={quickBuildTool === 'floor'}
                  onClick={() => beginQuickBuild('floor')}
                >
                  <PanelTop aria-hidden="true" />
                  <span>地面</span>
                </button>
              </div>
              <output className={quickBuildIssue ? 'is-error' : ''}>
                {quickBuildIssue ??
                  (quickBuildDraft ? quickBuildMeasurement(quickBuildDraft) : '起点')}
              </output>
              <button type="button" className="quick-build-finish" onClick={finishQuickBuild}>
                完成
              </button>
            </div>
          ) : null}
          {surfacePickObjectId ? (
            <div className="surface-pick-toolbar" aria-label="选择模型表面">
              <ScanSearch aria-hidden="true" />
              <span>选择模型面</span>
              <button type="button" onClick={() => setSurfacePickObjectId(null)}>
                取消
              </button>
            </div>
          ) : null}
          {facePaintObjectId ? (
            <div className="face-paint-toolbar" aria-label="单个面上色">
              <span className="paint-color-swatch" style={{ backgroundColor: paintColor }} />
              <span>单个面上色</span>
              <button type="button" onClick={() => setPaintScope('object')}>
                完成
              </button>
            </div>
          ) : null}
          {modelingDraft ? (
            <div className="modeling-toolbar" aria-label="画布建模工具">
              <div className="modeling-mode-segment" aria-label="点线面编辑">
                {(
                  [
                    ['vertex', '点'],
                    ['edge', '线'],
                    ['face', '面']
                  ] as Array<[MeshElementMode, string]>
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    className={modelingElementMode === mode ? 'is-active' : ''}
                    aria-pressed={modelingElementMode === mode}
                    onClick={() => setModelingElementMode(mode)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label className="modeling-plane-select">
                <span>绘制平面</span>
                <select
                  value={modelingDraft.planeMode}
                  disabled={modelingDraft.vertices.length > 0 || Boolean(modelingDraft.objectId)}
                  onChange={(event) => beginCanvasModeling(event.target.value as ModelingPlaneMode)}
                >
                  <option value="ground">地面</option>
                  <option value="view">面对当前视角</option>
                  {modelingDraft.planeMode === 'surface' ? (
                    <option value="surface">所选模型面</option>
                  ) : null}
                </select>
              </label>
              <button
                type="button"
                disabled={modelingHistory.past.length === 0}
                onClick={undoModelingDraft}
              >
                撤回一步
              </button>
              <button
                type="button"
                className="modeling-primary"
                disabled={
                  modelingDraft.vertices.length < 3 && modelingDraft.selectedEdges.length < 3
                }
                onClick={closeDraftFace}
              >
                {modelingDraft.selectedEdges.length >= 3 ? '所选线成面' : '闭合线成面'}
              </button>
              {modelingDraft.selectedFace !== null ? (
                <>
                  <label className="modeling-depth-control">
                    <span>拉伸距离</span>
                    <input
                      aria-label="拉伸距离"
                      type="number"
                      min="-100"
                      max="100"
                      step="0.1"
                      value={modelingDraft.extrusion}
                      onChange={(event) =>
                        changeModelingDraft(
                          { ...modelingDraft, extrusion: Number(event.target.value) },
                          'push'
                        )
                      }
                    />
                  </label>
                  <button type="button" onClick={extrudeSelectedModelingFace}>
                    拉伸所选面
                  </button>
                  {modelingDraft.objectId ? (
                    <button type="button" onClick={beginSurfaceModeling}>
                      在此面继续画
                    </button>
                  ) : null}
                </>
              ) : null}
              {modelingError ? <span className="modeling-error">{modelingError}</span> : null}
              <button
                type="button"
                className="modeling-cancel"
                onClick={() => {
                  resetModelingDraft(null)
                  setModelingError(null)
                }}
              >
                取消
              </button>
              <button
                type="button"
                className="modeling-primary"
                disabled={modelingDraft.faces.length === 0}
                onClick={finishCanvasModeling}
              >
                完成模型
              </button>
            </div>
          ) : null}
          {cutTool && cutObject ? (
            <div className="cut-toolbar" aria-label="平面切割工具">
              <div className="cut-axis-segment" aria-label="切割方向">
                {(
                  [
                    ['x', '左右'],
                    ['y', '上下'],
                    ['z', '前后']
                  ] as Array<[CutAxis, string]>
                ).map(([axis, label]) => (
                  <button
                    key={axis}
                    type="button"
                    className={cutTool.axis === axis ? 'is-active' : ''}
                    aria-pressed={cutTool.axis === axis}
                    onClick={() => {
                      const bounds = objectLocalBounds(cutObject)
                      setCutTool({
                        ...cutTool,
                        axis,
                        offset: (bounds.min[axis] + bounds.max[axis]) / 2
                      })
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label className="cut-position-control">
                <span>切割位置</span>
                <input
                  aria-label="切割位置"
                  type="range"
                  min={cutMinimum + (cutMaximum - cutMinimum) * 0.02}
                  max={cutMaximum - (cutMaximum - cutMinimum) * 0.02}
                  step={Math.max((cutMaximum - cutMinimum) / 100, 0.001)}
                  value={cutTool.offset}
                  onChange={(event) =>
                    setCutTool({ ...cutTool, offset: Number(event.target.value) })
                  }
                />
              </label>
              <div className="cut-keep-segment" aria-label="切割后保留范围">
                {(
                  [
                    ['both', '两边都要'],
                    ['positive', '箭头侧'],
                    ['negative', '另一侧']
                  ] as Array<[CutKeepMode, string]>
                ).map(([keep, label]) => (
                  <button
                    key={keep}
                    type="button"
                    className={cutTool.keep === keep ? 'is-active' : ''}
                    aria-pressed={cutTool.keep === keep}
                    onClick={() => setCutTool({ ...cutTool, keep })}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <button className="cut-cancel" type="button" onClick={() => setCutTool(null)}>
                取消
              </button>
              <button className="cut-apply" type="button" onClick={applyCut}>
                应用切割
              </button>
            </div>
          ) : null}
          {selectedIds.length > 1 ? (
            <div className="layout-tools" aria-label="多个对象排列工具">
              <span>{selectedIds.length} 个对象</span>
              <CommandButton label="横向对齐" onClick={() => applyLayout('align-z')}>
                <AlignCenterHorizontal />
              </CommandButton>
              <CommandButton label="前后对齐" onClick={() => applyLayout('align-x')}>
                <AlignCenterVertical />
              </CommandButton>
              <CommandButton
                label="横向等距"
                disabled={selectedIds.length < 3}
                onClick={() => applyLayout('distribute-x')}
              >
                <AlignCenterHorizontal />
              </CommandButton>
              <CommandButton
                label="前后等距"
                disabled={selectedIds.length < 3}
                onClick={() => applyLayout('distribute-z')}
              >
                <AlignCenterVertical />
              </CommandButton>
              <CommandButton label="放到地面" onClick={() => applyLayout('ground')}>
                <ArrowDownToLine />
              </CommandButton>
              <span className="toolbar-divider" />
              <CommandButton label="保存为组合" onClick={() => setGroupConfirmationOpen(true)}>
                <Group />
              </CommandButton>
            </div>
          ) : null}
          <div className="viewport-status" aria-hidden="true">
            <span>
              {cameraPreview
                ? `全屏取景 · ${sceneHistory.scene.camera.aspectWidth}:${sceneHistory.scene.camera.aspectHeight}`
                : modelingDraft
                  ? `点线面建模 · ${modelingDraft.vertices.length} 个点`
                  : firstPersonCameraControl
                    ? '第一人称控制 · 输出镜头实时同步'
                    : cameraMonitor
                      ? '透视视图 · 实时取景窗'
                      : '透视视图 · 无限参考网格'}
            </span>
          </div>
          {!cameraPreview ? (
            <>
              <div className="viewport-actions">
                <CommandButton
                  label={
                    selectedIds.length > 0
                      ? selectedObject
                        ? `聚焦查看 ${selectedObject.name}`
                        : `聚焦查看所选 ${selectedIds.length} 个对象`
                      : sceneHistory.scene.objects.some((object) => object.visible)
                        ? '查看全部对象'
                        : '回到场景中心'
                  }
                  text={selectedIds.length > 0 ? '查看选中' : '查看全部'}
                  onClick={() => focusView()}
                >
                  <Focus />
                </CommandButton>
              </div>
              <div className="axis-indicator" aria-hidden="true">
                <span className="axis-y">Y</span>
                <span className="axis-x">X</span>
                <span className="axis-z">Z</span>
              </div>
            </>
          ) : null}
        </section>

        <aside ref={rightPanelRef} className="right-panel" aria-label="属性面板">
          {inspectorTarget === 'camera' ? (
            <>
              <div className="property-header">
                <div className="property-title">
                  <span>输出镜头</span>
                  <h2>主摄影机</h2>
                </div>
              </div>
              <section className="property-section">
                <h3>画面比例</h3>
                <div className="panel-command-grid aspect-presets">
                  {[
                    ['16:9', 16, 9],
                    ['9:16', 9, 16],
                    ['1:1', 1, 1],
                    ['4:3', 4, 3]
                  ].map(([label, width, height]) => (
                    <button
                      key={label}
                      type="button"
                      className={
                        sceneHistory.scene.camera.aspectWidth === width &&
                        sceneHistory.scene.camera.aspectHeight === height
                          ? 'is-active'
                          : ''
                      }
                      onClick={() => {
                        setTimelinePreviewCamera(null)
                        sceneHistory.commit((scene) => ({
                          ...scene,
                          camera: {
                            ...scene.camera,
                            aspectWidth: Number(width),
                            aspectHeight: Number(height)
                          }
                        }))
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="number-grid aspect-custom">
                  {(['aspectWidth', 'aspectHeight'] as const).map((key) => (
                    <label key={key}>
                      <span>{key === 'aspectWidth' ? '宽' : '高'}</span>
                      <CommitNumberInput
                        key={`${key}-${sceneHistory.scene.camera[key]}`}
                        label={key === 'aspectWidth' ? '画面宽比例' : '画面高比例'}
                        value={sceneHistory.scene.camera[key]}
                        minimum={0.1}
                        onCommit={(value) => {
                          setTimelinePreviewCamera(null)
                          sceneHistory.commit((scene) => ({
                            ...scene,
                            camera: { ...scene.camera, [key]: Math.max(value, 0.1) }
                          }))
                        }}
                      />
                    </label>
                  ))}
                </div>
              </section>
              <section className="property-section">
                <h3>镜头视野</h3>
                <label className="range-control">
                  <CommitRangeInput
                    key={`camera-fov-${sceneHistory.scene.camera.fovDegrees}`}
                    label="摄影机视野"
                    minimum={20}
                    maximum={90}
                    step={1}
                    value={sceneHistory.scene.camera.fovDegrees}
                    onPreview={(fovDegrees) => {
                      setTimelinePreviewCamera(null)
                      setCameraControlPreview({ ...sceneHistory.scene.camera, fovDegrees })
                    }}
                    onPreviewEnd={() => setCameraControlPreview(null)}
                    onCommit={(fovDegrees) => {
                      setTimelinePreviewCamera(null)
                      sceneHistory.commit((scene) => ({
                        ...scene,
                        camera: { ...scene.camera, fovDegrees }
                      }))
                    }}
                  />
                  <span>{Math.round(displayedCamera.fovDegrees)}°</span>
                </label>
                <div className="panel-command-grid camera-actions">
                  <button
                    type="button"
                    className={firstPersonCameraControl ? 'is-active' : ''}
                    onClick={() =>
                      firstPersonCameraControl
                        ? exitFirstPersonCameraControl()
                        : enterFirstPersonCameraControl()
                    }
                  >
                    <Move3d aria-hidden="true" />
                    <span>第一人称控制</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const next = viewportRef.current?.alignSceneCameraToView()
                      if (next) handleCameraChange(next)
                    }}
                  >
                    对齐当前视角
                  </button>
                  <button
                    type="button"
                    className={cameraMonitor ? 'is-active' : ''}
                    onClick={() => {
                      if (firstPersonCameraControl) exitFirstPersonCameraControl()
                      setCameraViewMode((current) => (current === 'monitor' ? 'none' : 'monitor'))
                    }}
                  >
                    <Monitor aria-hidden="true" />
                    <span>{cameraMonitor ? '关闭取景窗' : '实时取景窗'}</span>
                  </button>
                  <button
                    type="button"
                    className={cameraPreview ? 'is-active' : ''}
                    onClick={() => {
                      if (firstPersonCameraControl) exitFirstPersonCameraControl()
                      setCameraViewMode((current) =>
                        current === 'fullscreen' ? 'none' : 'fullscreen'
                      )
                    }}
                  >
                    <Maximize2 aria-hidden="true" />
                    <span>{cameraPreview ? '退出全屏' : '全屏取景'}</span>
                  </button>
                </div>
              </section>
              {[
                ['相机位置', 'position'],
                ['观察中心', 'target']
              ].map(([heading, property]) => {
                const key = property as 'position' | 'target'
                return (
                  <section className="property-section" key={key}>
                    <h3>{heading}</h3>
                    <div className="number-grid">
                      {vectorAxes.map((axis) => (
                        <label key={axis}>
                          <span>{axisLabels[axis]}</span>
                          <CommitNumberInput
                            key={`camera-${key}-${axis}-${sceneHistory.scene.camera[key][axis]}`}
                            label={`${heading} ${axis.toUpperCase()}`}
                            value={sceneHistory.scene.camera[key][axis]}
                            onCommit={(value) => {
                              setTimelinePreviewCamera(null)
                              sceneHistory.commit((scene) => ({
                                ...scene,
                                camera: {
                                  ...scene.camera,
                                  [key]: { ...scene.camera[key], [axis]: value }
                                }
                              }))
                            }}
                          />
                        </label>
                      ))}
                    </div>
                  </section>
                )
              })}
            </>
          ) : inspectorTarget === 'ambient' ? (
            <>
              <div className="property-header">
                <div className="property-title">
                  <span>基础照明</span>
                  <h2>固定场景光</h2>
                </div>
              </div>
              <section className="property-section ambient-summary">
                <h3>状态</h3>
                <div className="read-only-state">固定开启</div>
              </section>
              <section className="property-section">
                <h3>添加灯光</h3>
                <div className="light-preset-grid">
                  {(
                    [
                      ['area', '柔和面光'],
                      ['point', '点光源'],
                      ['spot', '聚光灯'],
                      ['sun', '日光']
                    ] as Array<[SceneLightKind, string]>
                  ).map(([kind, label]) => (
                    <button key={kind} type="button" onClick={() => addLight(kind)}>
                      <Plus aria-hidden="true" />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
              </section>
            </>
          ) : inspectorTarget === 'light' && selectedLight ? (
            <>
              <div className="property-header">
                <div className="property-title">
                  <span>当前灯光</span>
                  <CommitTextInput
                    key={`${selectedLight.id}-${selectedLight.name}`}
                    value={selectedLight.name}
                    disabled={selectedLight.locked}
                    onCommit={(name) => updateLight(selectedLight.id, { name })}
                  />
                </div>
              </div>
              <section className="property-section">
                <h3>灯光类型</h3>
                <label className="select-control">
                  <select
                    aria-label="灯光类型"
                    value={selectedLight.kind}
                    disabled={selectedLight.locked}
                    onChange={(event) =>
                      updateLight(selectedLight.id, { kind: event.target.value as SceneLightKind })
                    }
                  >
                    <option value="area">柔和面光</option>
                    <option value="point">点光源</option>
                    <option value="spot">聚光灯</option>
                    <option value="sun">日光</option>
                  </select>
                </label>
                <label className="range-control">
                  <span>强度</span>
                  <CommitRangeInput
                    key={`${selectedLight.id}-intensity-${selectedLight.intensity}`}
                    label="灯光强度"
                    minimum={0}
                    maximum={12}
                    step={0.1}
                    value={selectedLight.intensity}
                    disabled={selectedLight.locked}
                    onPreview={(intensity) =>
                      setLightControlPreview({ id: selectedLight.id, update: { intensity } })
                    }
                    onPreviewEnd={() => setLightControlPreview(null)}
                    onCommit={(intensity) => updateLight(selectedLight.id, { intensity })}
                  />
                  <strong>
                    {(
                      (lightControlPreview?.id === selectedLight.id
                        ? lightControlPreview.update.intensity
                        : undefined) ?? selectedLight.intensity
                    ).toFixed(1)}
                  </strong>
                </label>
              </section>
              <section className="property-section appearance-section">
                <h3>颜色</h3>
                <label className="color-control">
                  <input
                    type="color"
                    aria-label="灯光颜色"
                    value={selectedLight.color}
                    disabled={selectedLight.locked}
                    onChange={(event) =>
                      updateLight(selectedLight.id, { color: event.target.value })
                    }
                  />
                  <span>{selectedLight.color.toUpperCase()}</span>
                </label>
              </section>
              {[
                ['位置', 'position'],
                ['照向', 'target']
              ].map(([heading, property]) => {
                const key = property as 'position' | 'target'
                return (
                  <section className="property-section" key={key}>
                    <h3>{heading}</h3>
                    <div className="number-grid">
                      {vectorAxes.map((axis) => (
                        <label key={axis}>
                          <span>{axisLabels[axis]}</span>
                          <CommitNumberInput
                            key={`${selectedLight.id}-${key}-${axis}-${selectedLight[key][axis]}`}
                            label={`${heading} ${axis.toUpperCase()}`}
                            value={selectedLight[key][axis]}
                            disabled={selectedLight.locked}
                            onCommit={(value) =>
                              updateLight(selectedLight.id, {
                                [key]: { ...selectedLight[key], [axis]: value }
                              })
                            }
                          />
                        </label>
                      ))}
                    </div>
                  </section>
                )
              })}
              {selectedLight.kind === 'area' ? (
                <section className="property-section">
                  <h3>光源大小</h3>
                  <CommitNumberInput
                    label="面光大小"
                    value={selectedLight.size}
                    minimum={0.1}
                    disabled={selectedLight.locked}
                    onCommit={(size) => updateLight(selectedLight.id, { size })}
                  />
                </section>
              ) : null}
              {selectedLight.kind === 'spot' ? (
                <section className="property-section">
                  <h3>光束角度</h3>
                  <label className="range-control">
                    <CommitRangeInput
                      key={`${selectedLight.id}-angle-${selectedLight.angleDegrees}`}
                      label="聚光角度"
                      minimum={5}
                      maximum={120}
                      step={1}
                      value={selectedLight.angleDegrees}
                      disabled={selectedLight.locked}
                      onPreview={(angleDegrees) =>
                        setLightControlPreview({
                          id: selectedLight.id,
                          update: { angleDegrees }
                        })
                      }
                      onPreviewEnd={() => setLightControlPreview(null)}
                      onCommit={(angleDegrees) => updateLight(selectedLight.id, { angleDegrees })}
                    />
                    <span>
                      {Math.round(
                        (lightControlPreview?.id === selectedLight.id
                          ? lightControlPreview.update.angleDegrees
                          : undefined) ?? selectedLight.angleDegrees
                      )}
                      °
                    </span>
                  </label>
                </section>
              ) : null}
              <section className="property-section state-section">
                <h3>灯光状态</h3>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={selectedLight.visible}
                    onChange={() =>
                      updateLight(selectedLight.id, { visible: !selectedLight.visible })
                    }
                  />
                  <span>在场景中启用</span>
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={selectedLight.locked}
                    onChange={() =>
                      updateLight(selectedLight.id, { locked: !selectedLight.locked })
                    }
                  />
                  <span>锁定，防止误操作</span>
                </label>
                <button
                  className="danger-panel-action"
                  type="button"
                  onClick={() => deleteLight(selectedLight.id)}
                >
                  <Trash2 aria-hidden="true" />
                  <span>删除灯光</span>
                </button>
              </section>
            </>
          ) : selectedObject ? (
            <>
              <div className="property-header">
                <div className="property-title">
                  <span>当前对象</span>
                  <CommitTextInput
                    key={`${selectedObject.id}-${selectedObject.name}`}
                    value={selectedObject.name}
                    disabled={selectedObject.locked}
                    onCommit={(name) => updateObject(selectedObject.id, { name })}
                  />
                </div>
                {selectedObject.locked ? (
                  <button
                    className="locked-state"
                    type="button"
                    onClick={() => updateObject(selectedObject.id, { locked: false })}
                  >
                    <Lock aria-hidden="true" />
                    <span>已锁定，点击解锁</span>
                  </button>
                ) : null}
              </div>

              {[
                ['位置', 'position', ''],
                ['旋转', 'rotation', '°'],
                ['大小', 'size', '']
              ]
                .filter(
                  ([, property]) => selectedObject.kind !== 'mannequin' || property !== 'size'
                )
                .map(([heading, property, suffix]) => {
                  const key = property as 'position' | 'rotation' | 'size'
                  return (
                    <section className="property-section" key={key}>
                      <h3>{heading}</h3>
                      <div className="number-grid">
                        {vectorAxes.map((axis) => (
                          <label key={axis}>
                            <span>
                              {(key === 'rotation' ? rotationAxisLabels : axisLabels)[axis]}
                            </span>
                            <CommitNumberInput
                              key={`${selectedObject.id}-${key}-${axis}-${selectedObject[key][axis]}`}
                              label={`${heading} ${axis.toUpperCase()}`}
                              value={selectedObject[key][axis]}
                              minimum={key === 'size' ? 0.1 : undefined}
                              suffix={suffix}
                              disabled={selectedObject.locked}
                              onCommit={(value) =>
                                updateObject(selectedObject.id, {
                                  [key]: { ...selectedObject[key], [axis]: value }
                                })
                              }
                            />
                          </label>
                        ))}
                      </div>
                    </section>
                  )
                })}

              {selectedObject.kind === 'mannequin' && selectedObject.mannequin ? (
                <section className="property-section mannequin-section">
                  <div className="mannequin-section-heading">
                    <h3>人台编辑</h3>
                    <label>
                      <span>参考身高</span>
                      <CommitNumberInput
                        key={`${selectedObject.id}-height-${selectedObject.mannequin.heightMeters}`}
                        label="参考身高"
                        value={selectedObject.mannequin.heightMeters}
                        minimum={1.2}
                        maximum={2.2}
                        suffix=" m"
                        disabled={selectedObject.locked}
                        onCommit={(value) => updateMannequinHeight(selectedObject.id, value)}
                      />
                    </label>
                  </div>
                  <div className="mannequin-edit-mode" role="group" aria-label="人台编辑方式">
                    <button
                      type="button"
                      className={mannequinEditMode === 'placement' ? 'is-active' : ''}
                      aria-pressed={mannequinEditMode === 'placement'}
                      onClick={() => {
                        setMannequinEditMode('placement')
                        setSelectedMannequinJoint(null)
                      }}
                    >
                      整体摆放
                    </button>
                    <button
                      type="button"
                      className={mannequinEditMode === 'pose' ? 'is-active' : ''}
                      aria-pressed={mannequinEditMode === 'pose'}
                      onClick={() => {
                        setMannequinEditMode('pose')
                        setTransformMode('translate')
                      }}
                    >
                      调整姿势
                    </button>
                  </div>
                  {mannequinEditMode === 'pose' ? (
                    <>
                      <div className="pose-preset-grid" aria-label="基础姿势">
                        {MANNEQUIN_PRESETS.map((preset) => (
                          <button
                            key={preset.id}
                            type="button"
                            className={
                              selectedObject.mannequin?.presetId === preset.id ? 'is-active' : ''
                            }
                            aria-pressed={selectedObject.mannequin?.presetId === preset.id}
                            disabled={selectedObject.locked}
                            onClick={() =>
                              applyMannequinPreset(
                                selectedObject.id,
                                preset.id,
                                preset.pose,
                                preset.label
                              )
                            }
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                      <button
                        className="mannequin-action-playback"
                        type="button"
                        aria-label={timelinePlaying ? '暂停人物动作' : '播放人物动作'}
                        onClick={toggleTimelinePlayback}
                      >
                        {timelinePlaying ? (
                          <Pause aria-hidden="true" />
                        ) : (
                          <Play aria-hidden="true" />
                        )}
                        <span>{timelinePlaying ? '暂停动作' : '播放动作'}</span>
                      </button>
                      <div className="joint-picker" aria-label="选择人台关节">
                        {MANNEQUIN_JOINTS.map((joint) => (
                          <button
                            key={joint.id}
                            type="button"
                            className={selectedMannequinJoint === joint.id ? 'is-active' : ''}
                            aria-pressed={selectedMannequinJoint === joint.id}
                            disabled={selectedObject.locked}
                            onClick={() => setSelectedMannequinJoint(joint.id)}
                          >
                            {joint.label}
                          </button>
                        ))}
                      </div>
                      {selectedMannequinJoint ? (
                        <div className="mannequin-joint-values">
                          <strong>{mannequinJointLabel(selectedMannequinJoint)}</strong>
                          <div className="number-grid">
                            {vectorAxes.map((axis) => {
                              const definition = MANNEQUIN_JOINTS.find(
                                (joint) => joint.id === selectedMannequinJoint
                              )!
                              const mannequin = selectedObject.mannequin!
                              return (
                                <label key={axis}>
                                  <span>{rotationAxisLabels[axis]}</span>
                                  <CommitNumberInput
                                    key={`${selectedObject.id}-${selectedMannequinJoint}-${axis}-${mannequin.pose[selectedMannequinJoint][axis]}`}
                                    label={`${mannequinJointLabel(selectedMannequinJoint)} ${axis.toUpperCase()}`}
                                    value={mannequin.pose[selectedMannequinJoint][axis]}
                                    minimum={definition.limits[axis][0]}
                                    maximum={definition.limits[axis][1]}
                                    suffix="°"
                                    disabled={selectedObject.locked}
                                    onCommit={(value) =>
                                      updateMannequinJointAxis(
                                        selectedObject,
                                        selectedMannequinJoint,
                                        axis,
                                        value
                                      )
                                    }
                                  />
                                </label>
                              )
                            })}
                          </div>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <p className="mannequin-mode-hint">
                      当前只显示移动、旋转和身高设置；切换到“调整姿势”后再显示关节点。
                    </p>
                  )}
                </section>
              ) : null}

              <section className="property-section appearance-section">
                <h3>上色</h3>
                <div className="paint-mode-segment" aria-label="上色范围">
                  <button
                    type="button"
                    className={paintScope === 'object' ? 'is-active' : ''}
                    aria-pressed={paintScope === 'object'}
                    disabled={selectedObject.locked}
                    onClick={() => setPaintScope('object')}
                  >
                    <Box aria-hidden="true" />
                    <span>整个模型</span>
                  </button>
                  <button
                    type="button"
                    className={paintScope === 'face' ? 'is-active' : ''}
                    aria-pressed={paintScope === 'face'}
                    disabled={
                      selectedObject.locked ||
                      !selectedObject.visible ||
                      Boolean(modelingDraft) ||
                      Boolean(surfacePickObjectId) ||
                      Boolean(cutTool) ||
                      cameraPreview
                    }
                    onClick={() => setPaintScope('face')}
                  >
                    <ScanSearch aria-hidden="true" />
                    <span>单个面</span>
                  </button>
                </div>
                <div className="paint-color-row">
                  <label className="color-control">
                    <input
                      type="color"
                      aria-label="上色颜色"
                      value={paintColor}
                      disabled={selectedObject.locked}
                      onChange={(event) => {
                        const color = event.target.value
                        setPaintColor(color)
                        if (paintScope === 'object') {
                          applyWholeObjectColor(selectedObject.id, color)
                        }
                      }}
                    />
                    <span>{paintColor.toUpperCase()}</span>
                  </label>
                  <button
                    className="paint-reset-button"
                    type="button"
                    disabled={
                      selectedObject.locked ||
                      (!selectedObject.colorOverride &&
                        Object.keys(selectedObject.faceColors ?? {}).length === 0)
                    }
                    onClick={() => restoreObjectColors(selectedObject)}
                  >
                    恢复原色
                  </button>
                </div>
              </section>

              <section className="property-section state-section">
                <h3>对象状态</h3>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={selectedObject.visible}
                    onChange={() =>
                      updateObject(selectedObject.id, { visible: !selectedObject.visible })
                    }
                  />
                  <span>在场景中显示</span>
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={selectedObject.locked}
                    onChange={() =>
                      updateObject(selectedObject.id, { locked: !selectedObject.locked })
                    }
                  />
                  <span>锁定，防止误操作</span>
                </label>
              </section>
              {selectedObject.kind !== 'mannequin' ? (
                <section className="property-section model-summary">
                  <h3>表面续画</h3>
                  <span>新造型保持独立，可撤销或分开调整</span>
                  <button
                    className="panel-command"
                    type="button"
                    disabled={
                      selectedObject.locked ||
                      !selectedObject.visible ||
                      Boolean(modelingDraft) ||
                      Boolean(cutTool) ||
                      Boolean(surfacePickObjectId)
                    }
                    onClick={() => beginSurfacePick(selectedObject)}
                  >
                    <ScanSearch aria-hidden="true" />
                    <span>在模型面上继续画</span>
                  </button>
                </section>
              ) : null}
              {selectedObject.kind === 'custom' ? (
                <section className="property-section model-summary">
                  <h3>自定义形状</h3>
                  <span>
                    {selectedObject.customMesh?.vertices.length ?? 0} 个点 ·{' '}
                    {selectedObject.customMesh?.edges.length ?? 0} 条线 ·{' '}
                    {selectedObject.customMesh?.faces.length ?? 0} 个面
                  </span>
                  <button
                    className="panel-command"
                    type="button"
                    disabled={selectedObject.locked || Boolean(modelingDraft)}
                    onClick={() => editCustomObject(selectedObject)}
                  >
                    <Pencil aria-hidden="true" />
                    <span>编辑点、线和面</span>
                  </button>
                </section>
              ) : null}
              {selectedObject.kind !== 'imported' && selectedObject.kind !== 'mannequin' ? (
                <section className="property-section model-summary">
                  <h3>形状切割</h3>
                  <span>{selectedObject.cuts?.length ?? 0} 个切割面</span>
                  <button
                    className="panel-command"
                    type="button"
                    disabled={selectedObject.locked || Boolean(modelingDraft) || Boolean(cutTool)}
                    onClick={() => openCutTool(selectedObject)}
                  >
                    <Scissors aria-hidden="true" />
                    <span>平面切割</span>
                  </button>
                </section>
              ) : null}
              {selectedObject.kind === 'imported' && selectedObject.importedAsset ? (
                <section className="property-section model-summary">
                  <h3>导入模型</h3>
                  <dl>
                    <div>
                      <dt>网格</dt>
                      <dd>{selectedObject.importedAsset.report.meshCount}</dd>
                    </div>
                    <div>
                      <dt>三角面</dt>
                      <dd>{selectedObject.importedAsset.report.triangleCount.toLocaleString()}</dd>
                    </div>
                    <div>
                      <dt>相机</dt>
                      <dd>{selectedObject.importedAsset.report.cameraCount}</dd>
                    </div>
                    <div>
                      <dt>灯光</dt>
                      <dd>{selectedObject.importedAsset.report.lightCount}</dd>
                    </div>
                  </dl>
                  <div className="import-quality-control">
                    <div>
                      <strong>编辑预览</strong>
                      <small>只改变画布流畅度，原始模型一直保留</small>
                    </div>
                    <div className="quality-segment" role="group" aria-label="编辑预览精度">
                      <button
                        type="button"
                        className={
                          (selectedObject.previewQuality ?? 'original') === 'original' ||
                          selectedLightweightUnavailable
                            ? 'is-active'
                            : ''
                        }
                        onClick={() => setImportedPreviewQuality(selectedObject.id, 'original')}
                      >
                        原始
                      </button>
                      <button
                        type="button"
                        className={
                          selectedObject.previewQuality === 'lightweight' &&
                          !selectedLightweightUnavailable
                            ? 'is-active'
                            : ''
                        }
                        disabled={selectedLightweightUnavailable}
                        title={
                          selectedLightweightUnavailable
                            ? '此模型无法在不破坏结构的情况下安全减面'
                            : undefined
                        }
                        onClick={() => setImportedPreviewQuality(selectedObject.id, 'lightweight')}
                      >
                        轻量
                      </button>
                    </div>
                    {selectedObject.previewQuality === 'lightweight' ? (
                      <span className="optimization-result">
                        {optimizationReports.has(selectedObject.id)
                          ? optimizationReports.get(selectedObject.id)!.simplifiedMeshes > 0
                            ? `${optimizationReports.get(selectedObject.id)!.originalTriangles.toLocaleString()} → ${optimizationReports.get(selectedObject.id)!.previewTriangles.toLocaleString()} 个三角面`
                            : '未能安全减面，已保留原始预览'
                          : '正在准备轻量预览…'}
                      </span>
                    ) : null}
                  </div>
                  <div className="import-quality-control">
                    <div>
                      <strong>最终导出</strong>
                      <small>图片、视频和模型使用哪种精度</small>
                    </div>
                    <div className="quality-segment" role="group" aria-label="最终导出精度">
                      <button
                        type="button"
                        className={
                          (selectedObject.exportQuality ?? 'original') === 'original' ||
                          selectedLightweightUnavailable
                            ? 'is-active'
                            : ''
                        }
                        onClick={() => setImportedExportQuality(selectedObject.id, 'original')}
                      >
                        原始
                      </button>
                      <button
                        type="button"
                        className={
                          selectedObject.exportQuality === 'lightweight' &&
                          !selectedLightweightUnavailable
                            ? 'is-active'
                            : ''
                        }
                        disabled={selectedLightweightUnavailable}
                        title={
                          selectedLightweightUnavailable
                            ? '此模型无法在不破坏结构的情况下安全减面'
                            : undefined
                        }
                        onClick={() => setImportedExportQuality(selectedObject.id, 'lightweight')}
                      >
                        轻量
                      </button>
                    </div>
                    {selectedLightweightUnavailable ? (
                      <span className="optimization-result">此模型将按原始精度导出</span>
                    ) : null}
                  </div>
                  {selectedObject.importedAsset.report.cameraCount > 0 ? (
                    <button
                      className="panel-command"
                      type="button"
                      onClick={() => activateModelCamera(selectedObject.id)}
                    >
                      <Camera aria-hidden="true" />
                      <span>使用模型相机</span>
                    </button>
                  ) : null}
                  {selectedObject.importedAsset.report.lightCount > 0 ? (
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={selectedObject.useImportedLights === true}
                        onChange={() =>
                          updateObject(selectedObject.id, {
                            useImportedLights: selectedObject.useImportedLights !== true
                          })
                        }
                      />
                      <span>使用模型自带灯光</span>
                    </label>
                  ) : null}
                </section>
              ) : null}
            </>
          ) : selectedObjects.length > 1 ? (
            <>
              <div className="property-header">
                <div className="property-title">
                  <span>整体编辑</span>
                  <h2>{selectedObjects.length} 个对象</h2>
                </div>
              </div>
              <section className="property-section multi-selection-summary">
                <h3>排列</h3>
                <div className="panel-command-grid">
                  <button type="button" onClick={() => applyLayout('align-z')}>
                    横向对齐
                  </button>
                  <button type="button" onClick={() => applyLayout('align-x')}>
                    前后对齐
                  </button>
                  <button
                    type="button"
                    disabled={selectedObjects.length < 3}
                    onClick={() => applyLayout('distribute-x')}
                  >
                    横向等距
                  </button>
                  <button
                    type="button"
                    disabled={selectedObjects.length < 3}
                    onClick={() => applyLayout('distribute-z')}
                  >
                    前后等距
                  </button>
                </div>
                <button
                  className="panel-command"
                  type="button"
                  onClick={() => applyLayout('ground')}
                >
                  <ArrowDownToLine aria-hidden="true" />
                  <span>全部放到地面</span>
                </button>
                <button
                  className="panel-command"
                  type="button"
                  onClick={() => setGroupConfirmationOpen(true)}
                >
                  <Group aria-hidden="true" />
                  <span>保存为组合</span>
                </button>
              </section>
            </>
          ) : (
            <div className="empty-properties">
              <Box aria-hidden="true" />
              <strong>没有选中对象</strong>
              <span>点击画布中的模型，或从左侧场景列表选择</span>
            </div>
          )}
        </aside>
      </div>

      {objectMenu && menuObject ? (
        <div
          ref={objectMenuRef}
          className="object-context-menu"
          role="menu"
          aria-label={
            menuObjects.length > 1
              ? `${menuObjects.length} 个对象操作菜单`
              : `${menuObject.name} 操作菜单`
          }
          style={{ left: objectMenu.x, top: objectMenu.y }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <div className="context-menu-title">
            {menuObjects.length > 1 ? `${menuObjects.length} 个对象` : menuObject.name}
          </div>
          {menuObjects.length === 1 ? (
            <button type="button" role="menuitem" onClick={() => beginRename(menuObject.id)}>
              <Pencil aria-hidden="true" />
              <span>重命名</span>
            </button>
          ) : null}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              focusView(menuObjects.map((object) => object.id))
              setObjectMenu(null)
            }}
          >
            <Focus aria-hidden="true" />
            <span>聚焦查看</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              if (menuObjects.length === 1) duplicateObject(menuObject.id)
              else duplicateObjects(menuObjects.map((object) => object.id))
              setObjectMenu(null)
            }}
          >
            <Copy aria-hidden="true" />
            <span>{menuObjects.length > 1 ? '复制所选对象' : '复制对象'}</span>
          </button>
          <div className="context-menu-label">显示方式</div>
          {(Object.keys(displayModeLabels) as ObjectDisplayMode[]).map((mode) => {
            const active = menuObjects.every((object) => (object.displayMode ?? 'solid') === mode)
            return (
              <button
                type="button"
                role="menuitemradio"
                aria-checked={active}
                key={mode}
                onClick={() => {
                  updateObjects(
                    menuObjects.map((object) => object.id),
                    { displayMode: mode }
                  )
                  setObjectMenu(null)
                }}
              >
                <span className="context-menu-check">
                  {active ? <Check aria-hidden="true" /> : null}
                </span>
                <span>{displayModeLabels[mode]}</span>
              </button>
            )
          })}
          <div className="context-menu-separator" />
          {menuObjects.length > 1 ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setGroupConfirmationOpen(true)
                setObjectMenu(null)
              }}
            >
              <Group aria-hidden="true" />
              <span>保存为组合</span>
            </button>
          ) : null}
          {menuObjects.some((object) => object.groupId) ? (
            <button type="button" role="menuitem" onClick={ungroupSelectedObjects}>
              <Ungroup aria-hidden="true" />
              <span>解除组合</span>
            </button>
          ) : null}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const nextVisible = !menuObjects.every((object) => object.visible)
              updateObjects(
                menuObjects.map((object) => object.id),
                { visible: nextVisible }
              )
              setObjectMenu(null)
            }}
          >
            {menuObjects.every((object) => object.visible) ? (
              <EyeOff aria-hidden="true" />
            ) : (
              <Eye aria-hidden="true" />
            )}
            <span>{menuObjects.every((object) => object.visible) ? '隐藏对象' : '显示对象'}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const nextLocked = !menuObjects.every((object) => object.locked)
              updateObjects(
                menuObjects.map((object) => object.id),
                { locked: nextLocked }
              )
              setObjectMenu(null)
            }}
          >
            {menuObjects.every((object) => object.locked) ? (
              <LockOpen aria-hidden="true" />
            ) : (
              <Lock aria-hidden="true" />
            )}
            <span>{menuObjects.every((object) => object.locked) ? '解除锁定' : '锁定对象'}</span>
          </button>
          <button
            className="context-menu-danger"
            type="button"
            role="menuitem"
            onClick={() => {
              deleteObjects(menuObjects.map((object) => object.id))
              setObjectMenu(null)
            }}
          >
            <Trash2 aria-hidden="true" />
            <span>{menuObjects.length > 1 ? '删除所选对象' : '删除对象'}</span>
          </button>
        </div>
      ) : null}

      {notice && (
        <div className={`notice notice-${notice.kind}`} role="status">
          {notice.message}
        </div>
      )}

      {onboardingOpen ? (
        <div className="dialog-backdrop" role="presentation">
          <section
            className="onboarding-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="onboarding-title"
          >
            <header className="dialog-panel-header">
              <div>
                <span>第一次使用只需要记住三步</span>
                <h2 id="onboarding-title">快速开始</h2>
              </div>
              <button
                type="button"
                aria-label="关闭新手帮助"
                onClick={() => {
                  window.localStorage.setItem(onboardingStorageKey, 'true')
                  setOnboardingOpen(false)
                }}
              >
                <X aria-hidden="true" />
              </button>
            </header>
            <div className="onboarding-steps">
              <section>
                <strong>1</strong>
                <div>
                  <h3>搭场景</h3>
                  <p>从左侧添加方块、墙体、地面或人台，直接在画布中移动和调整。</p>
                </div>
              </section>
              <section>
                <strong>2</strong>
                <div>
                  <h3>调镜头与动作</h3>
                  <p>顶部切换到“调镜头”或“做动画”，只处理当前任务需要的内容。</p>
                </div>
              </section>
              <section>
                <strong>3</strong>
                <div>
                  <h3>导出作品</h3>
                  <p>点击顶部“导出”，选择图片、视频或三维模型，不需要研究格式术语。</p>
                </div>
              </section>
            </div>
            <footer className="onboarding-actions">
              <span>帮助按钮可以随时重新打开本说明。</span>
              <button
                autoFocus
                type="button"
                onClick={() => {
                  window.localStorage.setItem(onboardingStorageKey, 'true')
                  setOnboardingOpen(false)
                }}
              >
                开始搭建
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {groupConfirmationOpen ? (
        <div className="dialog-backdrop" role="presentation">
          <section
            className="unsaved-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="group-dialog-title"
          >
            <div className="dialog-icon" aria-hidden="true">
              <Group />
            </div>
            <div className="dialog-copy">
              <h2 id="group-dialog-title">保存为一个组合？</h2>
              <p>所选模型不会被合并或改变，只会在以后点击时一起选中。该操作可以撤销。</p>
            </div>
            <div className="dialog-actions">
              <button autoFocus type="button" onClick={groupSelectedObjects}>
                保存为组合
              </button>
              <button
                className="secondary"
                type="button"
                onClick={() => setGroupConfirmationOpen(false)}
              >
                取消
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {exportHubOpen ? (
        <div className="dialog-backdrop" role="presentation">
          <section
            className="export-hub-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="export-hub-title"
          >
            <header className="dialog-panel-header">
              <div>
                <span>按用途选择，软件会处理格式</span>
                <h2 id="export-hub-title">导出作品</h2>
              </div>
              <button
                type="button"
                aria-label="关闭导出"
                disabled={busy}
                onClick={() => setExportHubOpen(false)}
              >
                <X aria-hidden="true" />
              </button>
            </header>
            <div className="export-hub-grid">
              <section className="export-choice image-export-choice">
                <div className="export-choice-heading">
                  <Images aria-hidden="true" />
                  <div>
                    <strong>图片</strong>
                    <span>输出摄影机看到的最终画面</span>
                  </div>
                </div>
                <div className="image-export-options">
                  <div className="export-option-group" role="radiogroup" aria-label="图片格式">
                    {(['png', 'jpg'] as const).map((format) => (
                      <button
                        key={format}
                        type="button"
                        role="radio"
                        aria-checked={imageExportFormat === format}
                        className={imageExportFormat === format ? 'is-active' : ''}
                        onClick={() => setImageExportFormat(format)}
                      >
                        {format.toUpperCase()}
                      </button>
                    ))}
                  </div>
                  <label>
                    <span>清晰度</span>
                    <select
                      aria-label="图片最长边"
                      value={imageExportDimension}
                      onChange={(event) => setImageExportDimension(Number(event.target.value))}
                    >
                      <option value="1024">标准 · 1024 像素</option>
                      <option value="1280">清晰 · 1280 像素</option>
                      <option value="1920">高清 · 1920 像素</option>
                      <option value="2048">高质量 · 2048 像素</option>
                    </select>
                  </label>
                </div>
                <button
                  autoFocus
                  className="export-choice-action"
                  type="button"
                  disabled={busy}
                  aria-label={`导出摄影机画面为 ${imageExportFormat.toUpperCase()}`}
                  onClick={() => void exportImage()}
                >
                  <Download aria-hidden="true" />
                  导出图片
                </button>
              </section>
              <section className="export-choice">
                <div className="export-choice-heading">
                  <Film aria-hidden="true" />
                  <div>
                    <strong>动画视频</strong>
                    <span>把镜头、物体和人物动作导出为 MP4</span>
                  </div>
                </div>
                <button
                  className="export-choice-action"
                  type="button"
                  disabled={
                    busy ||
                    (cameraShots.length === 0 &&
                      objectKeyframes.length === 0 &&
                      !hasMannequinAction)
                  }
                  aria-label="按平台预设导出 MP4 视频"
                  onClick={() => {
                    setExportHubOpen(false)
                    openVideoExport()
                  }}
                >
                  <Film aria-hidden="true" />
                  选择视频用途
                </button>
                {cameraShots.length === 0 && objectKeyframes.length === 0 && !hasMannequinAction ? (
                  <small>先记录镜头、物体状态或选择人物动作后即可使用。</small>
                ) : null}
              </section>
              <section className="export-choice">
                <div className="export-choice-heading">
                  <PackageOpen aria-hidden="true" />
                  <div>
                    <strong>三维模型</strong>
                    <span>交给其他三维软件继续编辑</span>
                  </div>
                </div>
                <button
                  className="export-choice-action"
                  type="button"
                  disabled={busy}
                  aria-label="导出场景模型"
                  onClick={() => {
                    setExportHubOpen(false)
                    setModelExportOpen(true)
                  }}
                >
                  <PackageOpen aria-hidden="true" />
                  选择模型格式
                </button>
              </section>
            </div>
            <details className="advanced-export-options">
              <summary>高级导出与检查</summary>
              <p>这些内容主要用于专业工作流，普通图片或视频不需要设置。</p>
              <div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setExportHubOpen(false)
                    inspectQuality()
                  }}
                >
                  <ScanSearch aria-hidden="true" />
                  检查模型质量
                </button>
                <button
                  type="button"
                  disabled={busy}
                  aria-label="导出六张控制参考图"
                  onClick={() => {
                    setExportHubOpen(false)
                    void exportReferenceImages()
                  }}
                >
                  <Images aria-hidden="true" />
                  AI 控制素材
                </button>
                <button
                  type="button"
                  disabled={
                    busy ||
                    (cameraShots.length === 0 &&
                      objectKeyframes.length === 0 &&
                      !hasMannequinAction)
                  }
                  aria-label="导出动画帧序列"
                  onClick={() => {
                    setExportHubOpen(false)
                    void exportAnimationFrames()
                  }}
                >
                  <Images aria-hidden="true" />
                  逐帧图片
                </button>
              </div>
            </details>
          </section>
        </div>
      ) : null}

      {qualityReport ? (
        <div className="dialog-backdrop" role="presentation">
          <section
            className="quality-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="quality-dialog-title"
          >
            <header className="dialog-panel-header">
              <div>
                <span>导出前检查</span>
                <h2 id="quality-dialog-title">模型质量</h2>
              </div>
              <button
                type="button"
                aria-label="关闭质量检查"
                onClick={() => setQualityReport(null)}
              >
                <X aria-hidden="true" />
              </button>
            </header>
            <div className="quality-summary">
              <div>
                <span>模型</span>
                <strong>{qualityReport.objectCount}</strong>
              </div>
              <div>
                <span>三角面</span>
                <strong>{qualityReport.triangleCount.toLocaleString()}</strong>
              </div>
              <div>
                <span>提示</span>
                <strong>{qualityReport.issueCount}</strong>
              </div>
            </div>
            <div className="quality-issues">
              {qualityReport.objectCount === 0 ? (
                <p className="quality-issue is-error">场景中还没有模型。</p>
              ) : qualityReport.issues.length === 0 ? (
                <p className="quality-good">没有发现会影响参考图导出的基础问题。</p>
              ) : (
                qualityReport.issues.map((issue, index) => (
                  <p
                    className={`quality-issue${issue.severity === 'error' ? ' is-error' : ''}`}
                    key={`${issue.objectId ?? 'scene'}-${index}`}
                  >
                    {issue.message}
                  </p>
                ))
              )}
            </div>
            <footer className="dialog-actions quality-actions">
              <button className="secondary" type="button" onClick={() => setQualityReport(null)}>
                关闭
              </button>
              <button
                type="button"
                disabled={qualityReport.status === 'error' || qualityReport.objectCount === 0}
                onClick={() => {
                  setQualityReport(null)
                  void exportReferenceImages()
                }}
              >
                导出六张控制图
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {pendingOptimizationObject && pendingPerformanceRisk ? (
        <div className="dialog-backdrop" role="presentation">
          <section
            className="performance-risk-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="performance-risk-title"
          >
            <div className="dialog-icon" aria-hidden="true">
              <Monitor />
            </div>
            <div className="dialog-copy">
              <span>模型已成功导入</span>
              <h2 id="performance-risk-title">这个模型编辑时可能不够流畅</h2>
              <p>原因是{pendingPerformanceRisk.reasons.join('，')}。这不代表文件有问题。</p>
              <div className="performance-choice-explanation">
                <strong>轻量预览不会覆盖原文件</strong>
                <small>只为画布生成可撤回的低面预览；图片、视频和模型仍默认使用原始精度。</small>
              </div>
            </div>
            <div className="dialog-actions">
              <button
                autoFocus
                type="button"
                onClick={() => {
                  setPendingOptimizationObjectId(null)
                  setImportedPreviewQuality(pendingOptimizationObject.id, 'lightweight')
                }}
              >
                使用轻量预览
              </button>
              <button
                className="secondary"
                type="button"
                onClick={() => {
                  setPendingOptimizationObjectId(null)
                  setNotice({
                    kind: 'info',
                    message: '继续使用原始模型，可在右侧随时开启轻量预览。'
                  })
                }}
              >
                继续使用原模型
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {videoExportOpen ? (
        <div className="dialog-backdrop" role="presentation">
          <section
            className="video-export-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="video-export-title"
          >
            <header className="dialog-panel-header">
              <div>
                <span>MP4 · H.264 · 无音频</span>
                <h2 id="video-export-title">选择视频用途</h2>
              </div>
              <button
                type="button"
                aria-label="关闭视频导出"
                disabled={busy}
                onClick={() => setVideoExportOpen(false)}
              >
                <X aria-hidden="true" />
              </button>
            </header>
            <div className="video-profile-list" role="radiogroup" aria-label="视频导出预设">
              {PLATFORM_PROFILE_RULES.profiles.map((profile) => {
                const selected = profile.id === selectedVideoProfile.id
                return (
                  <button
                    key={profile.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={selected ? 'is-selected' : ''}
                    onClick={() => setSelectedVideoProfileId(profile.id)}
                  >
                    <span className="video-profile-radio" aria-hidden="true">
                      {selected ? <Check /> : null}
                    </span>
                    <span className="video-profile-copy">
                      <strong>{profile.name}</strong>
                      <small>{profile.description}</small>
                    </span>
                    <span className={`video-rule-status status-${profile.verification}`}>
                      {videoVerificationLabels[profile.verification]}
                    </span>
                  </button>
                )
              })}
            </div>
            <div className="video-export-summary">
              <div>
                <span>输出</span>
                <strong>
                  {outputSize(sceneHistory.scene.camera, selectedVideoProfile.maxDimension).width} ×{' '}
                  {outputSize(sceneHistory.scene.camera, selectedVideoProfile.maxDimension).height}
                </strong>
              </div>
              <div>
                <span>帧率</span>
                <strong>{selectedVideoProfile.frameRate} 帧/秒</strong>
              </div>
              <div>
                <span>时长</span>
                <strong>{sceneHistory.scene.timeline.durationSeconds} 秒</strong>
              </div>
              <div>
                <span>预计大小</span>
                <strong>约 {selectedVideoValidation.estimatedFileSizeMb.toFixed(1)} MB</strong>
              </div>
            </div>
            <div className="video-rule-messages" aria-live="polite">
              {selectedVideoValidation.errors.map((message) => (
                <p className="is-error" key={message}>
                  {message}
                </p>
              ))}
              {selectedVideoValidation.warnings.map((message) => (
                <p key={message}>{message}</p>
              ))}
              <small>
                规则核对日期：{PLATFORM_PROFILE_RULES.checkedAt}
                。平台规则可能变化，软件不会假装保证上传成功。
              </small>
            </div>
            <footer className="video-export-actions">
              <button
                className="secondary"
                type="button"
                disabled={busy}
                onClick={() => setVideoExportOpen(false)}
              >
                取消
              </button>
              <button
                type="button"
                disabled={busy || selectedVideoValidation.errors.length > 0}
                onClick={() => void exportAnimationVideo()}
              >
                <Film aria-hidden="true" />
                导出 MP4
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {modelExportOpen ? (
        <div className="dialog-backdrop" role="presentation">
          <section
            className="model-export-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="model-export-title"
          >
            <header className="dialog-panel-header">
              <div>
                <span>静态模型文件</span>
                <h2 id="model-export-title">选择导出格式</h2>
              </div>
              <button
                type="button"
                aria-label="关闭模型导出"
                onClick={() => setModelExportOpen(false)}
              >
                <X aria-hidden="true" />
              </button>
            </header>
            <div className="model-format-list">
              <button type="button" onClick={() => void exportSceneModel('glb')}>
                <span className="model-format-name">
                  <strong>GLB</strong>
                  <em>推荐</em>
                </span>
                <span>单个文件，能保留模型层级和材质，适合多数现代三维工具。</span>
              </button>
              <button type="button" onClick={() => void exportSceneModel('gltf')}>
                <span className="model-format-name">
                  <strong>GLTF</strong>
                </span>
                <span>文本结构便于检查和二次开发，本项目会把资源写进同一个文件。</span>
              </button>
              <button type="button" onClick={() => void exportSceneModel('obj')}>
                <span className="model-format-name">
                  <strong>OBJ</strong>
                </span>
                <span>兼容传统建模工具，只保存静态形体，不保存动画和完整材质。</span>
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {recentProjectsOpen ? (
        <div className="dialog-backdrop" role="presentation">
          <section
            className="recent-projects-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="recent-projects-title"
          >
            <header className="dialog-panel-header">
              <div>
                <span>工程保存在你的电脑，不会上传</span>
                <h2 id="recent-projects-title">本地项目</h2>
              </div>
              <button
                type="button"
                aria-label="关闭本地项目"
                onClick={() => setRecentProjectsOpen(false)}
              >
                <X aria-hidden="true" />
              </button>
            </header>
            <div className="project-library-summary" aria-label="本地项目统计">
              <div>
                <span>项目数量</span>
                <strong>{recentProjects.length}</strong>
              </div>
              <div>
                <span>已知占用空间</span>
                <strong>
                  {formatFileSize(
                    recentProjects.reduce(
                      (total, project) => total + (project.fileSizeBytes ?? 0),
                      0
                    )
                  )}
                </strong>
              </div>
              <p>这里只管理最近使用的本地工程；没有出现在列表中的文件不会被扫描。</p>
            </div>
            <div className="recent-project-list" aria-busy={recentProjectsLoading}>
              {recentProjectsLoading && recentProjects.length === 0 ? (
                <p className="recent-project-empty">正在读取…</p>
              ) : recentProjects.length === 0 ? (
                <p className="recent-project-empty">还没有保存或打开过本地工程。</p>
              ) : (
                recentProjects.map((project) => (
                  <div className="recent-project-row" key={project.filePath}>
                    <button
                      className="recent-project-open"
                      type="button"
                      onClick={() => requestRecentProject(project.filePath)}
                    >
                      <FolderOpen aria-hidden="true" />
                      <span>
                        <strong>{project.displayName}</strong>
                        <small title={project.filePath}>{project.filePath}</small>
                        <em>
                          {formatFileSize(project.fileSizeBytes)} · 修改于{' '}
                          {formatLocalDateTime(project.modifiedAt ?? project.lastOpenedAt)}
                        </em>
                      </span>
                      <time dateTime={project.lastOpenedAt}>
                        最近打开 {formatLocalDateTime(project.lastOpenedAt)}
                      </time>
                    </button>
                    <div className="recent-project-actions">
                      <button
                        type="button"
                        aria-label={`打开所在文件夹 ${project.displayName}`}
                        title="在 Windows 文件资源管理器中显示"
                        disabled={recentProjectsLoading}
                        onClick={() => void showRecentProjectInFolder(project.filePath)}
                      >
                        <FolderOpen aria-hidden="true" />
                        <span>所在文件夹</span>
                      </button>
                      <button
                        type="button"
                        aria-label={`仅移除最近记录 ${project.displayName}`}
                        title="只移除这条记录，原工程文件不会被删除"
                        disabled={recentProjectsLoading}
                        onClick={() => void removeRecentProjectRecord(project.filePath)}
                      >
                        <X aria-hidden="true" />
                        <span>移除记录</span>
                      </button>
                      <button
                        className="recent-project-delete"
                        type="button"
                        aria-label={`删除本地项目文件 ${project.displayName}`}
                        title={
                          project.filePath === projectPath
                            ? '当前正在编辑，不能删除'
                            : '二次确认后移入 Windows 回收站'
                        }
                        disabled={recentProjectsLoading || project.filePath === projectPath}
                        onClick={() => setPendingDeleteProject(project)}
                      >
                        <Trash2 aria-hidden="true" />
                        <span>删除文件</span>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
            <footer className="recent-projects-footer">
              <span>最多保留 8 条记录；删除文件会进入 Windows 回收站。</span>
              <div>
                <button className="quiet" type="button" onClick={() => void clearRecoveryCache()}>
                  清理恢复缓存
                </button>
                <button
                  className="secondary"
                  type="button"
                  onClick={() => setRecentProjectsOpen(false)}
                >
                  关闭
                </button>
              </div>
            </footer>
          </section>
        </div>
      ) : null}

      {pendingDeleteProject ? (
        <div className="dialog-backdrop" role="presentation">
          <section
            className="unsaved-dialog project-delete-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="project-delete-title"
          >
            <div className="dialog-icon danger" aria-hidden="true">
              <Trash2 />
            </div>
            <div className="dialog-copy">
              <h2 id="project-delete-title">删除这个本地工程？</h2>
              <p>
                “{pendingDeleteProject.displayName}”将移入 Windows
                回收站，不会立即永久删除，也不会影响其他工程。
              </p>
              <span className="recovery-path" title={pendingDeleteProject.filePath}>
                {pendingDeleteProject.filePath}
              </span>
            </div>
            <div className="dialog-actions">
              <button
                className="danger-action"
                type="button"
                disabled={recentProjectsLoading}
                onClick={() => void trashRecentProject()}
              >
                {recentProjectsLoading ? '正在移入回收站…' : '移入回收站'}
              </button>
              <button
                autoFocus
                className="secondary"
                type="button"
                disabled={recentProjectsLoading}
                onClick={() => setPendingDeleteProject(null)}
              >
                取消
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {recoverySnapshot ? (
        <div className="dialog-backdrop" role="presentation">
          <section
            className="unsaved-dialog recovery-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="recovery-dialog-title"
          >
            <div className="dialog-icon" aria-hidden="true">
              <HardDrive />
            </div>
            <div className="dialog-copy">
              <h2 id="recovery-dialog-title">发现未保存的工程</h2>
              <p>
                {formatLocalDateTime(recoverySnapshot.capturedAt)} 留下了一份本地恢复副本。
                恢复后仍需手动保存确认。
              </p>
              <span className="recovery-path" title={recoverySnapshot.currentPath ?? '未首次保存'}>
                {recoverySnapshot.currentPath ?? '未首次保存的工程'}
              </span>
            </div>
            <div className="dialog-actions">
              <button
                autoFocus
                type="button"
                disabled={busy}
                onClick={() => void restoreRecovery()}
              >
                恢复工程
              </button>
              <button
                className="secondary"
                type="button"
                disabled={busy}
                onClick={() => void discardRecovery()}
              >
                放弃恢复
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {pendingAction ? (
        <div className="dialog-backdrop" role="presentation">
          <section
            className="unsaved-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="unsaved-dialog-title"
          >
            <div className="dialog-icon" aria-hidden="true">
              <Save />
            </div>
            <div className="dialog-copy">
              <h2 id="unsaved-dialog-title">保存当前更改吗？</h2>
              <p>当前工程还有未保存的更改。保存后再继续，可以避免丢失刚才的操作。</p>
            </div>
            <div className="dialog-actions">
              <button autoFocus type="button" onClick={() => void resolvePendingAction(true)}>
                保存并继续
              </button>
              <button
                className="secondary"
                type="button"
                onClick={() => void resolvePendingAction(false)}
              >
                不保存
              </button>
              <button className="quiet" type="button" onClick={cancelPendingAction}>
                取消
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {videoExportProgress ? (
        <div className="dialog-backdrop" role="presentation">
          <section
            className="sequence-progress-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="video-progress-title"
          >
            <header>
              <Film aria-hidden="true" />
              <div>
                <h2 id="video-progress-title">正在生成视频</h2>
                <span title={videoExportProgress.filePath}>
                  {videoExportProgress.current} / {videoExportProgress.total}
                </span>
              </div>
            </header>
            <progress
              aria-label="视频导出进度"
              max={videoExportProgress.total}
              value={videoExportProgress.current}
            />
            <p>逐帧渲染后编码，画面不会依赖电脑实时播放速度。</p>
            <button
              className="secondary"
              type="button"
              disabled={videoExportProgress.cancelling}
              onClick={() => {
                videoExportCancelRef.current = true
                setVideoExportProgress((current) =>
                  current ? { ...current, cancelling: true } : current
                )
              }}
            >
              {videoExportProgress.cancelling ? '正在取消…' : '取消导出'}
            </button>
          </section>
        </div>
      ) : null}

      {imageSequenceProgress ? (
        <div className="dialog-backdrop" role="presentation">
          <section
            className="sequence-progress-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sequence-progress-title"
          >
            <header>
              <Film aria-hidden="true" />
              <div>
                <h2 id="sequence-progress-title">正在导出动画帧</h2>
                <span title={imageSequenceProgress.directoryPath}>
                  {imageSequenceProgress.current} / {imageSequenceProgress.total}
                </span>
              </div>
            </header>
            <progress
              aria-label="动画帧导出进度"
              max={imageSequenceProgress.total}
              value={imageSequenceProgress.current}
            />
            <button
              className="secondary"
              type="button"
              disabled={imageSequenceProgress.cancelling}
              onClick={() => {
                imageSequenceCancelRef.current = true
                setImageSequenceProgress((current) =>
                  current ? { ...current, cancelling: true } : current
                )
              }}
            >
              {imageSequenceProgress.cancelling ? '正在取消…' : '取消导出'}
            </button>
          </section>
        </div>
      ) : null}

      <section
        className={`timeline-panel${timelineOpen ? ' is-open' : ''}`}
        aria-label="动画时间轴"
        style={
          timelineOpen
            ? { height: `${Math.min(69 + 44 * (1 + animatedObjects.length), 245)}px` }
            : undefined
        }
      >
        <div className="timeline-bar">
          <button
            className="timeline-toggle"
            type="button"
            aria-expanded={timelineOpen}
            onClick={() => setTimelineOpen((current) => !current)}
          >
            <Clock3 aria-hidden="true" />
            <span>动画时间轴</span>
            {timelineOpen ? <ChevronDown aria-hidden="true" /> : <ChevronUp aria-hidden="true" />}
          </button>
          <div className="timeline-transport">
            <CommandButton
              label={timelinePlaying ? '暂停预览' : '播放动画'}
              disabled={
                cameraShots.length === 0 && objectKeyframes.length === 0 && !hasMannequinAction
              }
              onClick={toggleTimelinePlayback}
            >
              {timelinePlaying ? <Pause /> : <Play />}
            </CommandButton>
            <button className="timeline-record" type="button" onClick={recordCameraShot}>
              <Camera aria-hidden="true" />
              <span>记录当前镜头</span>
            </button>
            <button
              className="timeline-record object-record"
              type="button"
              disabled={!selectedObject || selectedObject.locked}
              onClick={recordObjectKeyframe}
            >
              <Box aria-hidden="true" />
              <span>记录物体状态</span>
            </button>
          </div>
          {selectedShot ? (
            <div className="shot-transition" aria-label="镜头衔接方式">
              <span>{selectedShotIndex === 0 ? '起始镜头' : '到此镜头'}</span>
              {selectedShotIndex > 0
                ? (['smooth', 'cut'] as const).map((transition) => (
                    <button
                      key={transition}
                      type="button"
                      className={selectedShot.transition === transition ? 'is-active' : ''}
                      onClick={() => setSelectedShotTransition(transition)}
                    >
                      {transition === 'smooth' ? '平滑移动' : '直接切换'}
                    </button>
                  ))
                : null}
              <button
                className="shot-copy"
                type="button"
                aria-label="复制镜头记录点"
                title="复制到附近空闲时间"
                onClick={duplicateSelectedShot}
              >
                <Copy aria-hidden="true" />
              </button>
              <button
                className="shot-delete"
                type="button"
                aria-label="删除镜头节点"
                onClick={deleteSelectedShot}
              >
                <Trash2 aria-hidden="true" />
              </button>
            </div>
          ) : null}
          {selectedObjectKeyframe ? (
            <div className="shot-transition" aria-label="物体运动方式">
              <span>{selectedObjectKeyframeIndex === 0 ? '起始状态' : '到此状态'}</span>
              {selectedObjectKeyframeIndex > 0
                ? (['smooth', 'linear'] as const).map((interpolation) => (
                    <button
                      key={interpolation}
                      type="button"
                      className={
                        selectedObjectKeyframe.interpolation === interpolation ? 'is-active' : ''
                      }
                      onClick={() => setSelectedObjectInterpolation(interpolation)}
                    >
                      {interpolation === 'smooth' ? '平滑运动' : '匀速运动'}
                    </button>
                  ))
                : null}
              <button
                className="shot-copy"
                type="button"
                aria-label="复制物体状态记录点"
                title="复制到附近空闲时间"
                onClick={duplicateSelectedObjectKeyframe}
              >
                <Copy aria-hidden="true" />
              </button>
              <button
                className="shot-delete"
                type="button"
                aria-label="删除物体状态节点"
                onClick={deleteSelectedObjectKeyframe}
              >
                <Trash2 aria-hidden="true" />
              </button>
            </div>
          ) : null}
          <label className="timeline-duration">
            <span>总时长</span>
            <input
              aria-label="时间轴总时长"
              type="number"
              min={Math.max(
                cameraShots.at(-1)?.timeSeconds ?? 1,
                objectKeyframes.at(-1)?.timeSeconds ?? 1,
                1
              )}
              max="60"
              step="1"
              value={sceneHistory.scene.timeline.durationSeconds}
              onChange={(event) => {
                const minimum = Math.max(
                  cameraShots.at(-1)?.timeSeconds ?? 1,
                  objectKeyframes.at(-1)?.timeSeconds ?? 1,
                  1
                )
                const durationSeconds = Math.min(Math.max(Number(event.target.value), minimum), 60)
                sceneHistory.commit((scene) => ({
                  ...scene,
                  timeline: { ...scene.timeline, durationSeconds }
                }))
                if (timelineTime > durationSeconds) setTimelineCursor(durationSeconds)
              }}
            />
            <span>秒</span>
          </label>
          <span className="timeline-time">
            {timelineTime.toFixed(1)} / {sceneHistory.scene.timeline.durationSeconds.toFixed(1)} 秒
          </span>
        </div>
        {timelineOpen ? (
          <div className="timeline-content">
            <div className="track-labels">
              <div>
                <Camera aria-hidden="true" />
                <span>摄影机镜头</span>
                <strong>{cameraShots.length}</strong>
              </div>
              {animatedObjects.map((object) => (
                <div key={object.id}>
                  <Box aria-hidden="true" />
                  <span title={object.name}>{object.name}</span>
                  <strong>
                    {objectKeyframes.filter((keyframe) => keyframe.objectId === object.id).length}
                  </strong>
                </div>
              ))}
            </div>
            <div
              className="track-area"
              onPointerDown={(event) => {
                if ((event.target as Element).closest('button')) return
                const bounds = event.currentTarget.getBoundingClientRect()
                const time =
                  ((event.clientX - bounds.left) / bounds.width) *
                  sceneHistory.scene.timeline.durationSeconds
                setTimelinePlaying(false)
                setTimelineCursor(time)
              }}
            >
              <div className="time-ruler">
                {Array.from({ length: 6 }, (_, index) => (
                  <span key={index}>
                    {((sceneHistory.scene.timeline.durationSeconds * index) / 5).toFixed(1)}s
                  </span>
                ))}
              </div>
              <div className="track-row">
                {cameraShots.map((shot) => {
                  const isDragging = timelineDrag?.kind === 'camera' && timelineDrag.id === shot.id
                  const markerTime = isDragging ? timelineDrag.timeSeconds : shot.timeSeconds
                  return (
                    <button
                      className={`shot-marker${selectedShotId === shot.id ? ' is-selected' : ''}${
                        isDragging ? ' is-dragging' : ''
                      }`}
                      type="button"
                      key={shot.id}
                      aria-label={`${shot.name}，${markerTime.toFixed(2)} 秒，可左右拖动`}
                      title={`${shot.name} · ${markerTime.toFixed(2)} 秒 · 左右拖动改变时间`}
                      data-marker-kind="camera"
                      data-marker-time={markerTime.toFixed(3)}
                      style={{
                        left: `clamp(8px, ${(markerTime / sceneHistory.scene.timeline.durationSeconds) * 100}%, calc(100% - 8px))`
                      }}
                      onPointerDown={(event) => beginTimelineMarkerDrag(event, 'camera', shot.id)}
                      onPointerMove={updateTimelineMarkerDrag}
                      onPointerUp={finishTimelineMarkerDrag}
                      onPointerCancel={cancelTimelineMarkerDrag}
                      onKeyDown={(event) =>
                        moveTimelineMarkerWithKeyboard(event, 'camera', shot.id)
                      }
                      onClick={(event) => {
                        if (event.detail === 0) selectTimelineMarker('camera', shot.id)
                      }}
                    />
                  )
                })}
              </div>
              {animatedObjects.map((object) => (
                <div className="track-row" key={object.id}>
                  {objectKeyframes
                    .filter((keyframe) => keyframe.objectId === object.id)
                    .map((keyframe) => {
                      const isDragging =
                        timelineDrag?.kind === 'object' && timelineDrag.id === keyframe.id
                      const markerTime = isDragging
                        ? timelineDrag.timeSeconds
                        : keyframe.timeSeconds
                      return (
                        <button
                          className={`shot-marker object-keyframe${
                            selectedObjectKeyframeId === keyframe.id ? ' is-selected' : ''
                          }${isDragging ? ' is-dragging' : ''}`}
                          type="button"
                          key={keyframe.id}
                          aria-label={`${object.name} 状态，${markerTime.toFixed(2)} 秒，可左右拖动`}
                          title={`${object.name} · ${markerTime.toFixed(2)} 秒 · 左右拖动改变时间`}
                          data-marker-kind="object"
                          data-marker-time={markerTime.toFixed(3)}
                          style={{
                            left: `clamp(8px, ${(markerTime / sceneHistory.scene.timeline.durationSeconds) * 100}%, calc(100% - 8px))`
                          }}
                          onPointerDown={(event) =>
                            beginTimelineMarkerDrag(event, 'object', keyframe.id)
                          }
                          onPointerMove={updateTimelineMarkerDrag}
                          onPointerUp={finishTimelineMarkerDrag}
                          onPointerCancel={cancelTimelineMarkerDrag}
                          onKeyDown={(event) =>
                            moveTimelineMarkerWithKeyboard(event, 'object', keyframe.id)
                          }
                          onClick={(event) => {
                            if (event.detail === 0) selectTimelineMarker('object', keyframe.id)
                          }}
                        />
                      )
                    })}
                </div>
              ))}
              <div
                className="playhead"
                style={{
                  left: `${(timelineTime / sceneHistory.scene.timeline.durationSeconds) * 100}%`
                }}
              />
            </div>
          </div>
        ) : null}
      </section>
    </main>
  )
}

export default App
