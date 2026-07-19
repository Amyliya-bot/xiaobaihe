import {
  DEFAULT_LIGHTING,
  DEFAULT_TIMELINE,
  type BasicPrimitiveKind,
  type CameraState,
  type CustomMeshData,
  type ImportedModelAsset,
  type SceneLightData,
  type SceneLightKind,
  type SceneLightingState,
  type SceneObjectData,
  type TimelineState
} from '../../../shared/project-document'
import { DEFAULT_CAMERA_STATE } from './defaults'
import { cloneMannequinPose, createMannequinData } from '../mannequin/mannequin'

export interface SceneState {
  objects: SceneObjectData[]
  camera: CameraState
  lighting: SceneLightingState
  timeline: TimelineState
}

const kindNames: Record<BasicPrimitiveKind, string> = {
  box: '方块',
  cylinder: '圆柱',
  sphere: '球体',
  wall: '墙体',
  floor: '地面'
}

const kindSizes: Record<BasicPrimitiveKind, SceneObjectData['size']> = {
  box: { x: 2.2, y: 2.2, z: 2.2 },
  cylinder: { x: 1.8, y: 2.4, z: 1.8 },
  sphere: { x: 2, y: 2, z: 2 },
  wall: { x: 4, y: 2.8, z: 0.18 },
  floor: { x: 4, y: 0.12, z: 4 }
}

const lightPreset: Record<
  SceneLightKind,
  Pick<
    SceneLightData,
    'name' | 'position' | 'target' | 'color' | 'intensity' | 'size' | 'angleDegrees'
  >
> = {
  area: {
    name: '柔和面光',
    position: { x: 5, y: 8, z: 4 },
    target: { x: 0, y: 1, z: 0 },
    color: '#fff4df',
    intensity: 2.5,
    size: 4,
    angleDegrees: 45
  },
  point: {
    name: '点光源',
    position: { x: 3, y: 5, z: 3 },
    target: { x: 0, y: 1, z: 0 },
    color: '#fff1d6',
    intensity: 3.2,
    size: 0.35,
    angleDegrees: 45
  },
  spot: {
    name: '聚光灯',
    position: { x: 4, y: 7, z: 5 },
    target: { x: 0, y: 1, z: 0 },
    color: '#fff8ee',
    intensity: 4,
    size: 0.3,
    angleDegrees: 38
  },
  sun: {
    name: '日光',
    position: { x: 6, y: 10, z: 4 },
    target: { x: 0, y: 0, z: 0 },
    color: '#fff5dc',
    intensity: 1.8,
    size: 1,
    angleDegrees: 5
  }
}

function createId(): string {
  return globalThis.crypto.randomUUID()
}

export function createSceneObject(
  kind: BasicPrimitiveKind,
  existingObjects: SceneObjectData[]
): SceneObjectData {
  const size = { ...kindSizes[kind] }
  const sameKindCount = existingObjects.filter((object) => object.kind === kind).length

  return {
    id: createId(),
    kind,
    name: `${kindNames[kind]} ${String(sameKindCount + 1).padStart(2, '0')}`,
    position: { x: 0, y: size.y / 2, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    size,
    color: '#f2f4f3',
    displayMode: 'solid',
    visible: true,
    locked: false
  }
}

export function createCustomSceneObject(
  mesh: CustomMeshData,
  existingObjects: SceneObjectData[],
  pose?: Pick<SceneObjectData, 'position' | 'rotation' | 'size'>
): SceneObjectData {
  const count = existingObjects.filter((object) => object.kind === 'custom').length
  return {
    id: createId(),
    kind: 'custom',
    name: `自定义形状 ${String(count + 1).padStart(2, '0')}`,
    position: pose ? { ...pose.position } : { x: 0, y: 0, z: 0 },
    rotation: pose ? { ...pose.rotation } : { x: 0, y: 0, z: 0 },
    size: pose ? { ...pose.size } : { x: 1, y: 1, z: 1 },
    color: '#f2f4f3',
    displayMode: 'solid',
    visible: true,
    locked: false,
    customMesh: {
      vertices: mesh.vertices.map((point) => ({ ...point })),
      edges: mesh.edges.map((edge) => [...edge]),
      faces: mesh.faces.map((face) => [...face])
    }
  }
}

export function createImportedSceneObject(
  asset: ImportedModelAsset,
  existingObjects: SceneObjectData[]
): SceneObjectData {
  const count = existingObjects.filter((object) => object.kind === 'imported').length
  const bounds = asset.report.bounds
  const longestSide = Math.max(bounds.x, bounds.y, bounds.z, 0.001)
  const displaySize = 3
  const normalizedHeight = (bounds.y / longestSide) * displaySize
  const sourceName = asset.sourceName.replace(/\.[^.]+$/, '').trim()
  return {
    id: createId(),
    kind: 'imported',
    name: sourceName || `导入模型 ${String(count + 1).padStart(2, '0')}`,
    position: { x: 0, y: Math.max(normalizedHeight / 2, 0.05), z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    size: { x: displaySize, y: displaySize, z: displaySize },
    color: '#f2f4f3',
    displayMode: 'solid',
    visible: true,
    locked: false,
    importedAsset: structuredClone(asset),
    useImportedLights: false,
    previewQuality: 'original',
    exportQuality: 'original'
  }
}

export function createMannequinSceneObject(existingObjects: SceneObjectData[]): SceneObjectData {
  const count = existingObjects.filter((object) => object.kind === 'mannequin').length
  const mannequin = createMannequinData()
  return {
    id: createId(),
    kind: 'mannequin',
    name: `人台 ${String(count + 1).padStart(2, '0')}`,
    position: { x: 0, y: mannequin.heightMeters / 2, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    size: {
      x: mannequin.heightMeters,
      y: mannequin.heightMeters,
      z: mannequin.heightMeters
    },
    color: '#e7ebea',
    displayMode: 'solid',
    visible: true,
    locked: false,
    mannequin
  }
}

export function createSceneLight(
  kind: SceneLightKind,
  existingLights: SceneLightData[]
): SceneLightData {
  const preset = lightPreset[kind]
  const count = existingLights.filter((light) => light.kind === kind).length
  return {
    id: createId(),
    kind,
    name: `${preset.name} ${String(count + 1).padStart(2, '0')}`,
    position: { ...preset.position },
    target: { ...preset.target },
    color: preset.color,
    intensity: preset.intensity,
    size: preset.size,
    angleDegrees: preset.angleDegrees,
    visible: true,
    locked: false
  }
}

export function createInitialScene(): SceneState {
  return {
    objects: [],
    camera: {
      position: { ...DEFAULT_CAMERA_STATE.position },
      target: { ...DEFAULT_CAMERA_STATE.target },
      fovDegrees: DEFAULT_CAMERA_STATE.fovDegrees,
      aspectWidth: DEFAULT_CAMERA_STATE.aspectWidth,
      aspectHeight: DEFAULT_CAMERA_STATE.aspectHeight
    },
    lighting: structuredClone(DEFAULT_LIGHTING),
    timeline: structuredClone(DEFAULT_TIMELINE)
  }
}

export function cloneSceneObject(
  object: SceneObjectData,
  existingObjects: SceneObjectData[]
): SceneObjectData {
  void existingObjects
  return {
    ...object,
    id: createId(),
    name: `${object.name} 副本`,
    position: { x: object.position.x + 0.8, y: object.position.y, z: object.position.z + 0.8 },
    rotation: { ...object.rotation },
    size: { ...object.size },
    customMesh: object.customMesh
      ? {
          vertices: object.customMesh.vertices.map((point) => ({ ...point })),
          edges: object.customMesh.edges.map((edge) => [...edge]),
          faces: object.customMesh.faces.map((face) => [...face])
        }
      : undefined,
    customProfile: object.customProfile
      ? {
          points: object.customProfile.points.map((point) => ({ ...point })),
          topPoints: object.customProfile.topPoints?.map((point) => ({ ...point }))
        }
      : undefined,
    cuts: object.cuts?.map((cut) => ({ ...cut, normal: { ...cut.normal } })),
    faceColors: object.faceColors ? { ...object.faceColors } : undefined,
    importedAsset: object.importedAsset ? structuredClone(object.importedAsset) : undefined,
    mannequin: object.mannequin
      ? {
          heightMeters: object.mannequin.heightMeters,
          pose: cloneMannequinPose(object.mannequin.pose),
          presetId: object.mannequin.presetId,
          manualJoints: object.mannequin.manualJoints
            ? [...object.mannequin.manualJoints]
            : undefined
        }
      : undefined
  }
}
