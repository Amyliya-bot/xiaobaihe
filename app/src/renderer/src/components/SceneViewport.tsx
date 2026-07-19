import {
  forwardRef,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState
} from 'react'
import { Camera as CameraIcon, MoveDiagonal2, X } from 'lucide-react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import {
  TransformControls,
  type TransformControlsMode
} from 'three/addons/controls/TransformControls.js'
import type { OpenModelResult } from '../../../shared/desktop-api'
import type {
  CameraState,
  ImportedModelAsset,
  MannequinJointId,
  MannequinPose,
  ObjectDisplayMode,
  ObjectTransformState,
  SceneLightingState,
  SceneObjectData,
  Vector3Value
} from '../../../shared/project-document'
import { cameraStateFromControl, type CameraControlMode } from '../camera/controls'
import { calculateFrameCamera } from '../camera/framing'
import {
  CAMERA_MONITOR_HEADER_HEIGHT,
  CAMERA_MONITOR_MARGIN,
  cameraMonitorWidthForRatio,
  fitCameraMonitorWindow,
  resizeCameraMonitorWindow,
  type CameraMonitorResizeEdge,
  type CameraMonitorWindow
} from '../camera/monitor-window'
import { objectIdColor } from '../control-passes/object-id-color'
import {
  createStoredModelAsset,
  loadImportedAsset,
  normalizeImportedRoot
} from '../import-export/model-assets'
import {
  exportStaticModel,
  type ExportedStaticModel,
  type StaticModelFormat
} from '../import-export/model-io'
import { DEFAULT_CAMERA_STATE } from '../scene-core/defaults'
import { createCustomMeshGeometry, createGeometry, objectLocalBounds } from '../scene-core/geometry'
import {
  addModelingVertex,
  addModelingEdge,
  createGroundModelingDraft,
  createViewModelingDraft,
  draftMesh,
  draftVertexFromWorld,
  draftVertexWorldPoint,
  extrudeModelingFace,
  insertVertexOnFace,
  mergeModelingVertices,
  modelingFaceWorldCenter,
  modelingFaceWorldNormal,
  moveModelingVertex,
  snapSketchValue,
  type CanvasModelingDraft,
  type MeshElementMode,
  type ModelingPlaneMode,
  type SketchPlane
} from '../scene-core/canvas-modeling'
import { calculateStretch, type StretchAxis, type StretchSign } from '../scene-core/stretch'
import {
  quickBuildTransform,
  snapQuickBuildEnd,
  snapQuickBuildStart,
  type QuickBuildDraft,
  type QuickBuildKind
} from '../scene-core/quick-build'
import {
  applyPaintToMesh,
  createSurfacePreviewGeometry,
  surfaceTriangles
} from '../scene-core/face-paint'
import {
  MANNEQUIN_JOINTS,
  applyMannequinPose,
  cloneMannequinPose,
  createMannequinRig,
  mannequinJointLabel,
  poseMannequinJointToward,
  readMannequinPose
} from '../mannequin/mannequin'
import {
  cloneMannequinObject,
  createMannequinVisual,
  mannequinVisualHandlePosition,
  type MannequinVisualRig,
  type MannequinVisualState
} from '../mannequin/mannequin-visual'
import {
  cloneImportedVariant,
  createLightweightPreview,
  markImportedVariant,
  setImportedVariantVisibility,
  type LightweightPreviewReport
} from '../optimizer/lightweight-preview'
import { outputSize } from '../video/output-size'

export type TransformMode = TransformControlsMode
export type CutAxis = 'x' | 'y' | 'z'

export interface CutPreview {
  objectId: string
  axis: CutAxis
  offset: number
}

export interface ObjectTransformUpdate {
  position: Vector3Value
  rotation: Vector3Value
  size: Vector3Value
}

export interface ObjectTransformBatchUpdate extends ObjectTransformUpdate {
  id: string
}

export interface ReferenceImageBundle {
  white: string
  depth: string
  normal: string
  objectId: string
  mask: string
  outline: string
  width: number
  height: number
}

export interface CapturedFrame {
  base64Data: string
  width: number
  height: number
}

export interface SceneViewportHandle {
  focusView: (objectIds?: string | string[] | null) => FocusViewResult | null
  captureImageBase64: (format: 'png' | 'jpg', maxDimension: number) => CapturedFrame | null
  captureFrameBase64: (
    camera: CameraState,
    objectTransforms: Map<string, ObjectTransformState>,
    animationTimeSeconds: number
  ) => CapturedFrame | null
  copyFrameToCanvas: (
    camera: CameraState,
    objectTransforms: Map<string, ObjectTransformState>,
    target: OffscreenCanvas,
    maxDimension: number,
    animationTimeSeconds: number
  ) => { width: number; height: number } | null
  captureReferenceImages: () => ReferenceImageBundle | null
  exportSceneModel: (format: StaticModelFormat) => Promise<ExportedStaticModel>
  prepareImportedModel: (
    result: Extract<OpenModelResult, { status: 'opened' }>
  ) => Promise<ImportedModelAsset>
  activateImportedCamera: (objectId: string, cameraIndex?: number) => CameraState | null
  createModelingDraft: (planeMode: ModelingPlaneMode) => CanvasModelingDraft
  alignSceneCameraToView: () => CameraState | null
}

export interface FocusViewResult {
  camera: CameraState
  scope: 'object' | 'selection' | 'scene' | 'origin'
  objectId?: string
}

interface SceneViewportProps {
  theme: 'light' | 'dark'
  objects: SceneObjectData[]
  selectedIds: string[]
  transformMode: TransformMode
  cameraState: CameraState
  lighting: SceneLightingState
  cameraPreview: boolean
  cameraMonitor: boolean
  firstPersonCameraControl: boolean
  cameraSelected: boolean
  selectedLightId: string | null
  modelingDraft: CanvasModelingDraft | null
  modelingElementMode: MeshElementMode
  surfacePickObjectId: string | null
  facePaintObjectId: string | null
  facePaintColor: string
  objectTransformPreview: Map<string, ObjectTransformState> | null
  mannequinActionTimeSeconds: number
  cutPreview: CutPreview | null
  quickBuildTool: QuickBuildKind | null
  quickBuildDraft: QuickBuildDraft | null
  mannequinPoseEditing: boolean
  selectedMannequinJoint: MannequinJointId | null
  onSelectionChange: (ids: string[]) => void
  onTransformMany: (updates: ObjectTransformBatchUpdate[]) => void
  onModelingDraftChange: (draft: CanvasModelingDraft, historyMode?: 'push' | 'replace') => void
  onModelingIssue: (message: string | null) => void
  onSurfacePick: (objectId: string, plane: SketchPlane) => void
  onFacePaint: (
    objectId: string,
    meshKey: string,
    triangles: readonly number[],
    color: string
  ) => void
  onQuickBuildDraftChange: (draft: QuickBuildDraft | null) => void
  onQuickBuildCommit: (draft: QuickBuildDraft) => void
  onQuickBuildIssue: (message: string | null) => void
  onMannequinJointSelect: (jointId: MannequinJointId | null) => void
  onMannequinPoseChange: (objectId: string, pose: MannequinPose, jointId: MannequinJointId) => void
  onLightPositionChange: (id: string, position: Vector3Value) => void
  onSceneCameraChange: (camera: CameraState) => void
  onFirstPersonCameraChange: (camera: CameraState, commit: boolean) => void
  onCameraPreviewRequest: () => void
  onCameraMonitorClose: () => void
  onObjectContextMenu: (id: string | null, clientX: number, clientY: number) => void
  onImportError?: (objectId: string, message: string) => void
  onOptimizationReport?: (objectId: string, report: LightweightPreviewReport | null) => void
}

interface ClickGesture {
  pointerId: number
  startX: number
  startY: number
  objectId: string | null
  moved: boolean
  facePaintTarget?: {
    objectId: string
    meshKey: string
    triangles: readonly number[]
  }
}

interface MarqueeGesture extends ClickGesture {
  currentX: number
  currentY: number
}

interface MarqueeRect {
  left: number
  top: number
  width: number
  height: number
}

interface ActiveStretch {
  pointerId: number
  objectId: string
  axis: StretchAxis
  sign: StretchSign
  root: THREE.Object3D
  initialPosition: Vector3Value
  initialSize: Vector3Value
  worldAxis: THREE.Vector3
  axisCenter: THREE.Vector3
  startCoordinate: number
}

interface ActiveTransform {
  ids: string[]
  multi: boolean
  lightId?: string
  cameraStart?: CameraState
  cameraMode?: CameraControlMode
  pivotStart: THREE.Matrix4
  objectStarts: Map<string, THREE.Matrix4>
}

interface ActiveModelingVertex {
  pointerId: number
  index: number
  startX: number
  startY: number
  startWorld: THREE.Vector3
  dragPlane: THREE.Plane
  grabOffset: THREE.Vector3
  lastDraft: CanvasModelingDraft
  mergeTarget: number | null
  moved: boolean
}

interface ModelingPointerPreview {
  point: THREE.Vector3
  perpendicular: boolean
}

interface ActiveModelingExtrusion {
  pointerId: number
  axisCenter: THREE.Vector3
  axis: THREE.Vector3
  startCoordinate: number
  faceIndex: number
  startDraft: CanvasModelingDraft
  moved: boolean
}

interface ActiveMannequinJoint {
  pointerId: number
  objectId: string
  jointId: MannequinJointId
  dragPlane: THREE.Plane
  startPose: MannequinPose
  lastPose: MannequinPose
  visualState: MannequinVisualState
}

interface ActiveCameraMonitorWindow {
  pointerId: number
  mode: 'move' | CameraMonitorResizeEdge
  startX: number
  startY: number
  window: CameraMonitorWindow
}

const stretchHandleDefinitions: Array<{
  axis: StretchAxis
  sign: StretchSign
  color: string
}> = [
  { axis: 'x', sign: 1, color: '#df5b57' },
  { axis: 'x', sign: -1, color: '#df5b57' },
  { axis: 'y', sign: 1, color: '#2fb171' },
  { axis: 'y', sign: -1, color: '#2fb171' },
  { axis: 'z', sign: 1, color: '#4e82dd' },
  { axis: 'z', sign: -1, color: '#4e82dd' }
]

const cameraMonitorResizeHandles: ReadonlyArray<{
  edge: CameraMonitorResizeEdge
  label: string
}> = [
  { edge: 'n', label: '从上侧等比缩放取景窗' },
  { edge: 'ne', label: '从右上角等比缩放取景窗' },
  { edge: 'e', label: '从右侧等比缩放取景窗' },
  { edge: 'se', label: '从右下角等比缩放取景窗' },
  { edge: 's', label: '从下侧等比缩放取景窗' },
  { edge: 'sw', label: '从左下角等比缩放取景窗' },
  { edge: 'w', label: '从左侧等比缩放取景窗' },
  { edge: 'nw', label: '从左上角等比缩放取景窗' }
]

function createObjectMaterial(object: SceneObjectData): THREE.MeshStandardMaterial {
  const displayMode: ObjectDisplayMode = object.displayMode ?? 'solid'
  return new THREE.MeshStandardMaterial({
    color: object.colorOverride ?? object.color,
    roughness: 0.82,
    metalness: 0,
    transparent: displayMode !== 'solid',
    opacity: displayMode === 'transparent' ? 0.34 : displayMode === 'wireframe' ? 0.62 : 1,
    depthWrite: displayMode === 'solid',
    wireframe: displayMode === 'wireframe'
  })
}

function mannequinVisualState(
  object: SceneObjectData,
  preview?: ObjectTransformState,
  actionTimeSeconds?: number
): MannequinVisualState {
  return {
    presetId: preview ? preview.mannequinPresetId : object.mannequin?.presetId,
    manualJoints: preview ? preview.mannequinManualJoints : object.mannequin?.manualJoints,
    actionTimeSeconds,
    presetBlend: preview?.mannequinPresetBlend
  }
}

function createInfiniteGridMaterial(theme: 'light' | 'dark'): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
    uniforms: {
      minorColor: { value: new THREE.Color(theme === 'dark' ? '#4a5556' : '#aeb9ba') },
      majorColor: { value: new THREE.Color(theme === 'dark' ? '#718082' : '#788789') },
      minorOpacity: { value: theme === 'dark' ? 0.3 : 0.34 },
      majorOpacity: { value: theme === 'dark' ? 0.5 : 0.54 }
    },
    vertexShader: `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: `
      varying vec3 vWorldPosition;
      uniform vec3 minorColor;
      uniform vec3 majorColor;
      uniform float minorOpacity;
      uniform float majorOpacity;

      float gridLine(vec2 coordinate) {
        vec2 width = max(fwidth(coordinate), vec2(0.0001));
        vec2 distanceToLine = abs(fract(coordinate - 0.5) - 0.5) / width;
        return 1.0 - min(min(distanceToLine.x, distanceToLine.y), 1.0);
      }

      void main() {
        float minor = gridLine(vWorldPosition.xz);
        float major = gridLine(vWorldPosition.xz / 10.0);
        float cameraDistance = distance(vWorldPosition.xz, cameraPosition.xz);
        float distanceFade = 1.0 - smoothstep(105.0, 245.0, cameraDistance);
        vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
        float angleFade = smoothstep(0.025, 0.16, abs(viewDirection.y));
        float alpha = max(minor * minorOpacity, major * majorOpacity) * distanceFade * angleFade;
        if (alpha < 0.004) discard;
        vec3 color = mix(minorColor, majorColor, major);
        gl_FragColor = vec4(color, alpha);
      }
    `
  })
}

function createLinearDepthMaterial(nearDepth: number, farDepth: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      nearDepth: { value: nearDepth },
      farDepth: { value: Math.max(farDepth, nearDepth + 0.001) }
    },
    vertexShader: `
      varying float vViewDepth;
      void main() {
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        vViewDepth = -viewPosition.z;
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: `
      varying float vViewDepth;
      uniform float nearDepth;
      uniform float farDepth;
      void main() {
        float normalizedDepth = clamp((vViewDepth - nearDepth) / (farDepth - nearDepth), 0.0, 1.0);
        float value = 1.0 - normalizedDepth;
        gl_FragColor = vec4(vec3(value), 1.0);
      }
    `
  })
}

function vectorValue(vector: THREE.Vector3): Vector3Value {
  return { x: vector.x, y: vector.y, z: vector.z }
}

function objectTransform(root: THREE.Object3D): ObjectTransformUpdate {
  return {
    position: vectorValue(root.position),
    rotation: {
      x: THREE.MathUtils.radToDeg(root.rotation.x),
      y: THREE.MathUtils.radToDeg(root.rotation.y),
      z: THREE.MathUtils.radToDeg(root.rotation.z)
    },
    size: {
      x: Math.max(Math.abs(root.scale.x), 0.1),
      y: Math.max(Math.abs(root.scale.y), 0.1),
      z: Math.max(Math.abs(root.scale.z), 0.1)
    }
  }
}

function applyObjectTransform(root: THREE.Object3D, object: SceneObjectData): void {
  root.name = object.name
  root.userData.objectId = object.id
  root.position.set(object.position.x, object.position.y, object.position.z)
  root.rotation.set(
    THREE.MathUtils.degToRad(object.rotation.x),
    THREE.MathUtils.degToRad(object.rotation.y),
    THREE.MathUtils.degToRad(object.rotation.z)
  )
  root.scale.set(object.size.x, object.size.y, object.size.z)
  root.visible = object.visible
  root.updateMatrixWorld(true)
}

function setPointerFromEvent(
  event: Pick<PointerEvent, 'clientX' | 'clientY'>,
  canvas: HTMLCanvasElement,
  pointer: THREE.Vector2
): void {
  const bounds = canvas.getBoundingClientRect()
  pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1
  pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1
}

function localAxisVector(axis: StretchAxis): THREE.Vector3 {
  if (axis === 'x') return new THREE.Vector3(1, 0, 0)
  if (axis === 'y') return new THREE.Vector3(0, 1, 0)
  return new THREE.Vector3(0, 0, 1)
}

function coordinateOnAxis(ray: THREE.Ray, center: THREE.Vector3, axis: THREE.Vector3): number {
  const start = center.clone().addScaledVector(axis, -100)
  const end = center.clone().addScaledVector(axis, 100)
  const pointOnAxis = new THREE.Vector3()
  ray.distanceSqToSegment(start, end, undefined, pointOnAxis)
  return pointOnAxis.sub(center).dot(axis)
}

function modelingPlacementPlane(draft: CanvasModelingDraft): THREE.Plane {
  const normal = new THREE.Vector3(
    draft.plane.normal.x,
    draft.plane.normal.y,
    draft.plane.normal.z
  ).normalize()
  return new THREE.Plane().setFromNormalAndCoplanarPoint(
    normal,
    new THREE.Vector3(draft.plane.origin.x, draft.plane.origin.y, draft.plane.origin.z)
  )
}

function snappedDraftWorldPoint(
  draft: CanvasModelingDraft,
  worldPoint: THREE.Vector3
): THREE.Vector3 {
  const local = draftVertexFromWorld(draft, worldPoint)
  return draftVertexWorldPoint(draft, {
    x: snapSketchValue(local.x),
    y: snapSketchValue(local.y),
    z: snapSketchValue(local.z)
  })
}

function perpendicularModelingPoint(
  draft: CanvasModelingDraft,
  origin: THREE.Vector3,
  candidate: THREE.Vector3
): { point: THREE.Vector3; perpendicular: boolean } {
  const delta = candidate.clone().sub(origin)
  const distance = delta.length()
  if (distance < 1e-6) return { point: candidate, perpendicular: false }
  const direction = delta.clone().normalize()
  let bestDot = 0.105
  let best: THREE.Vector3 | null = null
  for (const [firstIndex, secondIndex] of draft.edges) {
    const first = draftVertexWorldPoint(draft, firstIndex)
    const second = draftVertexWorldPoint(draft, secondIndex)
    const edge = second.sub(first)
    if (edge.lengthSq() < 1e-10) continue
    edge.normalize()
    const dot = Math.abs(direction.dot(edge))
    if (dot >= bestDot) continue
    const perpendicular = direction.clone().sub(edge.multiplyScalar(direction.dot(edge)))
    if (perpendicular.lengthSq() < 1e-10) continue
    bestDot = dot
    best = origin.clone().add(perpendicular.normalize().multiplyScalar(distance))
  }
  return best ? { point: best, perpendicular: true } : { point: candidate, perpendicular: false }
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh || child instanceof THREE.Line)) return
    child.geometry.dispose()
    const materials = Array.isArray(child.material) ? child.material : [child.material]
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) value.dispose()
      }
      material.dispose()
    }
  })
}

function clearGroup(group: THREE.Group): void {
  for (const child of [...group.children]) {
    group.remove(child)
    disposeObject(child)
  }
}

function objectIdFromHit(hit: THREE.Intersection | undefined): string | null {
  let current: THREE.Object3D | null = hit?.object ?? null
  while (current) {
    if (typeof current.userData.objectId === 'string') return current.userData.objectId
    current = current.parent
  }
  return null
}

function cameraSpaceDepthRange(
  roots: Iterable<THREE.Object3D>,
  camera: THREE.PerspectiveCamera
): { near: number; far: number } {
  camera.updateMatrixWorld(true)
  const inverseCamera = camera.matrixWorldInverse
  let near = Number.POSITIVE_INFINITY
  let far = Number.NEGATIVE_INFINITY
  for (const root of roots) {
    if (!root.visible) continue
    const bounds = new THREE.Box3().setFromObject(root)
    if (bounds.isEmpty()) continue
    for (const x of [bounds.min.x, bounds.max.x]) {
      for (const y of [bounds.min.y, bounds.max.y]) {
        for (const z of [bounds.min.z, bounds.max.z]) {
          const depth = -new THREE.Vector3(x, y, z).applyMatrix4(inverseCamera).z
          if (depth > 0) {
            near = Math.min(near, depth)
            far = Math.max(far, depth)
          }
        }
      }
    }
  }
  if (!Number.isFinite(near) || !Number.isFinite(far)) return { near: 0.1, far: 100 }
  const padding = Math.max((far - near) * 0.06, 0.02)
  return { near: Math.max(near - padding, 0), far: far + padding }
}

function screenRectForObject(
  root: THREE.Object3D,
  camera: THREE.PerspectiveCamera,
  canvasBounds: DOMRect
): MarqueeRect | null {
  const bounds = new THREE.Box3().setFromObject(root)
  if (bounds.isEmpty()) return null
  let left = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  let top = Number.POSITIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY
  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) {
        const point = new THREE.Vector3(x, y, z).project(camera)
        if (point.z < -1 || point.z > 1) continue
        const screenX = ((point.x + 1) / 2) * canvasBounds.width
        const screenY = ((1 - point.y) / 2) * canvasBounds.height
        left = Math.min(left, screenX)
        right = Math.max(right, screenX)
        top = Math.min(top, screenY)
        bottom = Math.max(bottom, screenY)
      }
    }
  }
  if (!Number.isFinite(left)) return null
  return { left, top, width: Math.max(right - left, 1), height: Math.max(bottom - top, 1) }
}

function rectanglesOverlap(first: MarqueeRect, second: MarqueeRect): boolean {
  return !(
    first.left + first.width < second.left ||
    second.left + second.width < first.left ||
    first.top + first.height < second.top ||
    second.top + second.height < first.top
  )
}

function updateCameraGuide(
  guide: THREE.Group,
  camera: THREE.PerspectiveCamera,
  theme: 'light' | 'dark',
  selected: boolean
): void {
  clearGroup(guide)
  const depth = 0.38
  const halfHeight = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * depth
  const halfWidth = halfHeight * camera.aspect
  const top = halfHeight + Math.min(halfHeight * 0.34, 0.26)
  const corners = [
    new THREE.Vector3(-halfWidth, halfHeight, -depth),
    new THREE.Vector3(halfWidth, halfHeight, -depth),
    new THREE.Vector3(halfWidth, -halfHeight, -depth),
    new THREE.Vector3(-halfWidth, -halfHeight, -depth)
  ]
  const origin = new THREE.Vector3()
  const points = [
    corners[0],
    corners[1],
    corners[1],
    corners[2],
    corners[2],
    corners[3],
    corners[3],
    corners[0],
    origin,
    corners[0],
    origin,
    corners[1],
    origin,
    corners[2],
    origin,
    corners[3],
    new THREE.Vector3(-halfWidth * 0.34, halfHeight, -depth),
    new THREE.Vector3(0, top, -depth),
    new THREE.Vector3(0, top, -depth),
    new THREE.Vector3(halfWidth * 0.34, halfHeight, -depth)
  ]
  const line = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({
      color: selected ? '#ffb020' : theme === 'dark' ? '#f3f6f5' : '#111820',
      transparent: true,
      opacity: selected ? 0.96 : theme === 'dark' ? 0.72 : 0.82,
      depthTest: false
    })
  )
  line.renderOrder = 850
  guide.position.copy(camera.position)
  guide.quaternion.copy(camera.quaternion)
  guide.add(line)
}

function applyOutputCameraState(
  camera: THREE.PerspectiveCamera,
  state: CameraState,
  canvas?: HTMLCanvasElement
): void {
  camera.position.set(state.position.x, state.position.y, state.position.z)
  camera.fov = state.fovDegrees
  camera.aspect = state.aspectWidth / state.aspectHeight
  camera.lookAt(state.target.x, state.target.y, state.target.z)
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld(true)
  if (canvas) {
    canvas.dataset.outputCameraPosition = JSON.stringify(state.position)
    canvas.dataset.outputCameraTarget = JSON.stringify(state.target)
    canvas.dataset.outputCameraFov = String(state.fovDegrees)
  }
}

function updateCameraTargetGuide(
  guide: THREE.Group,
  state: CameraState,
  theme: 'light' | 'dark',
  selected: boolean
): void {
  clearGroup(guide)
  guide.position.set(state.target.x, state.target.y, state.target.z)
  guide.visible = selected
  if (!selected) return

  const color = theme === 'dark' ? '#ffd166' : '#e07a00'
  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(0.13, 16, 12),
    new THREE.MeshBasicMaterial({ color, depthTest: false })
  )
  marker.renderOrder = 920
  guide.add(marker)

  const span = 0.34
  const cross = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-span, 0, 0),
      new THREE.Vector3(span, 0, 0),
      new THREE.Vector3(0, -span, 0),
      new THREE.Vector3(0, span, 0),
      new THREE.Vector3(0, 0, -span),
      new THREE.Vector3(0, 0, span)
    ]),
    new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.86 })
  )
  cross.renderOrder = 919
  guide.add(cross)
}

function pointToSegmentDistance(
  pointX: number,
  pointY: number,
  startX: number,
  startY: number,
  endX: number,
  endY: number
): number {
  const deltaX = endX - startX
  const deltaY = endY - startY
  const lengthSquared = deltaX * deltaX + deltaY * deltaY
  if (lengthSquared <= Number.EPSILON) return Math.hypot(pointX - startX, pointY - startY)
  const progress = THREE.MathUtils.clamp(
    ((pointX - startX) * deltaX + (pointY - startY) * deltaY) / lengthSquared,
    0,
    1
  )
  return Math.hypot(pointX - (startX + deltaX * progress), pointY - (startY + deltaY * progress))
}

function cameraGuideScreenHit(
  guide: THREE.Group,
  camera: THREE.PerspectiveCamera,
  canvasBounds: DOMRect,
  clientX: number,
  clientY: number,
  tolerancePixels = 8
): boolean {
  guide.updateWorldMatrix(true, true)
  camera.updateMatrixWorld(true)
  const pointerX = clientX - canvasBounds.left
  const pointerY = clientY - canvasBounds.top
  const start = new THREE.Vector3()
  const end = new THREE.Vector3()
  const projectedStart = new THREE.Vector3()
  const projectedEnd = new THREE.Vector3()
  let hit = false

  guide.traverse((object) => {
    if (hit || !(object instanceof THREE.LineSegments)) return
    const positions = object.geometry.getAttribute('position')
    if (!positions) return
    for (let index = 0; index + 1 < positions.count; index += 2) {
      start.fromBufferAttribute(positions, index).applyMatrix4(object.matrixWorld)
      end.fromBufferAttribute(positions, index + 1).applyMatrix4(object.matrixWorld)
      const startDepth = start.clone().applyMatrix4(camera.matrixWorldInverse).z
      const endDepth = end.clone().applyMatrix4(camera.matrixWorldInverse).z
      if (startDepth >= -camera.near || endDepth >= -camera.near) continue
      projectedStart.copy(start).project(camera)
      projectedEnd.copy(end).project(camera)
      if (
        !Number.isFinite(projectedStart.x) ||
        !Number.isFinite(projectedStart.y) ||
        !Number.isFinite(projectedEnd.x) ||
        !Number.isFinite(projectedEnd.y) ||
        projectedStart.z < -1 ||
        projectedStart.z > 1 ||
        projectedEnd.z < -1 ||
        projectedEnd.z > 1
      ) {
        continue
      }
      const startX = ((projectedStart.x + 1) / 2) * canvasBounds.width
      const startY = ((1 - projectedStart.y) / 2) * canvasBounds.height
      const endX = ((projectedEnd.x + 1) / 2) * canvasBounds.width
      const endY = ((1 - projectedEnd.y) / 2) * canvasBounds.height
      if (
        pointToSegmentDistance(pointerX, pointerY, startX, startY, endX, endY) <= tolerancePixels
      ) {
        hit = true
        return
      }
    }
  })
  return hit
}

const SceneViewport = forwardRef<SceneViewportHandle, SceneViewportProps>(function SceneViewport(
  {
    theme,
    objects,
    selectedIds,
    transformMode,
    cameraState,
    lighting,
    cameraPreview,
    cameraMonitor,
    firstPersonCameraControl,
    cameraSelected,
    selectedLightId,
    modelingDraft,
    modelingElementMode,
    surfacePickObjectId,
    facePaintObjectId,
    facePaintColor,
    objectTransformPreview,
    mannequinActionTimeSeconds,
    cutPreview,
    quickBuildTool,
    quickBuildDraft,
    mannequinPoseEditing,
    selectedMannequinJoint,
    onSelectionChange,
    onTransformMany,
    onModelingDraftChange,
    onModelingIssue,
    onSurfacePick,
    onFacePaint,
    onQuickBuildDraftChange,
    onQuickBuildCommit,
    onQuickBuildIssue,
    onMannequinJointSelect,
    onMannequinPoseChange,
    onLightPositionChange,
    onSceneCameraChange,
    onFirstPersonCameraChange,
    onCameraPreviewRequest,
    onCameraMonitorClose,
    onObjectContextMenu,
    onImportError,
    onOptimizationReport
  },
  ref
): React.JSX.Element {
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cameraMonitorViewportRef = useRef<HTMLDivElement>(null)
  const cameraMonitorBoundsRef = useRef<{
    left: number
    bottom: number
    width: number
    height: number
  } | null>(null)
  const [marqueeRect, setMarqueeRect] = useState<MarqueeRect | null>(null)
  const [cameraMonitorWindow, setCameraMonitorWindow] = useState<CameraMonitorWindow>({
    x: null,
    y: 52,
    width: 360
  })
  const cameraMonitorRatioRef = useRef(cameraState.aspectWidth / cameraState.aspectHeight)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const objectGroupRef = useRef<THREE.Group | null>(null)
  const stretchGroupRef = useRef<THREE.Group | null>(null)
  const originMarkerRef = useRef<THREE.Group | null>(null)
  const groundRef = useRef<THREE.Mesh | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const sceneCameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const cameraHelperRef = useRef<THREE.Group | null>(null)
  const cameraTargetHelperRef = useRef<THREE.Group | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const transformControlsRef = useRef<TransformControls | null>(null)
  const transformHelperRef = useRef<THREE.Object3D | null>(null)
  const transformPivotRef = useRef<THREE.Object3D | null>(null)
  const gridRef = useRef<THREE.Mesh | null>(null)
  const selectionHelperRef = useRef<THREE.Box3Helper | null>(null)
  const hemisphereRef = useRef<THREE.HemisphereLight | null>(null)
  const sceneFillRef = useRef<THREE.DirectionalLight | null>(null)
  const modelingGroupRef = useRef<THREE.Group | null>(null)
  const modelingVertexGroupRef = useRef<THREE.Group | null>(null)
  const modelingEdgeGroupRef = useRef<THREE.Group | null>(null)
  const modelingFaceRef = useRef<THREE.Mesh | null>(null)
  const modelingSurfaceGroupRef = useRef<THREE.Group | null>(null)
  const modelingPreviewLineRef = useRef<THREE.Line | null>(null)
  const modelingPreviewPointRef = useRef<THREE.Mesh | null>(null)
  const modelingPointerPreviewRef = useRef<ModelingPointerPreview | null>(null)
  const cutPreviewGroupRef = useRef<THREE.Group | null>(null)
  const facePaintPreviewRef = useRef<THREE.Mesh | null>(null)
  const modelingExtrudeHandleRef = useRef<THREE.Mesh | null>(null)
  const quickBuildPreviewRef = useRef<THREE.Mesh | null>(null)
  const userLightGroupRef = useRef<THREE.Group | null>(null)
  const lightGroupRef = useRef<THREE.Group | null>(null)
  const lightRootMapRef = useRef(new Map<string, THREE.Object3D>())
  const rootMapRef = useRef(new Map<string, THREE.Object3D>())
  const importedCameraMapRef = useRef(new Map<string, THREE.Camera[]>())
  const clickGestureRef = useRef<ClickGesture | null>(null)
  const marqueeGestureRef = useRef<MarqueeGesture | null>(null)
  const activeStretchRef = useRef<ActiveStretch | null>(null)
  const activeTransformRef = useRef<ActiveTransform | null>(null)
  const activeModelingVertexRef = useRef<ActiveModelingVertex | null>(null)
  const activeModelingExtrusionRef = useRef<ActiveModelingExtrusion | null>(null)
  const activeMannequinJointRef = useRef<ActiveMannequinJoint | null>(null)
  const activeCameraMonitorWindowRef = useRef<ActiveCameraMonitorWindow | null>(null)
  const mannequinHandleRefs = useRef(new Map<MannequinJointId, HTMLButtonElement>())
  const modelingDragIssueRef = useRef<string | null>(null)
  const objectBuildVersionRef = useRef(0)
  const suppressCameraEventsUntilRef = useRef(0)
  const selectedIdsRef = useRef(selectedIds)
  const objectsRef = useRef(objects)
  const transformModeRef = useRef(transformMode)
  const cameraStateRef = useRef(cameraState)
  const mannequinActionTimeRef = useRef(mannequinActionTimeSeconds)
  const cameraPreviewRef = useRef(cameraPreview)
  const cameraMonitorRef = useRef(cameraMonitor)
  const firstPersonCameraControlRef = useRef(firstPersonCameraControl)
  const mannequinPoseEditingRef = useRef(mannequinPoseEditing)
  const modelingDraftRef = useRef(modelingDraft)
  const modelingElementModeRef = useRef(modelingElementMode)
  const quickBuildToolRef = useRef(quickBuildTool)
  const quickBuildDraftRef = useRef(quickBuildDraft)
  const surfacePickObjectIdRef = useRef(surfacePickObjectId)
  const facePaintObjectIdRef = useRef(facePaintObjectId)
  const facePaintColorRef = useRef(facePaintColor)
  const onSelectionChangeRef = useRef(onSelectionChange)
  const onTransformManyRef = useRef(onTransformMany)
  const onModelingDraftChangeRef = useRef(onModelingDraftChange)
  const onModelingIssueRef = useRef(onModelingIssue)
  const onSurfacePickRef = useRef(onSurfacePick)
  const onFacePaintRef = useRef(onFacePaint)
  const onQuickBuildDraftChangeRef = useRef(onQuickBuildDraftChange)
  const onQuickBuildCommitRef = useRef(onQuickBuildCommit)
  const onQuickBuildIssueRef = useRef(onQuickBuildIssue)
  const onMannequinJointSelectRef = useRef(onMannequinJointSelect)
  const onMannequinPoseChangeRef = useRef(onMannequinPoseChange)
  const onLightPositionChangeRef = useRef(onLightPositionChange)
  const onSceneCameraChangeRef = useRef(onSceneCameraChange)
  const onFirstPersonCameraChangeRef = useRef(onFirstPersonCameraChange)
  const onCameraPreviewRequestRef = useRef(onCameraPreviewRequest)
  const onObjectContextMenuRef = useRef(onObjectContextMenu)
  const onImportErrorRef = useRef(onImportError)
  const onOptimizationReportRef = useRef(onOptimizationReport)

  useEffect(() => {
    selectedIdsRef.current = selectedIds
    objectsRef.current = objects
    transformModeRef.current = transformMode
    cameraStateRef.current = cameraState
    mannequinActionTimeRef.current = mannequinActionTimeSeconds
    cameraPreviewRef.current = cameraPreview
    cameraMonitorRef.current = cameraMonitor
    firstPersonCameraControlRef.current = firstPersonCameraControl
    mannequinPoseEditingRef.current = mannequinPoseEditing
    modelingDraftRef.current = modelingDraft
    modelingElementModeRef.current = modelingElementMode
    quickBuildToolRef.current = quickBuildTool
    quickBuildDraftRef.current = quickBuildDraft
    surfacePickObjectIdRef.current = surfacePickObjectId
    facePaintObjectIdRef.current = facePaintObjectId
    facePaintColorRef.current = facePaintColor
    onSelectionChangeRef.current = onSelectionChange
    onTransformManyRef.current = onTransformMany
    onModelingDraftChangeRef.current = onModelingDraftChange
    onModelingIssueRef.current = onModelingIssue
    onSurfacePickRef.current = onSurfacePick
    onFacePaintRef.current = onFacePaint
    onQuickBuildDraftChangeRef.current = onQuickBuildDraftChange
    onQuickBuildCommitRef.current = onQuickBuildCommit
    onQuickBuildIssueRef.current = onQuickBuildIssue
    onMannequinJointSelectRef.current = onMannequinJointSelect
    onMannequinPoseChangeRef.current = onMannequinPoseChange
    onLightPositionChangeRef.current = onLightPositionChange
    onSceneCameraChangeRef.current = onSceneCameraChange
    onFirstPersonCameraChangeRef.current = onFirstPersonCameraChange
    onCameraPreviewRequestRef.current = onCameraPreviewRequest
    onObjectContextMenuRef.current = onObjectContextMenu
    onImportErrorRef.current = onImportError
    onOptimizationReportRef.current = onOptimizationReport
  }, [
    cameraState,
    mannequinActionTimeSeconds,
    cameraPreview,
    cameraMonitor,
    firstPersonCameraControl,
    mannequinPoseEditing,
    modelingDraft,
    modelingElementMode,
    quickBuildTool,
    quickBuildDraft,
    surfacePickObjectId,
    facePaintObjectId,
    facePaintColor,
    objects,
    onLightPositionChange,
    onCameraPreviewRequest,
    onModelingDraftChange,
    onModelingIssue,
    onSurfacePick,
    onFacePaint,
    onQuickBuildDraftChange,
    onQuickBuildCommit,
    onQuickBuildIssue,
    onMannequinJointSelect,
    onMannequinPoseChange,
    onImportError,
    onOptimizationReport,
    onObjectContextMenu,
    onSelectionChange,
    onSceneCameraChange,
    onFirstPersonCameraChange,
    onTransformMany,
    selectedIds,
    transformMode
  ])

  const emitCameraState = useCallback((commit = false): void => {
    const camera = cameraRef.current
    const controls = controlsRef.current
    if (!camera || !controls) return
    const nextCamera = {
      position: vectorValue(camera.position),
      target: vectorValue(controls.target),
      fovDegrees: camera.fov,
      aspectWidth: cameraStateRef.current.aspectWidth,
      aspectHeight: cameraStateRef.current.aspectHeight
    }
    const canvas = canvasRef.current
    if (canvas) {
      canvas.dataset.cameraPosition = JSON.stringify(nextCamera.position)
      canvas.dataset.cameraTarget = JSON.stringify(nextCamera.target)
      canvas.dataset.cameraFov = String(nextCamera.fovDegrees)
    }
    if (firstPersonCameraControlRef.current) {
      onFirstPersonCameraChangeRef.current(nextCamera, commit)
    }
  }, [])

  const updateSelectionBounds = useCallback((): void => {
    const helper = selectionHelperRef.current
    if (!helper) return
    helper.box.makeEmpty()
    for (const id of selectedIdsRef.current) {
      const root = rootMapRef.current.get(id)
      if (root?.visible) helper.box.expandByObject(root)
    }
  }, [])

  const captureWithoutGuides = useCallback(<T,>(render: () => T): T => {
    const guides = [
      gridRef.current,
      transformHelperRef.current,
      selectionHelperRef.current,
      stretchGroupRef.current,
      originMarkerRef.current,
      modelingGroupRef.current,
      quickBuildPreviewRef.current,
      lightGroupRef.current,
      cameraHelperRef.current,
      cameraTargetHelperRef.current,
      facePaintPreviewRef.current
    ].filter((guide): guide is THREE.Object3D => guide !== null)
    const visibility = guides.map((guide) => guide.visible)
    const importedVisibility: Array<{ variant: THREE.Object3D; visible: boolean }> = []
    for (const object of objectsRef.current) {
      if (object.kind !== 'imported') continue
      const root = rootMapRef.current.get(object.id)
      if (!root) continue
      for (const child of root.children) {
        if (
          child.userData.importedQuality === 'original' ||
          child.userData.importedQuality === 'lightweight'
        ) {
          importedVisibility.push({ variant: child, visible: child.visible })
        }
      }
      setImportedVariantVisibility(root, object.exportQuality ?? 'original')
    }
    for (const guide of guides) guide.visible = false
    try {
      return render()
    } finally {
      guides.forEach((guide, index) => {
        guide.visible = visibility[index]
      })
      for (const snapshot of importedVisibility) snapshot.variant.visible = snapshot.visible
    }
  }, [])

  const renderOutputFrame = useCallback(
    <T,>(
      cameraState: CameraState,
      objectTransforms: Map<string, ObjectTransformState> | undefined,
      animationTimeSeconds: number,
      maxDimension: number,
      readResult: (canvas: HTMLCanvasElement, size: { width: number; height: number }) => T
    ): T | null => {
      const renderer = rendererRef.current
      const scene = sceneRef.current
      const camera = sceneCameraRef.current
      if (!renderer || !scene || !camera) return null
      return captureWithoutGuides(() => {
        const previousSize = renderer.getSize(new THREE.Vector2())
        const previousPixelRatio = renderer.getPixelRatio()
        const previousScissorTest = renderer.getScissorTest()
        const previousCamera = structuredClone(cameraStateRef.current)
        const rootSnapshots = new Map<
          string,
          {
            position: THREE.Vector3
            quaternion: THREE.Quaternion
            scale: THREE.Vector3
            mannequinPose?: MannequinPose
            mannequinVisualState?: MannequinVisualState
          }
        >()
        const size = outputSize(cameraState, maxDimension)
        try {
          const changedObjectIds = new Set([
            ...(objectTransforms?.keys() ?? []),
            ...objectsRef.current
              .filter((object) => object.kind === 'mannequin')
              .map((object) => object.id)
          ])
          for (const objectId of changedObjectIds) {
            const object = objectsRef.current.find((item) => item.id === objectId)
            const root = rootMapRef.current.get(objectId)
            if (!root || !object) continue
            rootSnapshots.set(objectId, {
              position: root.position.clone(),
              quaternion: root.quaternion.clone(),
              scale: root.scale.clone(),
              mannequinPose: readMannequinPose(root),
              mannequinVisualState: root.userData.mannequinVisualState as
                MannequinVisualState | undefined
            })
            const transform = objectTransforms?.get(objectId)
            if (transform) {
              root.position.set(transform.position.x, transform.position.y, transform.position.z)
              root.rotation.set(
                THREE.MathUtils.degToRad(transform.rotation.x),
                THREE.MathUtils.degToRad(transform.rotation.y),
                THREE.MathUtils.degToRad(transform.rotation.z)
              )
              root.scale.set(transform.size.x, transform.size.y, transform.size.z)
            }
            if (object.kind === 'mannequin' && object.mannequin) {
              applyMannequinPose(
                root,
                transform?.mannequinPose ?? object.mannequin.pose,
                mannequinVisualState(object, transform, animationTimeSeconds)
              )
            }
            root.updateMatrixWorld(true)
          }
          applyOutputCameraState(camera, cameraState)
          renderer.setScissorTest(false)
          renderer.setPixelRatio(1)
          renderer.setSize(size.width, size.height, false)
          renderer.render(scene, camera)
          return readResult(renderer.domElement, size)
        } finally {
          for (const [objectId, snapshot] of rootSnapshots) {
            const root = rootMapRef.current.get(objectId)
            if (!root) continue
            root.position.copy(snapshot.position)
            root.quaternion.copy(snapshot.quaternion)
            root.scale.copy(snapshot.scale)
            if (snapshot.mannequinPose) {
              applyMannequinPose(root, snapshot.mannequinPose, snapshot.mannequinVisualState)
            }
            root.updateMatrixWorld(true)
          }
          applyOutputCameraState(camera, previousCamera)
          renderer.setPixelRatio(previousPixelRatio)
          renderer.setSize(previousSize.x, previousSize.y, false)
          renderer.setScissorTest(previousScissorTest)
        }
      })
    },
    [captureWithoutGuides]
  )

  const captureFrame = useCallback(
    (
      cameraState: CameraState,
      objectTransforms?: Map<string, ObjectTransformState>,
      animationTimeSeconds = mannequinActionTimeRef.current
    ): CapturedFrame | null => {
      return renderOutputFrame(
        cameraState,
        objectTransforms,
        animationTimeSeconds,
        1280,
        (canvas, size) => ({
          base64Data: canvas.toDataURL('image/png').split(',')[1] ?? '',
          width: size.width,
          height: size.height
        })
      )
    },
    [renderOutputFrame]
  )

  useImperativeHandle(ref, () => ({
    focusView: (objectIds) => {
      const camera = cameraRef.current
      const controls = controlsRef.current
      const canvas = canvasRef.current
      if (!camera || !controls || !canvas) return null
      suppressCameraEventsUntilRef.current = performance.now() + 250
      const requestedIds = Array.isArray(objectIds) ? objectIds : objectIds ? [objectIds] : []
      const requestedRoots = requestedIds
        .map((id) => rootMapRef.current.get(id))
        .filter((root): root is THREE.Object3D => Boolean(root?.visible))
      const visibleRoots = [...rootMapRef.current.values()].filter((root) => root.visible)
      const bounds = new THREE.Box3()
      let scope: FocusViewResult['scope'] = 'origin'
      let resolvedObjectId: string | undefined

      if (requestedRoots.length > 0) {
        for (const root of requestedRoots) bounds.expandByObject(root)
        scope = requestedRoots.length === 1 ? 'object' : 'selection'
        resolvedObjectId = requestedRoots.length === 1 ? requestedIds[0] : undefined
      } else if (visibleRoots.length > 0) {
        for (const root of visibleRoots) bounds.expandByObject(root)
        scope = 'scene'
      }

      let nextCamera: CameraState
      if (bounds.isEmpty()) {
        nextCamera = {
          position: { ...DEFAULT_CAMERA_STATE.position },
          target: { ...DEFAULT_CAMERA_STATE.target },
          fovDegrees: DEFAULT_CAMERA_STATE.fovDegrees,
          aspectWidth: cameraStateRef.current.aspectWidth,
          aspectHeight: cameraStateRef.current.aspectHeight
        }
      } else {
        const sphere = bounds.getBoundingSphere(new THREE.Sphere())
        nextCamera = calculateFrameCamera({
          center: vectorValue(sphere.center),
          radius: sphere.radius,
          currentCamera: {
            position: vectorValue(camera.position),
            target: vectorValue(controls.target),
            fovDegrees: camera.fov,
            aspectWidth: cameraStateRef.current.aspectWidth,
            aspectHeight: cameraStateRef.current.aspectHeight
          },
          verticalFovDegrees: camera.fov,
          aspect: camera.aspect
        })
        const distance = Math.hypot(
          nextCamera.position.x - nextCamera.target.x,
          nextCamera.position.y - nextCamera.target.y,
          nextCamera.position.z - nextCamera.target.z
        )
        controls.maxDistance = Math.max(70, distance * 2)
        camera.far = Math.max(180, distance + sphere.radius * 4)
        camera.updateProjectionMatrix()
      }

      camera.fov = nextCamera.fovDegrees
      camera.position.set(nextCamera.position.x, nextCamera.position.y, nextCamera.position.z)
      controls.target.set(nextCamera.target.x, nextCamera.target.y, nextCamera.target.z)
      const dampingEnabled = controls.enableDamping
      controls.enableDamping = false
      controls.update()
      controls.enableDamping = dampingEnabled
      canvas.dataset.focusScope = scope
      if (resolvedObjectId) canvas.dataset.focusObject = resolvedObjectId
      else delete canvas.dataset.focusObject
      emitCameraState()
      return { camera: nextCamera, scope, objectId: resolvedObjectId }
    },
    captureImageBase64: (format, maxDimension) =>
      renderOutputFrame(
        cameraStateRef.current,
        undefined,
        mannequinActionTimeRef.current,
        maxDimension,
        (canvas, size) => ({
          base64Data:
            canvas
              .toDataURL(
                format === 'jpg' ? 'image/jpeg' : 'image/png',
                format === 'jpg' ? 0.92 : undefined
              )
              .split(',')[1] ?? '',
          width: size.width,
          height: size.height
        })
      ),
    captureFrameBase64: (camera, objectTransforms, animationTimeSeconds) =>
      captureFrame(camera, objectTransforms, animationTimeSeconds),
    copyFrameToCanvas: (camera, objectTransforms, target, maxDimension, animationTimeSeconds) =>
      renderOutputFrame(
        camera,
        objectTransforms,
        animationTimeSeconds,
        maxDimension,
        (canvas, size) => {
          if (target.width !== size.width) target.width = size.width
          if (target.height !== size.height) target.height = size.height
          const context = target.getContext('2d', { alpha: false })
          if (!context) return null
          context.drawImage(canvas, 0, 0, size.width, size.height)
          return size
        }
      ),
    exportSceneModel: async (format) => {
      const objectGroup = objectGroupRef.current
      if (!objectGroup) throw new Error('三维场景还没有准备好，请稍后重试。')

      const pendingObject = objectsRef.current.find((object) => {
        const root = rootMapRef.current.get(object.id)
        return root?.visible && root.userData.exportReady !== true
      })
      if (pendingObject) {
        throw new Error(`“${pendingObject.name}”仍在读取中或读取失败，暂时不能导出。`)
      }

      const exportRoot = new THREE.Group()
      exportRoot.name = 'XiaobaiheScene'
      for (const object of objectsRef.current) {
        const root = rootMapRef.current.get(object.id)
        if (!root?.visible) continue
        const clone =
          object.kind === 'imported'
            ? cloneImportedVariant(root, object.exportQuality ?? 'original')
            : object.kind === 'mannequin'
              ? cloneMannequinObject(root, format === 'obj')
              : root.clone(true)
        clone.name = object.name
        exportRoot.add(clone)
      }
      exportRoot.updateMatrixWorld(true)
      return exportStaticModel(exportRoot, format)
    },
    captureReferenceImages: () => {
      const renderer = rendererRef.current
      const scene = sceneRef.current
      const camera = sceneCameraRef.current
      const objectGroup = objectGroupRef.current
      const ground = groundRef.current
      if (!renderer || !scene || !camera || !objectGroup || !ground) return null

      return captureWithoutGuides(() => {
        const originalBackground = scene.background
        const originalFog = scene.fog
        const originalOverride = scene.overrideMaterial
        const originalGroundVisibility = ground.visible
        const originalToneMapping = renderer.toneMapping
        const originalExposure = renderer.toneMappingExposure
        const originalSize = renderer.getSize(new THREE.Vector2())
        const originalPixelRatio = renderer.getPixelRatio()
        const size = outputSize(cameraStateRef.current)
        const whiteMaterial = new THREE.MeshStandardMaterial({
          color: '#dfe3e1',
          roughness: 0.86,
          metalness: 0
        })
        let depthMaterial: THREE.ShaderMaterial | null = null
        const normalMaterial = new THREE.MeshNormalMaterial()
        const maskMaterial = new THREE.MeshBasicMaterial({ color: '#ffffff' })
        const objectIdMaterials = new Map<string, THREE.MeshBasicMaterial>()
        const originalMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>()
        const toBase64 = (): string =>
          renderer.domElement.toDataURL('image/png').split(',')[1] ?? ''

        try {
          renderer.setPixelRatio(1)
          renderer.setSize(size.width, size.height, false)
          scene.background = new THREE.Color('#f5f6f6')
          scene.fog = null
          scene.overrideMaterial = whiteMaterial
          renderer.toneMapping = THREE.ACESFilmicToneMapping
          renderer.toneMappingExposure = 1
          renderer.render(scene, camera)
          const white = toBase64()

          const depthRange = cameraSpaceDepthRange(rootMapRef.current.values(), camera)
          depthMaterial = createLinearDepthMaterial(depthRange.near, depthRange.far)
          ground.visible = false
          scene.background = new THREE.Color('#000000')
          scene.overrideMaterial = depthMaterial
          renderer.toneMapping = THREE.NoToneMapping
          renderer.render(scene, camera)
          const depth = toBase64()

          scene.overrideMaterial = normalMaterial
          renderer.render(scene, camera)
          const normal = toBase64()

          scene.overrideMaterial = null
          for (const [objectId, root] of rootMapRef.current) {
            if (!root.visible) continue
            const material = new THREE.MeshBasicMaterial({ color: objectIdColor(objectId) })
            objectIdMaterials.set(objectId, material)
            root.traverse((child) => {
              if (!(child instanceof THREE.Mesh)) return
              originalMaterials.set(child, child.material)
              child.material = material
            })
          }
          renderer.render(scene, camera)
          const objectId = toBase64()
          for (const [mesh, material] of originalMaterials) mesh.material = material
          originalMaterials.clear()

          scene.overrideMaterial = maskMaterial
          renderer.render(scene, camera)
          const mask = toBase64()

          const outlineScene = new THREE.Scene()
          outlineScene.background = new THREE.Color('#ffffff')
          const edgeMaterial = new THREE.LineBasicMaterial({ color: '#111111' })
          const silhouetteMaterial = new THREE.MeshBasicMaterial({
            color: '#111111',
            side: THREE.BackSide
          })
          const fillMaterial = new THREE.MeshBasicMaterial({ color: '#ffffff' })
          objectGroup.updateMatrixWorld(true)
          objectGroup.traverse((child) => {
            if (!(child instanceof THREE.Mesh) || !child.visible) return
            let parent: THREE.Object3D | null = child
            let effectivelyVisible = true
            while (parent && parent !== objectGroup) {
              if (!parent.visible) effectivelyVisible = false
              parent = parent.parent
            }
            if (!effectivelyVisible) return
            const silhouette = new THREE.Mesh(child.geometry, silhouetteMaterial)
            silhouette.matrix.copy(
              child.matrixWorld.clone().multiply(new THREE.Matrix4().makeScale(1.018, 1.018, 1.018))
            )
            silhouette.matrixAutoUpdate = false
            silhouette.renderOrder = 0
            outlineScene.add(silhouette)
            const fill = new THREE.Mesh(child.geometry, fillMaterial)
            fill.matrix.copy(child.matrixWorld)
            fill.matrixAutoUpdate = false
            fill.renderOrder = 1
            outlineScene.add(fill)
            const edges = new THREE.LineSegments(
              new THREE.EdgesGeometry(child.geometry, 28),
              edgeMaterial
            )
            edges.matrix.copy(child.matrixWorld)
            edges.matrixAutoUpdate = false
            edges.renderOrder = 2
            outlineScene.add(edges)
          })
          renderer.render(outlineScene, camera)
          const outline = toBase64()
          for (const edge of [...outlineScene.children]) {
            outlineScene.remove(edge)
            if (edge instanceof THREE.LineSegments) edge.geometry.dispose()
          }
          edgeMaterial.dispose()
          silhouetteMaterial.dispose()
          fillMaterial.dispose()

          return {
            white,
            depth,
            normal,
            objectId,
            mask,
            outline,
            width: size.width,
            height: size.height
          }
        } finally {
          scene.background = originalBackground
          scene.fog = originalFog
          scene.overrideMaterial = originalOverride
          ground.visible = originalGroundVisibility
          renderer.toneMapping = originalToneMapping
          renderer.toneMappingExposure = originalExposure
          renderer.setPixelRatio(originalPixelRatio)
          renderer.setSize(originalSize.x, originalSize.y, false)
          whiteMaterial.dispose()
          depthMaterial?.dispose()
          normalMaterial.dispose()
          maskMaterial.dispose()
          for (const material of objectIdMaterials.values()) material.dispose()
          for (const [mesh, material] of originalMaterials) mesh.material = material
          renderer.render(scene, camera)
        }
      })
    },
    prepareImportedModel: async (result) =>
      createStoredModelAsset(result, rendererRef.current ?? undefined),
    activateImportedCamera: (objectId, cameraIndex = 0) => {
      const importedCamera = importedCameraMapRef.current.get(objectId)?.[cameraIndex]
      if (!importedCamera) return null
      importedCamera.updateMatrixWorld(true)
      const position = importedCamera.getWorldPosition(new THREE.Vector3())
      const direction = importedCamera.getWorldDirection(new THREE.Vector3())
      const target = position.clone().addScaledVector(direction, 5)
      const fovDegrees =
        importedCamera instanceof THREE.PerspectiveCamera
          ? THREE.MathUtils.clamp(importedCamera.fov, 10, 120)
          : cameraStateRef.current.fovDegrees
      const next = {
        position: vectorValue(position),
        target: vectorValue(target),
        fovDegrees,
        aspectWidth: cameraStateRef.current.aspectWidth,
        aspectHeight: cameraStateRef.current.aspectHeight
      }
      return next
    },
    createModelingDraft: (planeMode) => {
      if (planeMode === 'ground') return createGroundModelingDraft()
      const camera = cameraRef.current
      const controls = controlsRef.current
      if (!camera || !controls) return createGroundModelingDraft()
      return createViewModelingDraft(vectorValue(camera.position), vectorValue(controls.target))
    },
    alignSceneCameraToView: () => {
      const camera = cameraRef.current
      const controls = controlsRef.current
      if (!camera || !controls) return null
      return {
        position: vectorValue(camera.position),
        target: vectorValue(controls.target),
        fovDegrees: camera.fov,
        aspectWidth: cameraStateRef.current.aspectWidth,
        aspectHeight: cameraStateRef.current.aspectHeight
      }
    }
  }))

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined
    const rootMap = rootMapRef.current
    const lightRootMap = lightRootMapRef.current
    const importedCameraMap = importedCameraMapRef.current

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(theme === 'dark' ? '#202426' : '#dfe3e5')
    scene.fog = new THREE.Fog(theme === 'dark' ? '#202426' : '#dfe3e5', 36, 96)
    sceneRef.current = scene

    const camera = new THREE.PerspectiveCamera(DEFAULT_CAMERA_STATE.fovDegrees, 1, 0.1, 180)
    camera.position.set(
      DEFAULT_CAMERA_STATE.position.x,
      DEFAULT_CAMERA_STATE.position.y,
      DEFAULT_CAMERA_STATE.position.z
    )
    cameraRef.current = camera

    const sceneCamera = new THREE.PerspectiveCamera(
      cameraStateRef.current.fovDegrees,
      cameraStateRef.current.aspectWidth / cameraStateRef.current.aspectHeight,
      0.1,
      180
    )
    sceneCamera.position.set(
      cameraStateRef.current.position.x,
      cameraStateRef.current.position.y,
      cameraStateRef.current.position.z
    )
    sceneCamera.lookAt(
      cameraStateRef.current.target.x,
      cameraStateRef.current.target.y,
      cameraStateRef.current.target.z
    )
    sceneCamera.updateProjectionMatrix()
    sceneCamera.updateMatrixWorld(true)
    scene.add(sceneCamera)
    sceneCameraRef.current = sceneCamera
    const cameraHelper = new THREE.Group()
    cameraHelper.userData.cameraGuide = true
    scene.add(cameraHelper)
    cameraHelperRef.current = cameraHelper
    const cameraTargetHelper = new THREE.Group()
    cameraTargetHelper.userData.cameraTargetGuide = true
    scene.add(cameraTargetHelper)
    cameraTargetHelperRef.current = cameraTargetHelper
    canvas.dataset.cameraFrame = 'visible'

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      preserveDrawingBuffer: true
    })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = theme === 'dark' ? 1.12 : 1
    rendererRef.current = renderer

    const controls = new OrbitControls(camera, canvas)
    controls.enableDamping = true
    controls.dampingFactor = 0.07
    controls.screenSpacePanning = true
    controls.minDistance = 1.5
    controls.maxDistance = 70
    controls.minPolarAngle = 0
    controls.maxPolarAngle = Math.PI
    controls.mouseButtons.LEFT = THREE.MOUSE.PAN
    controls.mouseButtons.MIDDLE = THREE.MOUSE.ROTATE
    controls.mouseButtons.RIGHT = null
    controls.target.set(
      DEFAULT_CAMERA_STATE.target.x,
      DEFAULT_CAMERA_STATE.target.y,
      DEFAULT_CAMERA_STATE.target.z
    )
    controls.update()
    canvas.dataset.cameraPosition = JSON.stringify(vectorValue(camera.position))
    canvas.dataset.cameraTarget = JSON.stringify(vectorValue(controls.target))
    canvas.dataset.cameraFov = String(camera.fov)
    let cameraChangeTimer: number | undefined
    const scheduleCameraChange = (): void => {
      if (performance.now() < suppressCameraEventsUntilRef.current) return
      emitCameraState(false)
      if (cameraChangeTimer !== undefined) window.clearTimeout(cameraChangeTimer)
      cameraChangeTimer = window.setTimeout(() => emitCameraState(true), 180)
    }
    controls.addEventListener('change', scheduleCameraChange)
    controls.addEventListener('end', scheduleCameraChange)
    controlsRef.current = controls

    const groundMaterial = new THREE.MeshStandardMaterial({
      color: theme === 'dark' ? '#333a3b' : '#f4f6f6',
      roughness: 0.98,
      metalness: 0,
      transparent: true,
      opacity: theme === 'dark' ? 0.2 : 0.34,
      depthWrite: false,
      side: THREE.DoubleSide
    })
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), groundMaterial)
    ground.rotation.x = -Math.PI / 2
    ground.receiveShadow = true
    scene.add(ground)
    groundRef.current = ground

    const gridMaterial = createInfiniteGridMaterial(theme)
    const grid = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), gridMaterial)
    grid.rotation.x = -Math.PI / 2
    grid.position.y = 0.008
    grid.renderOrder = -1
    scene.add(grid)
    gridRef.current = grid
    canvas.dataset.gridMode = 'camera-following-infinite'
    canvas.dataset.gridTriangles = '2'

    const originMarker = new THREE.Group()
    const originMaterial = new THREE.MeshBasicMaterial({
      color: theme === 'dark' ? '#51d3bb' : '#0b8f7b',
      side: THREE.DoubleSide,
      depthTest: false
    })
    const originRing = new THREE.Mesh(new THREE.RingGeometry(0.13, 0.2, 32), originMaterial)
    originRing.rotation.x = -Math.PI / 2
    originRing.position.y = 0.018
    originRing.renderOrder = 900
    originMarker.add(originRing)
    const crossGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.42, 0.02, 0),
      new THREE.Vector3(0.42, 0.02, 0),
      new THREE.Vector3(0, 0.02, -0.42),
      new THREE.Vector3(0, 0.02, 0.42)
    ])
    const cross = new THREE.LineSegments(
      crossGeometry,
      new THREE.LineBasicMaterial({
        color: theme === 'dark' ? '#51d3bb' : '#0b8f7b',
        depthTest: false
      })
    )
    cross.renderOrder = 900
    originMarker.add(cross)
    scene.add(originMarker)
    originMarkerRef.current = originMarker
    canvas.dataset.originMarker = 'true'
    canvas.dataset.cameraControls = 'left-pan-middle-orbit-right-marquee'

    const objectGroup = new THREE.Group()
    scene.add(objectGroup)
    objectGroupRef.current = objectGroup

    const quickBuildPreview = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({
        color: theme === 'dark' ? '#79e0cc' : '#087563',
        transparent: true,
        opacity: 0.42,
        depthWrite: false
      })
    )
    quickBuildPreview.visible = false
    quickBuildPreview.renderOrder = 820
    scene.add(quickBuildPreview)
    quickBuildPreviewRef.current = quickBuildPreview

    const userLightGroup = new THREE.Group()
    scene.add(userLightGroup)
    userLightGroupRef.current = userLightGroup

    const lightGroup = new THREE.Group()
    scene.add(lightGroup)
    lightGroupRef.current = lightGroup

    const modelingGroup = new THREE.Group()
    scene.add(modelingGroup)
    modelingGroupRef.current = modelingGroup
    const modelingVertexGroup = new THREE.Group()
    const modelingEdgeGroup = new THREE.Group()
    modelingGroup.add(modelingVertexGroup, modelingEdgeGroup)
    modelingVertexGroupRef.current = modelingVertexGroup
    modelingEdgeGroupRef.current = modelingEdgeGroup

    const facePaintPreview = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({
        color: facePaintColorRef.current,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        side: THREE.DoubleSide
      })
    )
    facePaintPreview.visible = false
    facePaintPreview.renderOrder = 950
    scene.add(facePaintPreview)
    facePaintPreviewRef.current = facePaintPreview

    const stretchGroup = new THREE.Group()
    scene.add(stretchGroup)
    stretchGroupRef.current = stretchGroup

    const pivot = new THREE.Object3D()
    pivot.userData.multiPivot = true
    scene.add(pivot)
    transformPivotRef.current = pivot

    const hemisphere = new THREE.HemisphereLight('#ffffff', '#a9b0b1', 1.15)
    scene.add(hemisphere)
    hemisphereRef.current = hemisphere

    const fillLight = new THREE.DirectionalLight('#e5f4f1', 0.42)
    fillLight.position.set(-5, 4, -3)
    scene.add(fillLight)
    sceneFillRef.current = fillLight

    const transformControls = new TransformControls(camera, canvas)
    transformControls.size = 0.82
    transformControls.setSpace('world')
    transformControls.addEventListener('dragging-changed', (event) => {
      controls.enabled = event.value !== true
    })
    transformControls.addEventListener('mouseDown', () => {
      const attached = transformControls.object
      if (!attached) return
      const lightId =
        typeof attached.userData.lightId === 'string' ? attached.userData.lightId : undefined
      const cameraStart =
        attached.userData.cameraGuide || attached.userData.cameraTargetGuide
          ? structuredClone(cameraStateRef.current)
          : undefined
      const cameraMode = cameraStart
        ? attached.userData.cameraTargetGuide
          ? 'aim'
          : 'translate'
        : undefined
      const editableIds = selectedIdsRef.current.filter((id) => {
        const object = objectsRef.current.find((item) => item.id === id)
        return Boolean(rootMap.get(id) && object && !object.locked)
      })
      const ids = attached.userData.multiPivot
        ? editableIds
        : typeof attached.userData.objectId === 'string'
          ? [attached.userData.objectId]
          : []
      attached.updateMatrixWorld(true)
      activeTransformRef.current = {
        ids,
        multi: Boolean(attached.userData.multiPivot),
        lightId,
        cameraStart,
        cameraMode,
        pivotStart: attached.matrixWorld.clone(),
        objectStarts: new Map(
          ids.map((id) => {
            const root = rootMap.get(id)
            root?.updateMatrixWorld(true)
            return [id, root?.matrixWorld.clone() ?? new THREE.Matrix4()]
          })
        )
      }
    })
    transformControls.addEventListener('objectChange', () => {
      const active = activeTransformRef.current
      const attached = transformControls.object
      if (!active || !attached) return
      if (active.cameraStart && active.cameraMode) {
        const sceneCamera = sceneCameraRef.current
        if (!sceneCamera) return
        const nextCamera = cameraStateFromControl(
          active.cameraStart,
          vectorValue(attached.position),
          active.cameraMode
        )
        applyOutputCameraState(sceneCamera, nextCamera, canvas)
        const cameraGuide = cameraHelperRef.current
        const targetGuide = cameraTargetHelperRef.current
        if (active.cameraMode === 'aim' && cameraGuide) {
          cameraGuide.quaternion.copy(sceneCamera.quaternion)
        } else if (targetGuide) {
          targetGuide.position.set(nextCamera.target.x, nextCamera.target.y, nextCamera.target.z)
        }
        return
      }
      if (!active.multi) return
      attached.updateMatrixWorld(true)
      const delta = attached.matrixWorld.clone().multiply(active.pivotStart.clone().invert())
      for (const id of active.ids) {
        const root = rootMap.get(id)
        const start = active.objectStarts.get(id)
        if (!root || !start) continue
        const next = delta.clone().multiply(start)
        next.decompose(root.position, root.quaternion, root.scale)
        root.updateMatrixWorld(true)
      }
      updateSelectionBounds()
    })
    transformControls.addEventListener('mouseUp', () => {
      const active = activeTransformRef.current
      activeTransformRef.current = null
      if (!active) return
      if (active.lightId) {
        const light = lightRootMapRef.current.get(active.lightId)
        if (light) onLightPositionChangeRef.current(active.lightId, vectorValue(light.position))
        return
      }
      if (active.cameraStart) {
        const guide = cameraHelperRef.current
        const targetGuide = cameraTargetHelperRef.current
        const control = active.cameraMode === 'aim' ? targetGuide : guide
        if (!control || !active.cameraMode) return
        onSceneCameraChangeRef.current(
          cameraStateFromControl(
            active.cameraStart,
            vectorValue(control.position),
            active.cameraMode
          )
        )
        return
      }
      if (active.ids.length === 0) return
      onTransformManyRef.current(
        active.ids.flatMap((id) => {
          const root = rootMap.get(id)
          return root ? [{ id, ...objectTransform(root) }] : []
        })
      )
    })
    const transformHelper = transformControls.getHelper()
    scene.add(transformHelper)
    transformControlsRef.current = transformControls
    transformHelperRef.current = transformHelper

    const raycaster = new THREE.Raycaster()
    raycaster.params.Line = { threshold: 0.18 }
    const pointer = new THREE.Vector2()
    const updateRay = (event: Pick<PointerEvent, 'clientX' | 'clientY'>): void => {
      setPointerFromEvent(event, canvas, pointer)
      raycaster.setFromCamera(pointer, camera)
    }
    const hitObjectId = (event: Pick<PointerEvent, 'clientX' | 'clientY'>): string | null => {
      updateRay(event)
      return objectIdFromHit(raycaster.intersectObjects([...rootMap.values()], true)[0])
    }

    const facePaintHit = (
      event: Pick<PointerEvent, 'clientX' | 'clientY'>
    ):
      | {
          objectId: string
          mesh: THREE.Mesh
          meshKey: string
          triangles: readonly number[]
        }
      | undefined => {
      const objectId = facePaintObjectIdRef.current
      const root = objectId ? rootMap.get(objectId) : undefined
      if (!objectId || !root) return undefined
      updateRay(event)
      const hit = raycaster
        .intersectObject(root, true)
        .find(
          (intersection) =>
            intersection.object instanceof THREE.Mesh &&
            typeof intersection.faceIndex === 'number' &&
            typeof intersection.object.userData.paintMeshKey === 'string'
        )
      if (!hit || !(hit.object instanceof THREE.Mesh) || typeof hit.faceIndex !== 'number') {
        return undefined
      }
      const meshKey = hit.object.userData.paintMeshKey as string
      return {
        objectId,
        mesh: hit.object,
        meshKey,
        triangles: surfaceTriangles(hit.object.geometry, hit.faceIndex)
      }
    }

    const clearFacePaintPreview = (): void => {
      const preview = facePaintPreviewRef.current
      if (!preview) return
      if (!preview.visible) {
        delete canvas.dataset.facePaintSurfaceSize
        return
      }
      preview.visible = false
      preview.geometry.dispose()
      preview.geometry = new THREE.BufferGeometry()
      delete canvas.dataset.facePaintSurfaceSize
    }

    const updateFacePaintPreview = (event: Pick<PointerEvent, 'clientX' | 'clientY'>): void => {
      const preview = facePaintPreviewRef.current
      if (!preview || !facePaintObjectIdRef.current) {
        clearFacePaintPreview()
        return
      }
      const hit = facePaintHit(event)
      if (!hit || hit.triangles.length === 0) {
        clearFacePaintPreview()
        return
      }
      preview.geometry.dispose()
      preview.geometry = createSurfacePreviewGeometry(hit.mesh, hit.triangles)
      ;(preview.material as THREE.MeshBasicMaterial).color.set(facePaintColorRef.current)
      preview.visible = true
      canvas.dataset.facePaintSurfaceSize = String(hit.triangles.length)
    }

    const updateStretchHandles = (): void => {
      const selectedRoot =
        transformModeRef.current === 'scale' && selectedIdsRef.current.length === 1
          ? rootMap.get(selectedIdsRef.current[0])
          : undefined
      if (!selectedRoot || !stretchGroup.visible) return
      selectedRoot.updateMatrixWorld(true)
      for (const handle of stretchGroup.children) {
        const axis = handle.userData.axis as StretchAxis
        const sign = handle.userData.sign as StretchSign
        const localPosition = localAxisVector(axis).multiplyScalar(sign * 0.5)
        selectedRoot.localToWorld(localPosition)
        handle.position.copy(localPosition)
        const distance = camera.position.distanceTo(localPosition)
        handle.scale.setScalar(Math.max(distance * 0.015, 0.075))
      }
    }

    const updateMannequinHandles = (): void => {
      const hideAll = (): void => {
        for (const handle of mannequinHandleRefs.current.values()) {
          handle.style.visibility = 'hidden'
        }
      }
      if (
        !mannequinPoseEditingRef.current ||
        cameraPreviewRef.current ||
        modelingDraftRef.current ||
        quickBuildToolRef.current ||
        selectedIdsRef.current.length !== 1
      ) {
        hideAll()
        return
      }
      const object = objectsRef.current.find((item) => item.id === selectedIdsRef.current[0])
      const root = object?.kind === 'mannequin' ? rootMap.get(object.id) : undefined
      const handles = root?.userData.mannequinHandles as
        Map<MannequinJointId, THREE.Object3D> | undefined
      if (!object || object.locked || !root?.visible || !handles) {
        hideAll()
        return
      }
      const canvasBounds = canvas.getBoundingClientRect()
      const point = new THREE.Vector3()
      for (const definition of MANNEQUIN_JOINTS) {
        const handle = mannequinHandleRefs.current.get(definition.id)
        const endpoint = handles.get(definition.id)
        if (!handle || !endpoint) continue
        const visualPoint = mannequinVisualHandlePosition(root, definition.id, point)
        if (!visualPoint) endpoint.getWorldPosition(point)
        point.project(camera)
        const visible =
          Number.isFinite(point.x) && Number.isFinite(point.y) && point.z >= -1 && point.z <= 1
        handle.style.visibility = visible ? 'visible' : 'hidden'
        if (!visible) continue
        handle.style.left = `${((point.x + 1) / 2) * canvasBounds.width}px`
        handle.style.top = `${((1 - point.y) / 2) * canvasBounds.height}px`
      }
      canvas.dataset.mannequinJointCount = String(MANNEQUIN_JOINTS.length)
    }

    const quickBuildGroundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    const emitQuickBuildDraft = (draft: QuickBuildDraft | null): void => {
      quickBuildDraftRef.current = draft
      onQuickBuildDraftChangeRef.current(draft)
    }
    const quickBuildPoint = (
      event: Pick<PointerEvent, 'clientX' | 'clientY'>
    ): THREE.Vector3 | null => {
      updateRay(event)
      return raycaster.ray.intersectPlane(quickBuildGroundPlane, new THREE.Vector3())
    }
    const handlePointerDown = (event: PointerEvent): void => {
      if (cameraPreviewRef.current) return
      const quickTool = quickBuildToolRef.current
      if (quickTool && event.button === 0) {
        event.preventDefault()
        event.stopImmediatePropagation()
        const hit = quickBuildPoint(event)
        if (!hit) {
          onQuickBuildIssueRef.current('当前视角没有指向参考地面，请先稍微向下观察。')
          return
        }
        const current = quickBuildDraftRef.current
        if (!current || current.kind !== quickTool) {
          const start = snapQuickBuildStart(vectorValue(hit))
          emitQuickBuildDraft({ kind: quickTool, start, end: start })
          onQuickBuildIssueRef.current(null)
          canvas.dataset.quickBuildPhase = 'drawing'
          return
        }
        const snapped = snapQuickBuildEnd(quickTool, current.start, vectorValue(hit))
        const nextDraft = { ...current, end: snapped.point }
        emitQuickBuildDraft(nextDraft)
        if (!quickBuildTransform(nextDraft)) {
          onQuickBuildIssueRef.current(
            quickTool === 'wall' ? '墙体长度需要至少 0.2。' : '地面的长和宽都需要至少 0.2。'
          )
          return
        }
        onQuickBuildCommitRef.current(nextDraft)
        const continuation =
          quickTool === 'wall'
            ? { kind: quickTool, start: snapped.point, end: snapped.point }
            : null
        emitQuickBuildDraft(continuation)
        onQuickBuildIssueRef.current(null)
        canvas.dataset.quickBuildPhase = continuation ? 'drawing' : 'ready'
        canvas.dataset.quickBuildLastKind = quickTool
        return
      }
      const surfacePickId = surfacePickObjectIdRef.current
      if (surfacePickId && event.button === 0) {
        event.preventDefault()
        event.stopImmediatePropagation()
        updateRay(event)
        const root = rootMap.get(surfacePickId)
        const hit = root
          ? raycaster
              .intersectObject(root, true)
              .find(
                (intersection) => intersection.face && intersection.object instanceof THREE.Mesh
              )
          : undefined
        if (hit?.face) {
          const normal = hit.face.normal
            .clone()
            .applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld))
            .normalize()
          let axisU = new THREE.Vector3(1, 0, 0)
            .applyQuaternion(camera.quaternion)
            .projectOnPlane(normal)
          if (axisU.lengthSq() < 1e-8) {
            axisU =
              Math.abs(normal.y) < 0.9
                ? new THREE.Vector3(0, 1, 0).cross(normal)
                : new THREE.Vector3(0, 0, 1).cross(normal)
          }
          axisU.normalize()
          const axisV = normal.clone().cross(axisU).normalize()
          onSurfacePickRef.current(surfacePickId, {
            origin: vectorValue(hit.point.clone().addScaledVector(normal, 0.002)),
            normal: vectorValue(normal),
            axisU: vectorValue(axisU),
            axisV: vectorValue(axisV)
          })
          canvas.dataset.surfacePickHit = 'true'
        } else {
          canvas.dataset.surfacePickHit = 'false'
        }
        return
      }
      const draft = modelingDraftRef.current
      if (draft && event.button === 0) {
        event.preventDefault()
        event.stopImmediatePropagation()
        updateRay(event)
        const mode = modelingElementModeRef.current
        const vertexGroup = modelingVertexGroupRef.current
        const edgeGroup = modelingEdgeGroupRef.current
        const surfaceGroup = modelingSurfaceGroupRef.current
        const extrusionHandle = modelingExtrudeHandleRef.current

        if (mode === 'vertex') {
          const vertexHit = vertexGroup
            ? raycaster.intersectObjects(vertexGroup.children, false)[0]
            : undefined
          const vertexIndex = vertexHit?.object.userData.modelingVertexIndex
          if (typeof vertexIndex === 'number') {
            const startWorld = draftVertexWorldPoint(draft, vertexIndex)
            const dragPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(
              camera.getWorldDirection(new THREE.Vector3()).normalize(),
              startWorld
            )
            const pointerPoint = raycaster.ray.intersectPlane(dragPlane, new THREE.Vector3())
            modelingDragIssueRef.current = null
            delete canvas.dataset.modelingDragState
            delete canvas.dataset.modelingIssue
            onModelingIssueRef.current(null)
            activeModelingVertexRef.current = {
              pointerId: event.pointerId,
              index: vertexIndex,
              startX: event.clientX,
              startY: event.clientY,
              startWorld,
              dragPlane,
              grabOffset: pointerPoint ? startWorld.clone().sub(pointerPoint) : new THREE.Vector3(),
              lastDraft: draft,
              mergeTarget: null,
              moved: false
            }
            controls.enabled = false
            canvas.setPointerCapture(event.pointerId)
            onModelingDraftChangeRef.current(
              {
                ...draft,
                selectedVertex: vertexIndex,
                selectedEdge: null,
                selectedEdges: [],
                pendingEdgeVertex: null,
                selectedFace: null
              },
              'push'
            )
            return
          }
          const faceHit = surfaceGroup
            ? raycaster.intersectObjects(surfaceGroup.children, false)[0]
            : undefined
          const faceIndex = faceHit?.object.userData.modelingFaceIndex
          if (faceHit && typeof faceIndex === 'number') {
            try {
              onModelingDraftChangeRef.current(
                insertVertexOnFace(draft, faceIndex, faceHit.point),
                'push'
              )
              onModelingIssueRef.current(null)
            } catch (error) {
              onModelingIssueRef.current(
                error instanceof Error ? error.message : '无法在这个面上添加点。'
              )
            }
            return
          }
          const worldPoint = raycaster.ray.intersectPlane(
            modelingPlacementPlane(draft),
            new THREE.Vector3()
          )
          if (!worldPoint || draft.vertices.length >= 4096) return
          const preview = modelingPointerPreviewRef.current
          const point = preview?.point ?? snappedDraftWorldPoint(draft, worldPoint)
          const connectFrom =
            draft.faces.length === 0 && draft.vertices.length > 0 ? draft.vertices.length - 1 : null
          onModelingDraftChangeRef.current(addModelingVertex(draft, point, connectFrom), 'push')
          return
        }

        if (mode === 'edge') {
          const vertexHit = vertexGroup
            ? raycaster.intersectObjects(vertexGroup.children, false)[0]
            : undefined
          const vertexIndex = vertexHit?.object.userData.modelingVertexIndex
          if (typeof vertexIndex === 'number') {
            const nextDraft =
              draft.pendingEdgeVertex === null
                ? { ...draft, pendingEdgeVertex: vertexIndex, selectedVertex: vertexIndex }
                : addModelingEdge(draft, draft.pendingEdgeVertex, vertexIndex)
            onModelingDraftChangeRef.current(nextDraft, 'push')
            return
          }
          const edgeHit = edgeGroup
            ? raycaster.intersectObjects(edgeGroup.children, false)[0]
            : undefined
          const edgeIndex = edgeHit?.object.userData.modelingEdgeIndex
          if (typeof edgeIndex === 'number' && (event.shiftKey || event.ctrlKey || event.metaKey)) {
            const selectedEdges = draft.selectedEdges.includes(edgeIndex)
              ? draft.selectedEdges.filter((index) => index !== edgeIndex)
              : [...draft.selectedEdges, edgeIndex]
            onModelingDraftChangeRef.current(
              {
                ...draft,
                selectedVertex: null,
                selectedEdge: edgeIndex,
                selectedEdges,
                pendingEdgeVertex: null,
                selectedFace: null
              },
              'push'
            )
            return
          }
          onModelingDraftChangeRef.current(
            {
              ...draft,
              selectedVertex: null,
              selectedEdge: typeof edgeIndex === 'number' ? edgeIndex : null,
              selectedEdges: typeof edgeIndex === 'number' ? [edgeIndex] : [],
              pendingEdgeVertex: null,
              selectedFace: null
            },
            typeof edgeIndex === 'number' ? 'push' : 'replace'
          )
          return
        }

        const handleHit =
          extrusionHandle && draft.selectedFace !== null
            ? raycaster.intersectObject(extrusionHandle, false)[0]
            : undefined
        if (handleHit && extrusionHandle && draft.selectedFace !== null) {
          const axis = modelingFaceWorldNormal(draft, draft.selectedFace)
          const axisCenter = extrusionHandle.position.clone()
          activeModelingExtrusionRef.current = {
            pointerId: event.pointerId,
            axisCenter,
            axis,
            startCoordinate: coordinateOnAxis(raycaster.ray, axisCenter, axis),
            faceIndex: draft.selectedFace,
            startDraft: draft,
            moved: false
          }
          controls.enabled = false
          canvas.setPointerCapture(event.pointerId)
          onModelingDraftChangeRef.current(draft, 'push')
          return
        }
        const faceHit = surfaceGroup
          ? raycaster.intersectObjects(surfaceGroup.children, false)[0]
          : undefined
        const faceIndex = faceHit?.object.userData.modelingFaceIndex
        onModelingDraftChangeRef.current(
          {
            ...draft,
            selectedVertex: null,
            selectedEdge: null,
            selectedEdges: [],
            pendingEdgeVertex: null,
            selectedFace: typeof faceIndex === 'number' ? faceIndex : null
          },
          'replace'
        )
        return
      }

      if (draft && event.button === 2) {
        event.preventDefault()
        event.stopImmediatePropagation()
        return
      }

      if (event.button === 2) {
        event.preventDefault()
        event.stopImmediatePropagation()
        const objectId = hitObjectId(event)
        marqueeGestureRef.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          currentX: event.clientX,
          currentY: event.clientY,
          objectId,
          moved: false
        }
        canvas.dataset.marqueePhase = 'down'
        canvas.setPointerCapture(event.pointerId)
        return
      }
      if (event.button !== 0) return
      updateRay(event)

      const cameraGuide = cameraHelperRef.current
      if (
        cameraGuide?.visible &&
        cameraGuideScreenHit(
          cameraGuide,
          camera,
          canvas.getBoundingClientRect(),
          event.clientX,
          event.clientY
        )
      ) {
        event.preventDefault()
        event.stopImmediatePropagation()
        onCameraPreviewRequestRef.current()
        return
      }

      if (stretchGroup.visible) {
        const stretchHit = raycaster.intersectObjects(stretchGroup.children, false)[0]
        if (stretchHit) {
          const handle = stretchHit.object
          const axis = handle.userData.axis as StretchAxis
          const sign = handle.userData.sign as StretchSign
          const objectId = handle.userData.objectId as string
          const root = rootMap.get(objectId)
          if (root) {
            event.preventDefault()
            event.stopImmediatePropagation()
            controls.enabled = false
            canvas.setPointerCapture(event.pointerId)
            const worldAxis = localAxisVector(axis).applyQuaternion(root.quaternion).normalize()
            const axisCenter = root.position.clone()
            activeStretchRef.current = {
              pointerId: event.pointerId,
              objectId,
              axis,
              sign,
              root,
              initialPosition: vectorValue(root.position),
              initialSize: vectorValue(root.scale),
              worldAxis,
              axisCenter,
              startCoordinate: coordinateOnAxis(raycaster.ray, axisCenter, worldAxis)
            }
            return
          }
        }
      }

      const paintHit = facePaintHit(event)

      clickGestureRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        objectId:
          paintHit?.objectId ??
          objectIdFromHit(raycaster.intersectObjects([...rootMap.values()], true)[0]),
        moved: false,
        facePaintTarget: paintHit
          ? {
              objectId: paintHit.objectId,
              meshKey: paintHit.meshKey,
              triangles: paintHit.triangles
            }
          : undefined
      }
    }

    const handlePointerMove = (event: PointerEvent): void => {
      const quickTool = quickBuildToolRef.current
      const quickDraft = quickBuildDraftRef.current
      if (
        quickTool &&
        quickDraft?.kind === quickTool &&
        (event.buttons === 0 || event.buttons === 1)
      ) {
        if (event.buttons === 1) {
          event.preventDefault()
          event.stopImmediatePropagation()
        }
        const hit = quickBuildPoint(event)
        if (!hit) return
        const snapped = snapQuickBuildEnd(quickTool, quickDraft.start, vectorValue(hit))
        if (snapped.point.x !== quickDraft.end.x || snapped.point.z !== quickDraft.end.z) {
          emitQuickBuildDraft({ ...quickDraft, end: snapped.point })
        }
        canvas.dataset.quickBuildSnap = snapped.axisSnapped ? 'axis' : 'grid'
        if (quickBuildTransform({ ...quickDraft, end: snapped.point })) {
          onQuickBuildIssueRef.current(null)
        }
        return
      }
      const activeVertex = activeModelingVertexRef.current
      const draft = modelingDraftRef.current
      if (activeVertex?.pointerId === event.pointerId && draft) {
        event.preventDefault()
        event.stopImmediatePropagation()
        const distance = Math.hypot(
          event.clientX - activeVertex.startX,
          event.clientY - activeVertex.startY
        )
        if (distance <= 5 && !activeVertex.moved) return
        activeVertex.moved = true
        updateRay(event)
        let worldPoint: THREE.Vector3 | null
        if (event.altKey) {
          const distanceScale = Math.max(
            camera.position.distanceTo(activeVertex.startWorld) * 0.0025,
            0.01
          )
          worldPoint = activeVertex.startWorld
            .clone()
            .addScaledVector(
              camera.getWorldDirection(new THREE.Vector3()),
              (activeVertex.startY - event.clientY) * distanceScale
            )
        } else {
          worldPoint = raycaster.ray.intersectPlane(activeVertex.dragPlane, new THREE.Vector3())
          if (worldPoint) worldPoint.add(activeVertex.grabOffset)
        }
        if (!worldPoint) return
        if (event.shiftKey) worldPoint = snappedDraftWorldPoint(draft, worldPoint)

        const bounds = canvas.getBoundingClientRect()
        let mergeTarget: number | null = null
        draft.vertices.forEach((_, index) => {
          if (index === activeVertex.index) return
          const projected = draftVertexWorldPoint(draft, index).project(camera)
          const screenX = bounds.left + ((projected.x + 1) / 2) * bounds.width
          const screenY = bounds.top + ((1 - projected.y) / 2) * bounds.height
          if (Math.hypot(event.clientX - screenX, event.clientY - screenY) <= 14)
            mergeTarget = index
        })
        if (mergeTarget !== null) worldPoint = draftVertexWorldPoint(draft, mergeTarget)
        const nextDraft = moveModelingVertex(draft, activeVertex.index, worldPoint)
        activeVertex.lastDraft = nextDraft
        activeVertex.mergeTarget = mergeTarget
        const dragState =
          mergeTarget !== null
            ? 'merging'
            : event.altKey
              ? 'depth'
              : event.shiftKey
                ? 'snapped'
                : 'free'
        modelingDragIssueRef.current = null
        canvas.dataset.modelingDragState = dragState
        canvas.dataset.modelingLastDrag = dragState
        if (mergeTarget !== null) canvas.dataset.modelingMergeTarget = String(mergeTarget)
        else delete canvas.dataset.modelingMergeTarget
        delete canvas.dataset.modelingIssue
        onModelingDraftChangeRef.current(nextDraft, 'replace')
        onModelingIssueRef.current(null)
        return
      }

      const activeExtrusion = activeModelingExtrusionRef.current
      if (activeExtrusion?.pointerId === event.pointerId && draft) {
        event.preventDefault()
        event.stopImmediatePropagation()
        updateRay(event)
        const coordinate = coordinateOnAxis(
          raycaster.ray,
          activeExtrusion.axisCenter,
          activeExtrusion.axis
        )
        const distance = THREE.MathUtils.clamp(
          snapSketchValue(coordinate - activeExtrusion.startCoordinate),
          -100,
          100
        )
        if (Math.abs(distance) < 0.01) return
        try {
          const nextDraft = extrudeModelingFace(
            activeExtrusion.startDraft,
            activeExtrusion.faceIndex,
            distance
          )
          activeExtrusion.moved = true
          onModelingDraftChangeRef.current(nextDraft, 'replace')
          onModelingIssueRef.current(null)
        } catch (error) {
          onModelingIssueRef.current(
            error instanceof Error ? error.message : '这个面暂时无法拉伸。'
          )
        }
        return
      }

      if (draft) {
        updateRay(event)
        const previewLine = modelingPreviewLineRef.current
        const previewPoint = modelingPreviewPointRef.current
        const worldPoint = raycaster.ray.intersectPlane(
          modelingPlacementPlane(draft),
          new THREE.Vector3()
        )
        const mode = modelingElementModeRef.current
        let originPoint: THREE.Vector3 | null = null
        if (mode === 'vertex' && draft.faces.length === 0 && draft.vertices.length > 0) {
          originPoint = draftVertexWorldPoint(draft, draft.vertices.length - 1)
        } else if (mode === 'edge' && draft.pendingEdgeVertex !== null) {
          originPoint = draftVertexWorldPoint(draft, draft.pendingEdgeVertex)
        }
        if (worldPoint && (mode === 'vertex' || mode === 'edge')) {
          const candidate = snappedDraftWorldPoint(draft, worldPoint)
          const resolved = originPoint
            ? perpendicularModelingPoint(draft, originPoint, candidate)
            : { point: candidate, perpendicular: false }
          modelingPointerPreviewRef.current = {
            point: resolved.point,
            perpendicular: resolved.perpendicular
          }
          if (previewPoint) {
            previewPoint.visible = mode === 'vertex'
            previewPoint.position.copy(resolved.point)
            const material = previewPoint.material as THREE.MeshBasicMaterial
            material.color.set(resolved.perpendicular ? '#ff2d95' : '#ffffff')
          }
          if (previewLine) {
            previewLine.visible = Boolean(originPoint)
            if (originPoint) {
              previewLine.geometry.setFromPoints([originPoint, resolved.point])
            }
            const material = previewLine.material as THREE.LineBasicMaterial
            material.color.set(resolved.perpendicular ? '#ff2d95' : '#27d7b0')
          }
          canvas.dataset.modelingPreview = resolved.perpendicular ? 'perpendicular' : 'free'
          canvas.dataset.modelingPreviewPoint = JSON.stringify(vectorValue(resolved.point))
        } else {
          modelingPointerPreviewRef.current = null
          if (previewPoint) previewPoint.visible = false
          if (previewLine) previewLine.visible = false
          delete canvas.dataset.modelingPreview
          delete canvas.dataset.modelingPreviewPoint
        }
        return
      }

      const marquee = marqueeGestureRef.current
      if (marquee?.pointerId === event.pointerId) {
        event.preventDefault()
        event.stopImmediatePropagation()
        marquee.currentX = event.clientX
        marquee.currentY = event.clientY
        const distance = Math.hypot(event.clientX - marquee.startX, event.clientY - marquee.startY)
        if (distance > 5) marquee.moved = true
        if (marquee.moved) {
          canvas.dataset.marqueePhase = 'move'
          const bounds = canvas.getBoundingClientRect()
          setMarqueeRect({
            left: Math.min(marquee.startX, marquee.currentX) - bounds.left,
            top: Math.min(marquee.startY, marquee.currentY) - bounds.top,
            width: Math.abs(marquee.currentX - marquee.startX),
            height: Math.abs(marquee.currentY - marquee.startY)
          })
        }
        return
      }

      const activeStretch = activeStretchRef.current
      if (activeStretch?.pointerId === event.pointerId) {
        event.preventDefault()
        event.stopImmediatePropagation()
        updateRay(event)
        const coordinate = coordinateOnAxis(
          raycaster.ray,
          activeStretch.axisCenter,
          activeStretch.worldAxis
        )
        const stretch = calculateStretch({
          position: activeStretch.initialPosition,
          size: activeStretch.initialSize,
          axis: activeStretch.axis,
          sign: activeStretch.sign,
          delta: coordinate - activeStretch.startCoordinate,
          worldAxis: vectorValue(activeStretch.worldAxis)
        })
        activeStretch.root.position.set(stretch.position.x, stretch.position.y, stretch.position.z)
        activeStretch.root.scale.set(stretch.size.x, stretch.size.y, stretch.size.z)
        updateSelectionBounds()
        updateStretchHandles()
        return
      }

      const clickGesture = clickGestureRef.current
      if (clickGesture?.pointerId === event.pointerId) {
        const distance = Math.hypot(
          event.clientX - clickGesture.startX,
          event.clientY - clickGesture.startY
        )
        if (distance > 5) {
          clickGesture.moved = true
          clearFacePaintPreview()
        }
      } else if (event.buttons === 0) {
        updateFacePaintPreview(event)
      }
    }

    const handlePointerUp = (event: PointerEvent): void => {
      const activeModelingVertex = activeModelingVertexRef.current
      if (activeModelingVertex?.pointerId === event.pointerId) {
        activeModelingVertexRef.current = null
        delete canvas.dataset.modelingDragState
        delete canvas.dataset.modelingMergeTarget
        controls.enabled = true
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
        if (activeModelingVertex.moved && activeModelingVertex.mergeTarget !== null) {
          onModelingDraftChangeRef.current(
            mergeModelingVertices(
              activeModelingVertex.lastDraft,
              activeModelingVertex.index,
              activeModelingVertex.mergeTarget
            ),
            'replace'
          )
        }
        return
      }
      if (activeModelingExtrusionRef.current?.pointerId === event.pointerId) {
        activeModelingExtrusionRef.current = null
        controls.enabled = true
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
        return
      }

      const marquee = marqueeGestureRef.current
      if (marquee?.pointerId === event.pointerId) {
        event.preventDefault()
        event.stopImmediatePropagation()
        marqueeGestureRef.current = null
        setMarqueeRect(null)
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
        if (marquee.moved) {
          const bounds = canvas.getBoundingClientRect()
          const selectionRect = {
            left: Math.min(marquee.startX, marquee.currentX) - bounds.left,
            top: Math.min(marquee.startY, marquee.currentY) - bounds.top,
            width: Math.abs(marquee.currentX - marquee.startX),
            height: Math.abs(marquee.currentY - marquee.startY)
          }
          const ids = [...rootMap.entries()].flatMap(([id, root]) => {
            if (!root.visible) return []
            const objectRect = screenRectForObject(root, camera, bounds)
            return objectRect && rectanglesOverlap(selectionRect, objectRect) ? [id] : []
          })
          canvas.dataset.marqueePhase = 'up'
          canvas.dataset.marqueeSelectionCount = String(ids.length)
          onSelectionChangeRef.current(ids)
        } else {
          canvas.dataset.marqueePhase = 'context'
          const preserveSelection =
            marquee.objectId && selectedIdsRef.current.includes(marquee.objectId)
          if (marquee.objectId && !preserveSelection) {
            onSelectionChangeRef.current([marquee.objectId])
          }
          onObjectContextMenuRef.current(marquee.objectId, event.clientX, event.clientY)
        }
        return
      }

      const activeStretch = activeStretchRef.current
      if (activeStretch?.pointerId === event.pointerId) {
        event.preventDefault()
        event.stopImmediatePropagation()
        controls.enabled = true
        activeStretchRef.current = null
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
        onTransformManyRef.current([
          { id: activeStretch.objectId, ...objectTransform(activeStretch.root) }
        ])
        return
      }

      const clickGesture = clickGestureRef.current
      if (clickGesture?.pointerId === event.pointerId) {
        if (!clickGesture.moved) {
          if (clickGesture.facePaintTarget) {
            const target = clickGesture.facePaintTarget
            onFacePaintRef.current(
              target.objectId,
              target.meshKey,
              target.triangles,
              facePaintColorRef.current
            )
          } else {
            onSelectionChangeRef.current(clickGesture.objectId ? [clickGesture.objectId] : [])
          }
        }
        clickGestureRef.current = null
      }
    }

    const preventContextMenu = (event: MouseEvent): void => event.preventDefault()
    const handlePointerLeave = (): void => clearFacePaintPreview()
    canvas.addEventListener('pointerdown', handlePointerDown, true)
    canvas.addEventListener('pointermove', handlePointerMove, true)
    canvas.addEventListener('pointerup', handlePointerUp, true)
    canvas.addEventListener('pointercancel', handlePointerUp, true)
    canvas.addEventListener('pointerleave', handlePointerLeave, true)
    canvas.addEventListener('contextmenu', preventContextMenu, true)

    const resize = (): void => {
      const { width, height } = canvas.getBoundingClientRect()
      const nextWidth = Math.max(Math.round(width), 1)
      const nextHeight = Math.max(Math.round(height), 1)
      renderer.setSize(nextWidth, nextHeight, false)
      camera.aspect = nextWidth / nextHeight
      camera.updateProjectionMatrix()
    }
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(canvas)
    resize()

    let animationFrame = 0
    let cameraMonitorFrames = 0
    const render = (): void => {
      controls.update()
      const gridX = Math.round(controls.target.x / 20) * 20
      const gridZ = Math.round(controls.target.z / 20) * 20
      ground.position.set(gridX, 0, gridZ)
      grid.position.set(gridX, 0.008, gridZ)
      updateSelectionBounds()
      updateStretchHandles()
      updateMannequinHandles()
      for (const helper of lightGroup.children) {
        if ('update' in helper && typeof helper.update === 'function') helper.update()
      }
      const preview = cameraPreviewRef.current
      const monitor = cameraMonitorRef.current
      const firstPerson = firstPersonCameraControlRef.current
      const sceneCamera = sceneCameraRef.current
      const cameraHelper = cameraHelperRef.current
      if (cameraHelper) cameraHelper.visible = !preview && !firstPerson
      if (preview && sceneCamera) {
        const size = renderer.getSize(new THREE.Vector2())
        const ratio = sceneCamera.aspect
        const maxWidth = size.x * 0.84
        const maxHeight = size.y * 0.84
        const width = Math.min(maxWidth, maxHeight * ratio)
        const height = width / ratio
        const left = (size.x - width) / 2
        const bottom = (size.y - height) / 2
        renderer.setScissorTest(false)
        renderer.setClearColor('#111416', 1)
        renderer.clear()
        renderer.setViewport(left, bottom, width, height)
        renderer.setScissor(left, bottom, width, height)
        renderer.setScissorTest(true)
        captureWithoutGuides(() => renderer.render(scene, sceneCamera))
        renderer.setScissorTest(false)
        renderer.setViewport(0, 0, size.x, size.y)
        delete canvas.dataset.firstPersonView
        delete canvas.dataset.firstPersonFrame
      } else {
        if (firstPerson) canvas.dataset.firstPersonView = 'editor-camera-synced'
        else delete canvas.dataset.firstPersonView
        delete canvas.dataset.firstPersonFrame
        renderer.render(scene, camera)
      }
      const monitorBounds = cameraMonitorBoundsRef.current
      if (!preview && monitor && sceneCamera && monitorBounds) {
        renderer.setViewport(
          monitorBounds.left,
          monitorBounds.bottom,
          monitorBounds.width,
          monitorBounds.height
        )
        renderer.setScissor(
          monitorBounds.left,
          monitorBounds.bottom,
          monitorBounds.width,
          monitorBounds.height
        )
        renderer.setScissorTest(true)
        captureWithoutGuides(() => renderer.render(scene, sceneCamera))
        renderer.setScissorTest(false)
        const size = renderer.getSize(new THREE.Vector2())
        renderer.setViewport(0, 0, size.x, size.y)
        cameraMonitorFrames += 1
        canvas.dataset.cameraMonitorFrames = String(cameraMonitorFrames)
      }
      canvas.dataset.sceneReady = 'true'
      animationFrame = window.requestAnimationFrame(render)
    }
    render()

    return () => {
      objectBuildVersionRef.current += 1
      window.cancelAnimationFrame(animationFrame)
      resizeObserver.disconnect()
      canvas.removeEventListener('pointerdown', handlePointerDown, true)
      canvas.removeEventListener('pointermove', handlePointerMove, true)
      canvas.removeEventListener('pointerup', handlePointerUp, true)
      canvas.removeEventListener('pointercancel', handlePointerUp, true)
      canvas.removeEventListener('pointerleave', handlePointerLeave, true)
      canvas.removeEventListener('contextmenu', preventContextMenu, true)
      if (cameraChangeTimer !== undefined) window.clearTimeout(cameraChangeTimer)
      controls.removeEventListener('change', scheduleCameraChange)
      controls.removeEventListener('end', scheduleCameraChange)
      controls.dispose()
      transformControls.dispose()
      ground.geometry.dispose()
      groundMaterial.dispose()
      grid.geometry.dispose()
      gridMaterial.dispose()
      clearGroup(objectGroup)
      clearGroup(userLightGroup)
      clearGroup(lightGroup)
      clearGroup(modelingGroup)
      clearGroup(cameraHelper)
      clearGroup(cameraTargetHelper)
      disposeObject(originMarker)
      disposeObject(stretchGroup)
      disposeObject(facePaintPreview)
      disposeObject(quickBuildPreview)
      renderer.dispose()
      scene.clear()
      rootMap.clear()
      lightRootMap.clear()
      importedCameraMap.clear()
      sceneRef.current = null
      objectGroupRef.current = null
      userLightGroupRef.current = null
      lightGroupRef.current = null
      modelingGroupRef.current = null
      modelingVertexGroupRef.current = null
      modelingEdgeGroupRef.current = null
      modelingFaceRef.current = null
      modelingSurfaceGroupRef.current = null
      modelingExtrudeHandleRef.current = null
      modelingPreviewLineRef.current = null
      modelingPreviewPointRef.current = null
      modelingPointerPreviewRef.current = null
      quickBuildPreviewRef.current = null
      cutPreviewGroupRef.current = null
      stretchGroupRef.current = null
      originMarkerRef.current = null
      groundRef.current = null
      cameraRef.current = null
      sceneCameraRef.current = null
      cameraHelperRef.current = null
      cameraTargetHelperRef.current = null
      rendererRef.current = null
      controlsRef.current = null
      transformControlsRef.current = null
      transformHelperRef.current = null
      transformPivotRef.current = null
      gridRef.current = null
      selectionHelperRef.current = null
      hemisphereRef.current = null
      sceneFillRef.current = null
      delete canvas.dataset.sceneReady
      delete canvas.dataset.originMarker
      delete canvas.dataset.cameraControls
      delete canvas.dataset.stretchHandles
      delete canvas.dataset.gridMode
      delete canvas.dataset.gridTriangles
      delete canvas.dataset.cameraPosition
      delete canvas.dataset.cameraTarget
      delete canvas.dataset.focusScope
      delete canvas.dataset.focusObject
      delete canvas.dataset.modelingMode
      delete canvas.dataset.modelingPointCount
      delete canvas.dataset.quickBuildTool
      delete canvas.dataset.quickBuildPhase
      delete canvas.dataset.quickBuildSnap
      delete canvas.dataset.quickBuildLastKind
      delete canvas.dataset.modelingClosed
      delete canvas.dataset.modelingExtrusion
      delete canvas.dataset.modelingSelectedEdge
      delete canvas.dataset.modelingSelectedEdges
      delete canvas.dataset.modelingPoints
      delete canvas.dataset.modelingTopPoints
      delete canvas.dataset.modelingPlaneMode
      delete canvas.dataset.modelingFaceSelected
      delete canvas.dataset.modelingPreview
      delete canvas.dataset.modelingPreviewPoint
      delete canvas.dataset.modelingActiveFace
      delete canvas.dataset.cameraFrame
      delete canvas.dataset.cameraPreview
      delete canvas.dataset.cameraMonitor
      delete canvas.dataset.cameraMonitorFrames
      delete canvas.dataset.firstPersonView
      delete canvas.dataset.firstPersonFrame
      delete canvas.dataset.outputCameraPosition
      delete canvas.dataset.outputCameraTarget
      delete canvas.dataset.outputCameraFov
      delete canvas.dataset.cameraFov
      delete canvas.dataset.cutPreview
      delete canvas.dataset.userLightCount
      delete canvas.dataset.lightGuideTone
      delete canvas.dataset.cameraGuideTone
      delete canvas.dataset.surfacePick
      delete canvas.dataset.surfacePickHit
      delete canvas.dataset.facePaint
      delete canvas.dataset.facePaintSurfaceSize
      delete canvas.dataset.paintedFaceCount
      delete canvas.dataset.wholeColorCount
      delete canvas.dataset.animatedObjectCount
      delete canvas.dataset.selectedAnimationTransform
      delete canvas.dataset.mannequinJointCount
      delete canvas.dataset.mannequinLastJoint
      delete canvas.dataset.mannequinPose
      delete canvas.dataset.mannequinVisual
    }
  }, [captureWithoutGuides, emitCameraState, theme, updateSelectionBounds])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.dataset.surfacePick = String(Boolean(surfacePickObjectId))
    if (surfacePickObjectId) delete canvas.dataset.surfacePickHit
  }, [surfacePickObjectId, theme])

  useEffect(() => {
    const canvas = canvasRef.current
    const preview = facePaintPreviewRef.current
    if (!canvas) return
    canvas.dataset.facePaint = String(Boolean(facePaintObjectId))
    canvas.style.cursor = facePaintObjectId ? 'crosshair' : ''
    if (preview && !facePaintObjectId && preview.visible) {
      preview.visible = false
      preview.geometry.dispose()
      preview.geometry = new THREE.BufferGeometry()
      delete canvas.dataset.facePaintSurfaceSize
    }
  }, [facePaintObjectId, facePaintColor, theme])

  useEffect(() => {
    const group = objectGroupRef.current
    const renderer = rendererRef.current
    const canvas = canvasRef.current
    if (!group || !renderer) return
    const buildVersion = objectBuildVersionRef.current + 1
    objectBuildVersionRef.current = buildVersion
    clearGroup(group)
    rootMapRef.current.clear()
    importedCameraMapRef.current.clear()
    if (canvas) {
      canvas.dataset.paintedFaceCount = String(
        objects.reduce((count, object) => count + Object.keys(object.faceColors ?? {}).length, 0)
      )
      canvas.dataset.wholeColorCount = String(
        objects.filter((object) => Boolean(object.colorOverride)).length
      )
    }

    for (const object of objects) {
      const root = new THREE.Group()
      root.name = object.name
      root.userData.exportReady = object.kind !== 'imported' && object.kind !== 'mannequin'
      applyObjectTransform(root, object)
      rootMapRef.current.set(object.id, root)
      group.add(root)

      if (object.kind === 'mannequin' && object.mannequin) {
        const material = createObjectMaterial(object)
        const rig = createMannequinRig(material)
        material.dispose()
        root.userData.mannequinJoints = rig.joints
        root.userData.mannequinHandles = rig.handles
        rig.root.traverse((child) => {
          child.userData.objectId = object.id
          if (child instanceof THREE.Mesh) {
            child.castShadow = true
            child.receiveShadow = true
          }
        })
        root.add(rig.root)
        applyMannequinPose(
          root,
          object.mannequin.pose,
          mannequinVisualState(object, undefined, mannequinActionTimeRef.current)
        )
        const visualMaterial = createObjectMaterial(object)
        void createMannequinVisual(visualMaterial)
          .then((visual) => {
            if (
              objectBuildVersionRef.current !== buildVersion ||
              rootMapRef.current.get(object.id) !== root
            ) {
              disposeObject(visual.root)
              return
            }
            Object.defineProperty(root.userData, 'mannequinVisual', {
              configurable: true,
              value: visual,
              writable: true
            })
            visual.root.traverse((child) => {
              child.userData.objectId = object.id
            })
            root.add(visual.root)
            applyMannequinPose(
              root,
              object.mannequin!.pose,
              mannequinVisualState(object, undefined, mannequinActionTimeRef.current)
            )
            const controlMeshes: THREE.Mesh[] = []
            rig.root.traverse((child) => {
              if (child instanceof THREE.Mesh) controlMeshes.push(child)
            })
            for (const mesh of controlMeshes) {
              mesh.removeFromParent()
              disposeObject(mesh)
            }
            root.userData.exportReady = true
            if (canvas) {
              canvas.dataset.mannequinVisual = 'quaternius-cc0'
              canvas.dataset.mannequinActions = 'quaternius-ual1-standard-cc0'
              canvas.dataset.mannequinActionClip = String(
                visual.root.userData.mannequinActionClip ?? ''
              )
              canvas.dataset.mannequinActionTime = String(
                visual.root.userData.mannequinActionTime ?? mannequinActionTimeRef.current
              )
              canvas.dataset.mannequinActionSample = String(
                visual.root.userData.mannequinActionSample ?? ''
              )
            }
            updateSelectionBounds()
          })
          .catch((error: unknown) => {
            if (
              objectBuildVersionRef.current !== buildVersion ||
              rootMapRef.current.get(object.id) !== root
            ) {
              return
            }
            root.userData.exportReady = true
            if (canvas) canvas.dataset.mannequinVisual = 'procedural-fallback'
            console.warn('新版人台外观加载失败，已保留基础人台。', error)
          })
          .finally(() => visualMaterial.dispose())
      } else if (object.kind === 'imported' && object.importedAsset) {
        const importedAsset = object.importedAsset
        const placeholder = new THREE.Mesh(
          new THREE.BoxGeometry(1, 1, 1),
          createObjectMaterial(object)
        )
        placeholder.castShadow = true
        placeholder.receiveShadow = true
        root.add(placeholder)
        void loadImportedAsset(importedAsset, renderer)
          .then((imported) => {
            if (
              objectBuildVersionRef.current !== buildVersion ||
              rootMapRef.current.get(object.id) !== root
            ) {
              disposeObject(imported.root)
              return
            }
            root.remove(placeholder)
            disposeObject(placeholder)
            const normalized = normalizeImportedRoot(imported.root)
            const cameras: THREE.Camera[] = []
            let paintMeshIndex = 0
            normalized.traverse((child) => {
              child.userData.objectId = object.id
              if (child instanceof THREE.Mesh) {
                const meshKey = String(paintMeshIndex)
                paintMeshIndex += 1
                child.userData.paintMeshKey = meshKey
                child.castShadow = true
                child.receiveShadow = true
                if (!child.geometry.getAttribute('normal')) child.geometry.computeVertexNormals()
                applyPaintToMesh(child, object, meshKey, true)
              }
              if (child instanceof THREE.Light) child.visible = object.useImportedLights === true
              if (child instanceof THREE.Camera) cameras.push(child)
            })
            markImportedVariant(normalized, 'original')
            root.add(normalized)
            const needsLightweight =
              object.previewQuality === 'lightweight' || object.exportQuality === 'lightweight'
            if (needsLightweight) {
              const targetRatio = importedAsset.report.triangleCount >= 800_000 ? 0.2 : 0.4
              const lightweight = createLightweightPreview(normalized, targetRatio)
              if (lightweight.report.simplifiedMeshes > 0) {
                markImportedVariant(lightweight.root, 'lightweight')
                root.add(lightweight.root)
              }
              onOptimizationReportRef.current?.(object.id, lightweight.report)
            }
            setImportedVariantVisibility(root, object.previewQuality ?? 'original')
            root.userData.exportReady = true
            importedCameraMapRef.current.set(object.id, cameras)
            root.updateMatrixWorld(true)
            updateSelectionBounds()
          })
          .catch((error: unknown) => {
            const message = error instanceof Error ? error.message : '导入模型无法显示。'
            onImportErrorRef.current?.(object.id, message)
          })
      } else {
        const mesh = new THREE.Mesh(createGeometry(object), createObjectMaterial(object))
        mesh.userData.objectId = object.id
        mesh.userData.paintMeshKey = '0'
        applyPaintToMesh(mesh, object, '0')
        mesh.castShadow = true
        mesh.receiveShadow = true
        root.add(mesh)
      }
    }
  }, [objects, theme, updateSelectionBounds])

  useEffect(() => {
    const canvas = canvasRef.current
    for (const object of objects) {
      const root = rootMapRef.current.get(object.id)
      if (!root) continue
      const preview = objectTransformPreview?.get(object.id)
      applyObjectTransform(root, preview ? { ...object, ...preview } : object)
      if (object.kind === 'mannequin' && object.mannequin) {
        applyMannequinPose(
          root,
          preview?.mannequinPose ?? object.mannequin.pose,
          mannequinVisualState(object, preview, mannequinActionTimeSeconds)
        )
      }
    }
    updateSelectionBounds()
    if (canvas) {
      canvas.dataset.animatedObjectCount = String(objectTransformPreview?.size ?? 0)
      const selectedPreview =
        selectedIds.length === 1 ? objectTransformPreview?.get(selectedIds[0]) : null
      if (selectedPreview) {
        canvas.dataset.selectedAnimationTransform = JSON.stringify(selectedPreview)
      } else {
        delete canvas.dataset.selectedAnimationTransform
      }
      const actionObject =
        objects.find((object) => object.kind === 'mannequin' && selectedIds.includes(object.id)) ??
        objects.find((object) => object.kind === 'mannequin')
      const actionRoot = actionObject ? rootMapRef.current.get(actionObject.id) : undefined
      const visual = actionRoot?.userData.mannequinVisual as MannequinVisualRig | undefined
      const clip = visual?.root.userData.mannequinActionClip
      if (typeof clip === 'string') {
        canvas.dataset.mannequinActionClip = clip
        canvas.dataset.mannequinActionTime = String(
          visual?.root.userData.mannequinActionTime ?? mannequinActionTimeSeconds
        )
        canvas.dataset.mannequinActionSample = String(
          visual?.root.userData.mannequinActionSample ?? ''
        )
      } else {
        delete canvas.dataset.mannequinActionClip
        delete canvas.dataset.mannequinActionTime
        delete canvas.dataset.mannequinActionSample
      }
    }
  }, [
    mannequinActionTimeSeconds,
    objectTransformPreview,
    objects,
    selectedIds,
    theme,
    updateSelectionBounds
  ])

  useEffect(() => {
    const userGroup = userLightGroupRef.current
    const guideGroup = lightGroupRef.current
    if (!userGroup || !guideGroup) return
    clearGroup(userGroup)
    clearGroup(guideGroup)
    lightRootMapRef.current.clear()

    lighting.lights.forEach((data, index) => {
      const color = new THREE.Color(data.color)
      const guideColor = new THREE.Color(
        selectedLightId === data.id ? '#ffb020' : theme === 'dark' ? '#f3f6f5' : '#111820'
      )
      const target = new THREE.Object3D()
      target.position.set(data.target.x, data.target.y, data.target.z)
      target.visible = data.visible
      userGroup.add(target)

      let light: THREE.Light
      let helper: THREE.Object3D
      if (data.kind === 'point') {
        const point = new THREE.PointLight(color, data.intensity, 0, 2)
        point.decay = 2
        point.castShadow = index < 2
        point.shadow.mapSize.set(1024, 1024)
        light = point
        helper = new THREE.PointLightHelper(point, Math.max(data.size, 0.24), guideColor)
      } else if (data.kind === 'spot') {
        const spot = new THREE.SpotLight(
          color,
          data.intensity,
          0,
          THREE.MathUtils.degToRad(data.angleDegrees),
          0.28,
          2
        )
        spot.target = target
        spot.castShadow = index < 2
        spot.shadow.mapSize.set(1024, 1024)
        spot.shadow.bias = -0.00035
        light = spot
        helper = new THREE.SpotLightHelper(spot, guideColor)
      } else if (data.kind === 'sun') {
        const sun = new THREE.DirectionalLight(color, data.intensity)
        sun.target = target
        sun.castShadow = index < 2
        sun.shadow.mapSize.set(1024, 1024)
        sun.shadow.camera.left = -12
        sun.shadow.camera.right = 12
        sun.shadow.camera.top = 12
        sun.shadow.camera.bottom = -12
        sun.shadow.camera.near = 0.1
        sun.shadow.camera.far = 60
        sun.shadow.bias = -0.00035
        light = sun
        helper = new THREE.DirectionalLightHelper(sun, 1.2, guideColor)
      } else {
        const area = new THREE.RectAreaLight(
          color,
          data.intensity,
          Math.max(data.size, 0.1),
          Math.max(data.size, 0.1)
        )
        light = area
        const plane = new THREE.PlaneGeometry(data.size, data.size)
        const outline = new THREE.LineSegments(
          new THREE.EdgesGeometry(plane),
          new THREE.LineBasicMaterial({ color: guideColor })
        )
        plane.dispose()
        helper = outline
      }

      light.name = data.name
      light.position.set(data.position.x, data.position.y, data.position.z)
      light.visible = data.visible
      light.userData.lightId = data.id
      if (light instanceof THREE.RectAreaLight) {
        light.lookAt(data.target.x, data.target.y, data.target.z)
      }
      userGroup.add(light)
      lightRootMapRef.current.set(data.id, light)

      helper.visible = data.visible
      helper.position.copy(light.position)
      if (data.kind === 'area') {
        helper.lookAt(data.target.x, data.target.y, data.target.z)
      }
      helper.userData.lightId = data.id
      helper.traverse((child) => {
        if (!(child instanceof THREE.Line || child instanceof THREE.Mesh)) return
        const materials = Array.isArray(child.material) ? child.material : [child.material]
        for (const material of materials) {
          material.transparent = true
          material.opacity = selectedLightId === data.id ? 0.95 : theme === 'dark' ? 0.64 : 0.76
          material.depthTest = false
        }
      })
      helper.renderOrder = 840
      guideGroup.add(helper)
    })

    const canvas = canvasRef.current
    if (canvas) {
      canvas.dataset.userLightCount = String(lighting.lights.length)
      canvas.dataset.lightGuideTone = theme === 'dark' ? 'light' : 'dark'
    }
  }, [lighting, selectedLightId, theme])

  useEffect(() => {
    const preview = quickBuildPreviewRef.current
    const canvas = canvasRef.current
    if (!preview || !canvas) return
    canvas.style.cursor = quickBuildTool ? 'crosshair' : ''
    if (!quickBuildTool) {
      preview.visible = false
      delete canvas.dataset.quickBuildTool
      delete canvas.dataset.quickBuildPhase
      delete canvas.dataset.quickBuildSnap
      return
    }
    canvas.dataset.quickBuildTool = quickBuildTool
    canvas.dataset.quickBuildPhase = quickBuildDraft ? 'drawing' : 'ready'
    const transform = quickBuildDraft ? quickBuildTransform(quickBuildDraft) : null
    if (!transform) {
      preview.visible = false
      return
    }
    preview.visible = true
    preview.position.set(transform.position.x, transform.position.y, transform.position.z)
    preview.rotation.set(
      THREE.MathUtils.degToRad(transform.rotation.x),
      THREE.MathUtils.degToRad(transform.rotation.y),
      THREE.MathUtils.degToRad(transform.rotation.z)
    )
    preview.scale.set(transform.size.x, transform.size.y, transform.size.z)
    preview.updateMatrixWorld(true)
  }, [quickBuildDraft, quickBuildTool, theme])

  useEffect(() => {
    const previous = cutPreviewGroupRef.current
    if (previous) {
      previous.removeFromParent()
      disposeObject(previous)
      cutPreviewGroupRef.current = null
    }
    const canvas = canvasRef.current
    if (!cutPreview) {
      if (canvas) delete canvas.dataset.cutPreview
      return
    }
    const root = rootMapRef.current.get(cutPreview.objectId)
    const object = objects.find((item) => item.id === cutPreview.objectId)
    if (!root || !object || object.kind === 'imported') return
    const bounds = objectLocalBounds(object)
    const size = bounds.getSize(new THREE.Vector3())
    const group = new THREE.Group()
    const axis = localAxisVector(cutPreview.axis)
    group.position.copy(axis.clone().multiplyScalar(cutPreview.offset))
    let width = Math.max(size.x, 0.2) * 1.25
    let height = Math.max(size.y, 0.2) * 1.25
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        color: '#ff2d95',
        transparent: true,
        opacity: 0.2,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    )
    if (cutPreview.axis === 'x') {
      width = Math.max(size.z, 0.2) * 1.25
      height = Math.max(size.y, 0.2) * 1.25
      plane.rotation.y = Math.PI / 2
    } else if (cutPreview.axis === 'y') {
      width = Math.max(size.x, 0.2) * 1.25
      height = Math.max(size.z, 0.2) * 1.25
      plane.rotation.x = -Math.PI / 2
    }
    plane.scale.set(width, height, 1)
    plane.renderOrder = 1400
    group.add(plane)
    const arrowLength = Math.max(size.x, size.y, size.z, 0.5) * 0.42
    const arrow = new THREE.ArrowHelper(axis, new THREE.Vector3(), arrowLength, 0xff2d95)
    arrow.traverse((child) => {
      if (!(child instanceof THREE.Line || child instanceof THREE.Mesh)) return
      const materials = Array.isArray(child.material) ? child.material : [child.material]
      for (const material of materials) material.depthTest = false
      child.renderOrder = 1410
    })
    group.add(arrow)
    root.add(group)
    cutPreviewGroupRef.current = group
    if (canvas) canvas.dataset.cutPreview = `${cutPreview.axis}:${cutPreview.offset.toFixed(3)}`
  }, [cutPreview, objects, theme])

  useEffect(() => {
    const group = modelingGroupRef.current
    const canvas = canvasRef.current
    if (!group || !canvas) return
    for (const object of objects) {
      const root = rootMapRef.current.get(object.id)
      if (root) root.visible = object.visible && object.id !== modelingDraft?.objectId
    }
    clearGroup(group)
    modelingVertexGroupRef.current = null
    modelingEdgeGroupRef.current = null
    modelingFaceRef.current = null
    modelingSurfaceGroupRef.current = null
    modelingExtrudeHandleRef.current = null
    modelingPreviewLineRef.current = null
    modelingPreviewPointRef.current = null
    modelingPointerPreviewRef.current = null

    if (!modelingDraft) {
      delete canvas.dataset.modelingMode
      delete canvas.dataset.modelingPointCount
      delete canvas.dataset.modelingClosed
      delete canvas.dataset.modelingExtrusion
      delete canvas.dataset.modelingSelectedEdge
      delete canvas.dataset.modelingSelectedEdges
      delete canvas.dataset.modelingPoints
      delete canvas.dataset.modelingTopPoints
      delete canvas.dataset.modelingVertices
      delete canvas.dataset.modelingEdges
      delete canvas.dataset.modelingFaces
      delete canvas.dataset.modelingSelectedFace
      delete canvas.dataset.modelingPlaneMode
      delete canvas.dataset.modelingFaceSelected
      delete canvas.dataset.modelingPreview
      delete canvas.dataset.modelingPreviewPoint
      delete canvas.dataset.modelingActiveFace
      delete canvas.dataset.modelingPlane
      delete canvas.dataset.modelingGeometryState
      delete canvas.dataset.modelingGeometryIssue
      delete canvas.dataset.modelingDragState
      delete canvas.dataset.modelingLastDrag
      delete canvas.dataset.modelingIssue
      return
    }

    const plane = modelingDraft.plane
    const normal = new THREE.Vector3(plane.normal.x, plane.normal.y, plane.normal.z).normalize()
    const origin = new THREE.Vector3(plane.origin.x, plane.origin.y, plane.origin.z)
    const planeGrid = new THREE.GridHelper(
      16,
      16,
      theme === 'dark' ? '#4fd0b9' : '#087c6b',
      theme === 'dark' ? '#344746' : '#b7ceca'
    )
    planeGrid.position.copy(origin)
    planeGrid.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal)
    const gridMaterials = Array.isArray(planeGrid.material)
      ? planeGrid.material
      : [planeGrid.material]
    for (const material of gridMaterials) {
      material.transparent = true
      material.opacity = 0.24
      material.depthWrite = false
    }
    group.add(planeGrid)

    const edgeGroup = new THREE.Group()
    const vertexGroup = new THREE.Group()
    group.add(edgeGroup, vertexGroup)
    modelingEdgeGroupRef.current = edgeGroup
    modelingVertexGroupRef.current = vertexGroup

    const previewLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([origin, origin]),
      new THREE.LineBasicMaterial({ color: '#27d7b0', depthTest: false })
    )
    previewLine.visible = false
    previewLine.renderOrder = 1250
    group.add(previewLine)
    modelingPreviewLineRef.current = previewLine
    const previewPoint = new THREE.Mesh(
      new THREE.SphereGeometry(0.095, 16, 10),
      new THREE.MeshBasicMaterial({ color: '#ffffff', depthTest: false })
    )
    previewPoint.visible = false
    previewPoint.renderOrder = 1260
    group.add(previewPoint)
    modelingPreviewPointRef.current = previewPoint

    modelingDraft.edges.forEach(([firstIndex, secondIndex], index) => {
      if (!modelingDraft.vertices[firstIndex] || !modelingDraft.vertices[secondIndex]) return
      const start = draftVertexWorldPoint(modelingDraft, firstIndex)
      const end = draftVertexWorldPoint(modelingDraft, secondIndex)
      const geometry = new THREE.BufferGeometry().setFromPoints([start, end])
      const selected =
        modelingDraft.selectedEdge === index || modelingDraft.selectedEdges.includes(index)
      const edge = new THREE.Line(
        geometry,
        new THREE.LineBasicMaterial({
          color: selected ? '#ffb020' : theme === 'dark' ? '#67e3ca' : '#087c6b',
          depthTest: false,
          transparent: true,
          opacity: selected ? 1 : 0.9
        })
      )
      edge.userData.modelingEdgeIndex = index
      edge.renderOrder = 1100
      edgeGroup.add(edge)
    })

    modelingDraft.vertices.forEach((_, index) => {
      const selected = modelingDraft.selectedVertex === index
      const handle = new THREE.Mesh(
        new THREE.SphereGeometry(selected ? 0.13 : 0.1, 18, 12),
        new THREE.MeshBasicMaterial({
          color: selected ? '#ffb020' : '#ffffff',
          depthTest: false
        })
      )
      handle.position.copy(draftVertexWorldPoint(modelingDraft, index))
      handle.userData.modelingVertexIndex = index
      handle.renderOrder = 1200
      vertexGroup.add(handle)
    })

    if (modelingDraft.faces.length > 0) {
      const mesh = draftMesh(modelingDraft)
      let previewIssue: string | null = null
      try {
        const face = new THREE.Mesh(
          createCustomMeshGeometry(mesh),
          new THREE.MeshStandardMaterial({
            color: theme === 'dark' ? '#3f8f82' : '#a8d5cd',
            transparent: true,
            opacity: 0.62,
            roughness: 0.8,
            side: THREE.DoubleSide
          })
        )
        if (modelingDraft.objectTransform) {
          face.position.set(
            modelingDraft.objectTransform.position.x,
            modelingDraft.objectTransform.position.y,
            modelingDraft.objectTransform.position.z
          )
          face.rotation.set(
            THREE.MathUtils.degToRad(modelingDraft.objectTransform.rotation.x),
            THREE.MathUtils.degToRad(modelingDraft.objectTransform.rotation.y),
            THREE.MathUtils.degToRad(modelingDraft.objectTransform.rotation.z)
          )
          face.scale.set(
            modelingDraft.objectTransform.size.x,
            modelingDraft.objectTransform.size.y,
            modelingDraft.objectTransform.size.z
          )
        }
        face.userData.modelingFace = true
        face.renderOrder = 1000
        group.add(face)
        modelingFaceRef.current = face
      } catch (error) {
        previewIssue = error instanceof Error ? error.message : '模型预览暂时无效。'
      }
      canvas.dataset.modelingGeometryState = previewIssue ? 'invalid' : 'valid'
      if (previewIssue) canvas.dataset.modelingGeometryIssue = previewIssue
      else delete canvas.dataset.modelingGeometryIssue

      const surfaceGroup = new THREE.Group()
      if (!previewIssue) {
        modelingDraft.faces.forEach((faceVertices, faceIndex) => {
          let surfaceGeometry: THREE.BufferGeometry
          try {
            surfaceGeometry = createCustomMeshGeometry({ ...mesh, faces: [faceVertices] })
          } catch {
            return
          }
          const selected = modelingDraft.selectedFace === faceIndex
          const surfaceMesh = new THREE.Mesh(
            surfaceGeometry,
            new THREE.MeshBasicMaterial({
              color: selected ? '#ffb020' : theme === 'dark' ? '#67e3ca' : '#087c6b',
              transparent: true,
              opacity: selected ? 0.26 : 0.025,
              side: THREE.DoubleSide,
              depthWrite: false
            })
          )
          if (modelingDraft.objectTransform) {
            surfaceMesh.position.set(
              modelingDraft.objectTransform.position.x,
              modelingDraft.objectTransform.position.y,
              modelingDraft.objectTransform.position.z
            )
            surfaceMesh.rotation.set(
              THREE.MathUtils.degToRad(modelingDraft.objectTransform.rotation.x),
              THREE.MathUtils.degToRad(modelingDraft.objectTransform.rotation.y),
              THREE.MathUtils.degToRad(modelingDraft.objectTransform.rotation.z)
            )
            surfaceMesh.scale.set(
              modelingDraft.objectTransform.size.x,
              modelingDraft.objectTransform.size.y,
              modelingDraft.objectTransform.size.z
            )
          }
          surfaceMesh.userData.modelingFaceIndex = faceIndex
          surfaceMesh.renderOrder = 1080
          surfaceGroup.add(surfaceMesh)
        })
      }
      group.add(surfaceGroup)
      modelingSurfaceGroupRef.current = surfaceGroup

      if (!previewIssue && modelingDraft.selectedFace !== null) {
        const surfaceCenter = modelingFaceWorldCenter(modelingDraft, modelingDraft.selectedFace)
        const surfaceNormal = modelingFaceWorldNormal(modelingDraft, modelingDraft.selectedFace)
        const handle = new THREE.Mesh(
          new THREE.SphereGeometry(0.16, 20, 14),
          new THREE.MeshBasicMaterial({ color: '#ffb020', depthTest: false })
        )
        handle.position.copy(surfaceCenter.addScaledVector(surfaceNormal, 0.18))
        handle.userData.modelingExtrude = true
        handle.renderOrder = 1300
        group.add(handle)
        modelingExtrudeHandleRef.current = handle
      }
    } else {
      canvas.dataset.modelingGeometryState = 'outline'
      delete canvas.dataset.modelingGeometryIssue
    }

    canvas.dataset.modelingMode = modelingElementMode
    canvas.dataset.modelingPointCount = String(modelingDraft.vertices.length)
    canvas.dataset.modelingClosed = String(modelingDraft.faces.length > 0)
    canvas.dataset.modelingExtrusion = modelingDraft.extrusion.toFixed(2)
    canvas.dataset.modelingSelectedEdge = String(modelingDraft.selectedEdge ?? '')
    canvas.dataset.modelingSelectedEdges = JSON.stringify(modelingDraft.selectedEdges)
    canvas.dataset.modelingPoints = JSON.stringify(modelingDraft.vertices)
    canvas.dataset.modelingVertices = JSON.stringify(modelingDraft.vertices)
    canvas.dataset.modelingEdges = JSON.stringify(modelingDraft.edges)
    canvas.dataset.modelingFaces = JSON.stringify(modelingDraft.faces)
    canvas.dataset.modelingSelectedFace = String(modelingDraft.selectedFace ?? '')
    canvas.dataset.modelingPlaneMode = modelingDraft.planeMode
    canvas.dataset.modelingFaceSelected = String(modelingDraft.selectedFace !== null)
    canvas.dataset.modelingPlane = JSON.stringify(modelingDraft.plane)
  }, [modelingDraft, modelingElementMode, objects, theme])

  useEffect(() => {
    const scene = sceneRef.current
    const stretchGroup = stretchGroupRef.current
    const transformControls = transformControlsRef.current
    const pivot = transformPivotRef.current
    const canvas = canvasRef.current
    if (!scene || !stretchGroup || !transformControls || !pivot || !canvas) return

    transformControls.detach()
    transformControls.setSpace('world')
    transformControls.showX = true
    transformControls.showY = true
    transformControls.showZ = true
    const previousHelper = selectionHelperRef.current
    if (previousHelper) {
      scene.remove(previousHelper)
      previousHelper.geometry.dispose()
      ;(previousHelper.material as THREE.Material).dispose()
      selectionHelperRef.current = null
    }
    clearGroup(stretchGroup)
    stretchGroup.visible = false
    delete canvas.dataset.stretchHandles
    delete canvas.dataset.cameraGizmo
    delete canvas.dataset.selectedDisplayMode
    canvas.dataset.selectedCount = String(selectedIds.length)

    if (modelingDraft) return

    if (cameraSelected) {
      const cameraGuide = cameraHelperRef.current
      const cameraTargetGuide = cameraTargetHelperRef.current
      if (transformMode === 'rotate' && cameraTargetGuide) {
        transformControls.setMode('translate')
        transformControls.attach(cameraTargetGuide)
        canvas.dataset.cameraGizmo = 'aim'
      } else if (cameraGuide) {
        transformControls.setMode('translate')
        transformControls.attach(cameraGuide)
        canvas.dataset.cameraGizmo = 'translate'
      }
      return
    }

    if (selectedLightId) {
      const lightData = lighting.lights.find((light) => light.id === selectedLightId)
      const light = lightRootMapRef.current.get(selectedLightId)
      if (lightData && light && lightData.visible && !lightData.locked) {
        transformControls.setMode('translate')
        transformControls.attach(light)
      }
      return
    }

    const selectedRoots = selectedIds
      .map((id) => rootMapRef.current.get(id))
      .filter((root): root is THREE.Object3D => Boolean(root?.visible))
    if (selectedRoots.length === 0) return

    const selectionBox = new THREE.Box3()
    for (const root of selectedRoots) selectionBox.expandByObject(root)
    const helper = new THREE.Box3Helper(
      selectionBox,
      theme === 'dark' ? new THREE.Color('#51d3bb') : new THREE.Color('#0b8f7b')
    )
    const helperMaterial = helper.material as THREE.LineBasicMaterial
    helperMaterial.transparent = true
    helperMaterial.opacity = theme === 'dark' ? 0.42 : 0.34
    helperMaterial.depthTest = false
    helper.renderOrder = 800
    scene.add(helper)
    selectionHelperRef.current = helper

    if (facePaintObjectId) return

    const editableIds = selectedIds.filter((id) => {
      const object = objects.find((item) => item.id === id)
      return Boolean(object && !object.locked && rootMapRef.current.get(id)?.visible)
    })
    if (editableIds.length === 0) return

    const firstObject = objects.find((object) => object.id === editableIds[0])
    if (editableIds.length === 1 && firstObject) {
      canvas.dataset.selectedDisplayMode = firstObject.displayMode ?? 'solid'
    }
    if (
      editableIds.length === 1 &&
      transformMode === 'scale' &&
      firstObject?.kind !== 'mannequin'
    ) {
      const root = rootMapRef.current.get(editableIds[0])
      if (!root) return
      stretchGroup.visible = true
      for (const definition of stretchHandleDefinitions) {
        const handle = new THREE.Mesh(
          new THREE.SphereGeometry(0.58, 18, 12),
          new THREE.MeshBasicMaterial({ color: definition.color, depthTest: false })
        )
        handle.userData.axis = definition.axis
        handle.userData.sign = definition.sign
        handle.userData.objectId = editableIds[0]
        handle.renderOrder = 1000
        stretchGroup.add(handle)
      }
      canvas.dataset.stretchHandles = '6'
      return
    }

    if (editableIds.length === 1 && firstObject?.kind === 'mannequin' && mannequinPoseEditing) {
      return
    }

    transformControls.setMode(transformMode)
    if (editableIds.length === 1) {
      const root = rootMapRef.current.get(editableIds[0])
      if (root) transformControls.attach(root)
      return
    }

    const editableBounds = new THREE.Box3()
    for (const id of editableIds) {
      const root = rootMapRef.current.get(id)
      if (root) editableBounds.expandByObject(root)
    }
    pivot.position.copy(editableBounds.getCenter(new THREE.Vector3()))
    pivot.rotation.set(0, 0, 0)
    pivot.scale.set(1, 1, 1)
    pivot.updateMatrixWorld(true)
    transformControls.attach(pivot)
  }, [
    cameraSelected,
    firstPersonCameraControl,
    lighting.lights,
    modelingDraft,
    facePaintObjectId,
    objects,
    selectedIds,
    selectedLightId,
    theme,
    transformMode,
    mannequinPoseEditing
  ])

  useEffect(() => {
    const camera = sceneCameraRef.current
    const helper = cameraHelperRef.current
    const targetHelper = cameraTargetHelperRef.current
    const canvas = canvasRef.current
    if (!camera || !helper || !targetHelper || !canvas) return
    applyOutputCameraState(camera, cameraState, canvas)
    updateCameraGuide(helper, camera, theme, cameraSelected)
    updateCameraTargetGuide(targetHelper, cameraState, theme, cameraSelected)
    canvas.dataset.outputAspect = `${cameraState.aspectWidth}:${cameraState.aspectHeight}`
    canvas.dataset.cameraGuideTone = theme === 'dark' ? 'light' : 'dark'
  }, [cameraSelected, cameraState, theme])

  useEffect(() => {
    const helper = cameraHelperRef.current
    const controls = controlsRef.current
    const canvas = canvasRef.current
    if (!helper || !controls || !canvas) return
    controls.enabled = !cameraPreview
    canvas.dataset.cameraPreview = String(cameraPreview)
    canvas.dataset.firstPersonCamera = String(firstPersonCameraControl)
  }, [cameraPreview, firstPersonCameraControl, theme])

  useEffect(() => {
    const canvas = canvasRef.current
    const viewport = cameraMonitorViewportRef.current
    if (!canvas) return undefined
    canvas.dataset.cameraMonitor = String(cameraMonitor)
    if (!cameraMonitor || !viewport) {
      cameraMonitorBoundsRef.current = null
      delete canvas.dataset.cameraMonitorFrames
      return undefined
    }

    const updateBounds = (): void => {
      const canvasBounds = canvas.getBoundingClientRect()
      const viewportBounds = viewport.getBoundingClientRect()
      cameraMonitorBoundsRef.current = {
        left: Math.max(Math.round(viewportBounds.left - canvasBounds.left), 0),
        bottom: Math.max(Math.round(canvasBounds.bottom - viewportBounds.bottom), 0),
        width: Math.max(Math.round(viewportBounds.width), 1),
        height: Math.max(Math.round(viewportBounds.height), 1)
      }
    }

    const resizeObserver = new ResizeObserver(updateBounds)
    resizeObserver.observe(canvas)
    resizeObserver.observe(viewport)
    updateBounds()
    return () => {
      resizeObserver.disconnect()
      cameraMonitorBoundsRef.current = null
    }
  }, [cameraMonitor, cameraMonitorWindow, theme])

  useEffect(() => {
    const stage = stageRef.current
    if (!cameraMonitor || !stage) return undefined
    const ratio = Math.max(cameraState.aspectWidth / cameraState.aspectHeight, 0.001)
    const previousRatio = Math.max(cameraMonitorRatioRef.current, 0.001)
    cameraMonitorRatioRef.current = ratio
    let adjustForRatio = Math.abs(previousRatio - ratio) > 0.0001
    const fitWindow = (): void => {
      const stageBounds = stage.getBoundingClientRect()
      const shouldAdjustForRatio = adjustForRatio
      adjustForRatio = false
      setCameraMonitorWindow((current) => {
        const candidate = shouldAdjustForRatio
          ? {
              ...current,
              width: cameraMonitorWidthForRatio(current.width, previousRatio, ratio)
            }
          : current
        const next = fitCameraMonitorWindow(
          candidate,
          { width: stageBounds.width, height: stageBounds.height },
          ratio
        )
        if (current.x === next.x && current.y === next.y && current.width === next.width) {
          return current
        }
        return next
      })
    }
    const observer = new ResizeObserver(fitWindow)
    observer.observe(stage)
    fitWindow()
    return () => observer.disconnect()
  }, [cameraMonitor, cameraState.aspectHeight, cameraState.aspectWidth])

  const handleCameraMonitorPointerDown = (
    event: ReactPointerEvent<HTMLElement>,
    mode: ActiveCameraMonitorWindow['mode']
  ): void => {
    if (event.button !== 0) return
    if (mode === 'move' && (event.target as Element).closest('button')) return
    const stage = stageRef.current
    if (!stage) return
    const stageBounds = stage.getBoundingClientRect()
    const width = cameraMonitorWindow.width
    const windowState = {
      ...cameraMonitorWindow,
      x: cameraMonitorWindow.x ?? stageBounds.width - width - 14
    }
    activeCameraMonitorWindowRef.current = {
      pointerId: event.pointerId,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      window: windowState
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
    event.stopPropagation()
  }

  const handleCameraMonitorPointerMove = (event: ReactPointerEvent<HTMLElement>): void => {
    const active = activeCameraMonitorWindowRef.current
    const stage = stageRef.current
    if (!active || active.pointerId !== event.pointerId || !stage) return
    const bounds = stage.getBoundingClientRect()
    const ratio = Math.max(cameraState.aspectWidth / cameraState.aspectHeight, 0.001)
    const deltaX = event.clientX - active.startX
    const deltaY = event.clientY - active.startY
    if (active.mode === 'move') {
      const height = CAMERA_MONITOR_HEADER_HEIGHT + active.window.width / ratio
      setCameraMonitorWindow({
        width: active.window.width,
        x: THREE.MathUtils.clamp(
          (active.window.x ?? CAMERA_MONITOR_MARGIN) + deltaX,
          CAMERA_MONITOR_MARGIN,
          Math.max(
            bounds.width - active.window.width - CAMERA_MONITOR_MARGIN,
            CAMERA_MONITOR_MARGIN
          )
        ),
        y: THREE.MathUtils.clamp(
          active.window.y + deltaY,
          CAMERA_MONITOR_MARGIN,
          Math.max(bounds.height - height - CAMERA_MONITOR_MARGIN, CAMERA_MONITOR_MARGIN)
        )
      })
    } else {
      setCameraMonitorWindow(
        resizeCameraMonitorWindow(
          active.window,
          active.mode,
          deltaX,
          deltaY,
          { width: bounds.width, height: bounds.height },
          ratio
        )
      )
    }
    event.preventDefault()
    event.stopPropagation()
  }

  const handleCameraMonitorPointerEnd = (event: ReactPointerEvent<HTMLElement>): void => {
    const active = activeCameraMonitorWindowRef.current
    if (!active || active.pointerId !== event.pointerId) return
    activeCameraMonitorWindowRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    event.preventDefault()
    event.stopPropagation()
  }

  const handleMannequinJointPointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
    jointId: MannequinJointId
  ): void => {
    if (event.button !== 0 || selectedIds.length !== 1) return
    const object = objects.find((item) => item.id === selectedIds[0])
    const root = object?.kind === 'mannequin' ? rootMapRef.current.get(object.id) : undefined
    const camera = cameraRef.current
    const endpoint = (
      root?.userData.mannequinHandles as Map<MannequinJointId, THREE.Object3D> | undefined
    )?.get(jointId)
    if (!object?.mannequin || object.locked || !root || !camera || !endpoint) return
    const pose = readMannequinPose(root) ?? cloneMannequinPose(object.mannequin.pose)
    const endpointPosition =
      mannequinVisualHandlePosition(root, jointId, new THREE.Vector3()) ??
      endpoint.getWorldPosition(new THREE.Vector3())
    const cameraDirection = camera.getWorldDirection(new THREE.Vector3())
    const visualState = (root.userData.mannequinVisualState ?? {}) as MannequinVisualState
    activeMannequinJointRef.current = {
      pointerId: event.pointerId,
      objectId: object.id,
      jointId,
      dragPlane: new THREE.Plane().setFromNormalAndCoplanarPoint(cameraDirection, endpointPosition),
      startPose: pose,
      lastPose: pose,
      visualState
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    if (controlsRef.current) controlsRef.current.enabled = false
    onMannequinJointSelectRef.current(jointId)
    event.preventDefault()
    event.stopPropagation()
  }

  const handleMannequinJointPointerMove = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const active = activeMannequinJointRef.current
    if (!active || active.pointerId !== event.pointerId) return
    const root = rootMapRef.current.get(active.objectId)
    const canvas = canvasRef.current
    const camera = cameraRef.current
    if (!root || !canvas || !camera) return
    const bounds = canvas.getBoundingClientRect()
    const pointer = new THREE.Vector2(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1
    )
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(pointer, camera)
    const target = raycaster.ray.intersectPlane(active.dragPlane, new THREE.Vector3())
    if (!target) return
    const pose = poseMannequinJointToward(root, active.startPose, active.jointId, target)
    active.lastPose = pose
    applyMannequinPose(root, pose, {
      ...active.visualState,
      manualJoints: [...new Set([...(active.visualState.manualJoints ?? []), active.jointId])],
      presetBlend: undefined
    })
    canvas.dataset.mannequinLastJoint = active.jointId
    canvas.dataset.mannequinPose = JSON.stringify(pose)
    event.preventDefault()
    event.stopPropagation()
  }

  const handleMannequinJointPointerEnd = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const active = activeMannequinJointRef.current
    if (!active || active.pointerId !== event.pointerId) return
    activeMannequinJointRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (controlsRef.current) {
      controlsRef.current.enabled = !cameraPreviewRef.current
    }
    onMannequinPoseChangeRef.current(active.objectId, active.lastPose, active.jointId)
    event.preventDefault()
    event.stopPropagation()
  }

  return (
    <div ref={stageRef} className="scene-viewport-stage">
      <canvas
        ref={canvasRef}
        className="scene-canvas"
        aria-label="可编辑的三维白膜场景"
        onContextMenu={(event) => event.preventDefault()}
      />
      <div className="mannequin-joint-layer" aria-label="人台关节控制">
        {MANNEQUIN_JOINTS.map((joint) => (
          <button
            key={joint.id}
            ref={(element) => {
              if (element) mannequinHandleRefs.current.set(joint.id, element)
              else mannequinHandleRefs.current.delete(joint.id)
            }}
            type="button"
            className={selectedMannequinJoint === joint.id ? 'is-selected' : undefined}
            aria-label={`拖动${mannequinJointLabel(joint.id)}`}
            title={`拖动${mannequinJointLabel(joint.id)}`}
            onPointerDown={(event) => handleMannequinJointPointerDown(event, joint.id)}
            onPointerMove={handleMannequinJointPointerMove}
            onPointerUp={handleMannequinJointPointerEnd}
            onPointerCancel={handleMannequinJointPointerEnd}
          />
        ))}
      </div>
      {cameraMonitor && !cameraPreview ? (
        <section
          className="camera-monitor"
          aria-label="实时摄影机取景窗"
          style={
            {
              '--camera-ratio': cameraState.aspectWidth / cameraState.aspectHeight,
              left: cameraMonitorWindow.x ?? undefined,
              top: cameraMonitorWindow.y,
              width: cameraMonitorWindow.width
            } as React.CSSProperties
          }
        >
          <header
            className="camera-monitor-header"
            title="拖动取景窗"
            onPointerDown={(event) => handleCameraMonitorPointerDown(event, 'move')}
            onPointerMove={handleCameraMonitorPointerMove}
            onPointerUp={handleCameraMonitorPointerEnd}
            onPointerCancel={handleCameraMonitorPointerEnd}
          >
            <CameraIcon aria-hidden="true" />
            <span>
              实时取景 · {cameraState.aspectWidth}:{cameraState.aspectHeight}
            </span>
            <button
              type="button"
              aria-label="关闭实时取景窗"
              title="关闭实时取景窗"
              onClick={onCameraMonitorClose}
            >
              <X aria-hidden="true" />
            </button>
          </header>
          <div
            ref={cameraMonitorViewportRef}
            className="camera-monitor-viewport"
            aria-label={`摄影机实时画面 ${cameraState.aspectWidth}:${cameraState.aspectHeight}`}
          />
          {cameraMonitorResizeHandles.map((handle) => (
            <button
              key={handle.edge}
              className={`camera-monitor-resize is-${handle.edge}`}
              type="button"
              aria-label={handle.label}
              title={handle.label}
              onPointerDown={(event) => handleCameraMonitorPointerDown(event, handle.edge)}
              onPointerMove={handleCameraMonitorPointerMove}
              onPointerUp={handleCameraMonitorPointerEnd}
              onPointerCancel={handleCameraMonitorPointerEnd}
            >
              {handle.edge === 'se' ? <MoveDiagonal2 aria-hidden="true" /> : null}
            </button>
          ))}
        </section>
      ) : null}
      {cameraPreview ? (
        <div
          className="camera-preview-frame"
          aria-label={`摄影机取景 ${cameraState.aspectWidth}:${cameraState.aspectHeight}`}
          style={
            {
              '--camera-ratio': cameraState.aspectWidth / cameraState.aspectHeight,
              aspectRatio: `${cameraState.aspectWidth} / ${cameraState.aspectHeight}`
            } as React.CSSProperties
          }
        />
      ) : null}
      {marqueeRect ? (
        <div
          className="selection-marquee"
          aria-hidden="true"
          style={{
            left: marqueeRect.left,
            top: marqueeRect.top,
            width: marqueeRect.width,
            height: marqueeRect.height
          }}
        />
      ) : null}
    </div>
  )
})

export default SceneViewport
