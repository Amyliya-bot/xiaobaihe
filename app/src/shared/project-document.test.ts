import { describe, expect, it } from 'vitest'
import {
  createProjectDocument,
  customProfileToMesh,
  DEFAULT_LIGHTING,
  DEFAULT_TIMELINE,
  parseProjectDocument,
  type SceneObjectData
} from './project-document'

describe('project document v12', () => {
  it('round-trips wall and floor primitives', () => {
    const document = createProjectDocument({
      name: '快速建筑',
      objects: [
        {
          id: 'wall-1',
          kind: 'wall',
          name: '墙体 01',
          position: { x: 1, y: 1.4, z: 2 },
          rotation: { x: 0, y: 30, z: 0 },
          size: { x: 5, y: 2.8, z: 0.18 },
          color: '#f2f4f3',
          visible: true,
          locked: false
        },
        {
          id: 'floor-1',
          kind: 'floor',
          name: '地面 01',
          position: { x: 0, y: 0.06, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          size: { x: 6, y: 0.12, z: 4 },
          color: '#f2f4f3',
          visible: true,
          locked: false
        }
      ],
      camera: {
        position: { x: 7, y: 5, z: 8 },
        target: { x: 0, y: 1, z: 0 },
        fovDegrees: 42,
        aspectWidth: 16,
        aspectHeight: 9
      },
      lighting: DEFAULT_LIGHTING,
      timeline: DEFAULT_TIMELINE
    })

    expect(parseProjectDocument(JSON.stringify(document))).toEqual(document)
  })

  it('round-trips scene objects, editable mesh topology, cuts, camera and timeline state', () => {
    const document = createProjectDocument({
      name: '教室草图',
      objects: [
        {
          id: 'box-1',
          kind: 'box',
          name: '讲台',
          position: { x: 1, y: 0.5, z: -2 },
          rotation: { x: 0, y: 30, z: 0 },
          size: { x: 2, y: 1, z: 1 },
          color: '#f2f4f3',
          colorOverride: '#67b8a7',
          faceColors: { '0:0': '#f05a68', '0:1': '#f05a68' },
          displayMode: 'transparent',
          cuts: [{ normal: { x: 1, y: 0, z: 0 }, offset: 0.2, keep: 'positive' }],
          visible: true,
          locked: false
        },
        {
          id: 'custom-1',
          kind: 'custom',
          name: '梯形台',
          position: { x: 0, y: 1, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          size: { x: 1, y: 2, z: 1 },
          color: '#ffffff',
          visible: true,
          locked: false,
          customMesh: customProfileToMesh({
            points: [
              { x: -1, y: -1 },
              { x: 1, y: -1 },
              { x: 1, y: 1 },
              { x: -1, y: 1 }
            ],
            topPoints: [
              { x: -0.5, y: -0.5 },
              { x: 0.5, y: -0.5 },
              { x: 0.5, y: 0.5 },
              { x: -0.5, y: 0.5 }
            ]
          })
        }
      ],
      camera: {
        position: { x: 7, y: 5, z: 8 },
        target: { x: 0, y: 1, z: 0 },
        fovDegrees: 42,
        aspectWidth: 16,
        aspectHeight: 9
      },
      lighting: DEFAULT_LIGHTING,
      timeline: {
        durationSeconds: 8,
        objectKeyframes: [
          {
            id: 'key-1',
            objectId: 'box-1',
            timeSeconds: 2,
            interpolation: 'smooth',
            transform: {
              position: { x: 4, y: 0.5, z: -2 },
              rotation: { x: 0, y: 90, z: 0 },
              size: { x: 2, y: 1, z: 1 }
            }
          }
        ],
        cameraShots: [
          {
            id: 'shot-1',
            name: '镜头 01',
            timeSeconds: 0,
            transition: 'cut',
            camera: {
              position: { x: 7, y: 5, z: 8 },
              target: { x: 0, y: 1, z: 0 },
              fovDegrees: 42,
              aspectWidth: 16,
              aspectHeight: 9
            }
          }
        ]
      }
    })

    expect(parseProjectDocument(JSON.stringify(document))).toEqual(document)
  })

  it('migrates schema 1 projects with default camera and lighting settings', () => {
    const legacy = {
      schemaVersion: 1,
      appVersion: '0.2.4',
      savedAt: '2026-07-12T00:00:00.000Z',
      name: '旧工程',
      scene: {
        objects: [
          {
            id: 'box-old',
            kind: 'box',
            name: '旧方块',
            position: { x: 0, y: 1, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            size: { x: 2, y: 2, z: 2 },
            color: '#f2f4f3',
            visible: true,
            locked: false
          }
        ],
        camera: {
          position: { x: 7, y: 5, z: 8 },
          target: { x: 0, y: 1, z: 0 }
        }
      }
    }
    const migrated = parseProjectDocument(JSON.stringify(legacy))

    expect(migrated.schemaVersion).toBe(12)
    expect(migrated.scene.camera.fovDegrees).toBe(42)
    expect(migrated.scene.camera.aspectWidth).toBe(16)
    expect(migrated.scene.lighting).toEqual(DEFAULT_LIGHTING)
    expect(migrated.scene.timeline).toEqual(DEFAULT_TIMELINE)
    expect(migrated.scene.objects[0].displayMode).toBeUndefined()
  })

  it('migrates schema 2 camera and key light settings without losing the key light', () => {
    const legacy = {
      schemaVersion: 2,
      appVersion: '0.3.0',
      savedAt: '2026-07-13T00:00:00.000Z',
      name: '上一版工程',
      scene: {
        objects: [],
        camera: {
          position: { x: 7, y: 5, z: 8 },
          target: { x: 0, y: 1, z: 0 },
          fovDegrees: 55
        },
        lighting: {
          environmentIntensity: 1.2,
          keyIntensity: 4.2,
          keyColor: '#abcdef',
          keyPosition: { x: 3, y: 6, z: 2 }
        }
      }
    }
    const migrated = parseProjectDocument(JSON.stringify(legacy))

    expect(migrated.schemaVersion).toBe(12)
    expect(migrated.scene.camera.fovDegrees).toBe(55)
    expect(migrated.scene.lighting.lights[0]).toMatchObject({
      intensity: 4.2,
      color: '#abcdef',
      position: { x: 3, y: 6, z: 2 }
    })
    expect(migrated.scene.timeline).toEqual(DEFAULT_TIMELINE)
  })

  it('migrates schema 3 camera and lights with an empty timeline', () => {
    const previous = {
      schemaVersion: 3,
      appVersion: '0.4.1',
      savedAt: '2026-07-14T00:00:00.000Z',
      name: '镜头升级工程',
      scene: {
        objects: [],
        camera: {
          position: { x: 4, y: 3, z: 9 },
          target: { x: 0, y: 1, z: 0 },
          fovDegrees: 50,
          aspectWidth: 9,
          aspectHeight: 16
        },
        lighting: DEFAULT_LIGHTING
      }
    }
    const migrated = parseProjectDocument(JSON.stringify(previous))

    expect(migrated.schemaVersion).toBe(12)
    expect(migrated.scene.camera.aspectWidth).toBe(9)
    expect(migrated.scene.lighting).toEqual(DEFAULT_LIGHTING)
    expect(migrated.scene.timeline).toEqual(DEFAULT_TIMELINE)
  })

  it('migrates schema 4 projects without changing their scene data', () => {
    const previous = {
      schemaVersion: 4,
      appVersion: '0.5.0',
      savedAt: '2026-07-14T01:00:00.000Z',
      name: '上一阶段工程',
      scene: {
        objects: [],
        camera: {
          position: { x: 7, y: 5, z: 8 },
          target: { x: 0, y: 1, z: 0 },
          fovDegrees: 42,
          aspectWidth: 16,
          aspectHeight: 9
        },
        lighting: DEFAULT_LIGHTING,
        timeline: { durationSeconds: 5, cameraShots: [] }
      }
    }
    const migrated = parseProjectDocument(JSON.stringify(previous))

    expect(migrated.schemaVersion).toBe(12)
    expect(migrated.scene).toEqual({ ...previous.scene, timeline: DEFAULT_TIMELINE })
  })

  it('migrates schema 5 projects with an empty object animation track', () => {
    const previous = {
      schemaVersion: 5,
      appVersion: '0.6.0',
      savedAt: '2026-07-14T02:00:00.000Z',
      name: '自由建模工程',
      scene: {
        objects: [],
        camera: {
          position: { x: 7, y: 5, z: 8 },
          target: { x: 0, y: 1, z: 0 },
          fovDegrees: 42,
          aspectWidth: 16,
          aspectHeight: 9
        },
        lighting: DEFAULT_LIGHTING,
        timeline: { durationSeconds: 5, cameraShots: [] }
      }
    }
    const migrated = parseProjectDocument(JSON.stringify(previous))

    expect(migrated.schemaVersion).toBe(12)
    expect(migrated.scene.timeline).toEqual(DEFAULT_TIMELINE)
  })

  it('migrates schema 6 projects without inventing paint overrides', () => {
    const previous = createProjectDocument({
      name: '物体动画工程',
      objects: [],
      camera: {
        position: { x: 7, y: 5, z: 8 },
        target: { x: 0, y: 1, z: 0 },
        fovDegrees: 42,
        aspectWidth: 16,
        aspectHeight: 9
      },
      lighting: DEFAULT_LIGHTING,
      timeline: DEFAULT_TIMELINE
    }) as unknown as { schemaVersion: number; scene: { objects: SceneObjectData[] } }
    previous.schemaVersion = 6

    const migrated = parseProjectDocument(JSON.stringify(previous))

    expect(migrated.schemaVersion).toBe(12)
    expect(migrated.scene.objects).toEqual([])
  })

  it('migrates schema 7 custom profiles into editable vertices, edges and faces', () => {
    const previous = {
      schemaVersion: 7,
      appVersion: '0.8.1',
      savedAt: '2026-07-14T03:00:00.000Z',
      name: '旧自定义模型',
      scene: {
        objects: [
          {
            id: 'custom-old',
            kind: 'custom',
            name: '旧梯形',
            position: { x: 0, y: 1, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            size: { x: 1, y: 2, z: 1 },
            color: '#ffffff',
            visible: true,
            locked: false,
            customProfile: {
              points: [
                { x: -1, y: -1 },
                { x: 1, y: -1 },
                { x: 1, y: 1 },
                { x: -1, y: 1 }
              ],
              topPoints: [
                { x: -0.5, y: -0.5 },
                { x: 0.5, y: -0.5 },
                { x: 0.5, y: 0.5 },
                { x: -0.5, y: 0.5 }
              ]
            }
          }
        ],
        camera: {
          position: { x: 7, y: 5, z: 8 },
          target: { x: 0, y: 1, z: 0 },
          fovDegrees: 42,
          aspectWidth: 16,
          aspectHeight: 9
        },
        lighting: DEFAULT_LIGHTING,
        timeline: DEFAULT_TIMELINE
      }
    }

    const migrated = parseProjectDocument(JSON.stringify(previous))
    const custom = migrated.scene.objects[0]

    expect(migrated.schemaVersion).toBe(12)
    expect(custom.customProfile).toBeUndefined()
    expect(custom.customMesh?.vertices).toHaveLength(8)
    expect(custom.customMesh?.faces).toHaveLength(6)
  })

  it('migrates schema 8 projects without changing their scene data', () => {
    const previous = createProjectDocument({
      name: '上一版静态输出工程',
      objects: [],
      camera: {
        position: { x: 7, y: 5, z: 8 },
        target: { x: 0, y: 1, z: 0 },
        fovDegrees: 42,
        aspectWidth: 16,
        aspectHeight: 9
      },
      lighting: DEFAULT_LIGHTING,
      timeline: DEFAULT_TIMELINE
    }) as unknown as { schemaVersion: number; scene: unknown }
    previous.schemaVersion = 8

    const migrated = parseProjectDocument(JSON.stringify(previous))
    expect(migrated.schemaVersion).toBe(12)
    expect(migrated.scene).toEqual(previous.scene)
  })

  it('round-trips a mannequin and its animated pose', () => {
    const pose = {
      head: { x: 0, y: 12, z: 0 },
      spine: { x: -8, y: 0, z: 0 },
      leftShoulder: { x: 20, y: 0, z: -8 },
      rightShoulder: { x: -30, y: 0, z: 10 },
      leftElbow: { x: 25, y: 0, z: 0 },
      rightElbow: { x: 40, y: 0, z: 0 },
      leftHip: { x: -28, y: 0, z: -2 },
      rightHip: { x: 24, y: 0, z: 2 },
      leftKnee: { x: 18, y: 0, z: 0 },
      rightKnee: { x: 8, y: 0, z: 0 }
    }
    const object: SceneObjectData = {
      id: 'mannequin-1',
      kind: 'mannequin',
      name: '人台 01',
      position: { x: 0, y: 0.875, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      size: { x: 1.75, y: 1.75, z: 1.75 },
      color: '#d9dddc',
      visible: true,
      locked: false,
      mannequin: { heightMeters: 1.75, pose }
    }
    const document = createProjectDocument({
      name: '人台动作',
      objects: [object],
      camera: {
        position: { x: 7, y: 5, z: 8 },
        target: { x: 0, y: 1, z: 0 },
        fovDegrees: 42,
        aspectWidth: 16,
        aspectHeight: 9
      },
      lighting: DEFAULT_LIGHTING,
      timeline: {
        durationSeconds: 5,
        cameraShots: [],
        objectKeyframes: [
          {
            id: 'pose-1',
            objectId: object.id,
            timeSeconds: 2,
            interpolation: 'smooth',
            transform: {
              position: { ...object.position },
              rotation: { ...object.rotation },
              size: { ...object.size },
              mannequinPose: pose
            }
          }
        ]
      }
    })

    expect(parseProjectDocument(JSON.stringify(document))).toEqual(document)
  })

  it('migrates schema 9 projects to the mannequin-aware schema', () => {
    const previous = createProjectDocument({
      name: '上一版本地工程',
      objects: [],
      camera: {
        position: { x: 7, y: 5, z: 8 },
        target: { x: 0, y: 1, z: 0 },
        fovDegrees: 42,
        aspectWidth: 16,
        aspectHeight: 9
      },
      lighting: DEFAULT_LIGHTING,
      timeline: DEFAULT_TIMELINE
    }) as unknown as { schemaVersion: number; scene: unknown }
    previous.schemaVersion = 9

    const migrated = parseProjectDocument(JSON.stringify(previous))
    expect(migrated.schemaVersion).toBe(12)
    expect(migrated.scene).toEqual(previous.scene)
  })

  it('migrates schema 10 projects without inventing optimization choices', () => {
    const previous = createProjectDocument({
      name: '人台版本工程',
      objects: [],
      camera: {
        position: { x: 7, y: 5, z: 8 },
        target: { x: 0, y: 1, z: 0 },
        fovDegrees: 42,
        aspectWidth: 16,
        aspectHeight: 9
      },
      lighting: DEFAULT_LIGHTING,
      timeline: DEFAULT_TIMELINE
    }) as unknown as { schemaVersion: number; scene: unknown }
    previous.schemaVersion = 10

    const migrated = parseProjectDocument(JSON.stringify(previous))
    expect(migrated.schemaVersion).toBe(12)
    expect(migrated.scene).toEqual(previous.scene)
  })

  it('migrates schema 11 projects without inventing mannequin action choices', () => {
    const previous = createProjectDocument({
      name: '上一版人台工程',
      objects: [],
      camera: {
        position: { x: 7, y: 5, z: 8 },
        target: { x: 0, y: 1, z: 0 },
        fovDegrees: 42,
        aspectWidth: 16,
        aspectHeight: 9
      },
      lighting: DEFAULT_LIGHTING,
      timeline: DEFAULT_TIMELINE
    }) as unknown as { schemaVersion: number; scene: unknown }
    previous.schemaVersion = 11

    const migrated = parseProjectDocument(JSON.stringify(previous))
    expect(migrated.schemaVersion).toBe(12)
    expect(migrated.scene).toEqual(previous.scene)
  })

  it('rejects damaged and unsupported documents', () => {
    expect(() => parseProjectDocument('{broken')).toThrow('工程文件无法读取')
    expect(() => parseProjectDocument(JSON.stringify({ schemaVersion: 99 }))).toThrow(
      '不支持的工程版本'
    )
    expect(() =>
      parseProjectDocument(JSON.stringify({ schemaVersion: 1, name: '缺少场景' }))
    ).toThrow('工程内容不完整')
  })

  it('rejects object animation tracks with missing objects or duplicate times', () => {
    const document = createProjectDocument({
      name: '无效动画',
      objects: [
        {
          id: 'box-1',
          kind: 'box',
          name: '方块',
          position: { x: 0, y: 0.5, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          size: { x: 1, y: 1, z: 1 },
          color: '#ffffff',
          visible: true,
          locked: false
        }
      ],
      camera: {
        position: { x: 7, y: 5, z: 8 },
        target: { x: 0, y: 1, z: 0 },
        fovDegrees: 42,
        aspectWidth: 16,
        aspectHeight: 9
      },
      lighting: DEFAULT_LIGHTING,
      timeline: {
        durationSeconds: 5,
        cameraShots: [],
        objectKeyframes: [
          {
            id: 'key-1',
            objectId: 'box-1',
            timeSeconds: 2,
            interpolation: 'smooth',
            transform: {
              position: { x: 1, y: 0.5, z: 0 },
              rotation: { x: 0, y: 0, z: 0 },
              size: { x: 1, y: 1, z: 1 }
            }
          }
        ]
      }
    })
    const missingObject = structuredClone(document)
    missingObject.scene.timeline.objectKeyframes[0].objectId = 'missing'
    expect(() => parseProjectDocument(JSON.stringify(missingObject))).toThrow('不存在的对象')

    const duplicateTime = structuredClone(document)
    duplicateTime.scene.timeline.objectKeyframes.push({
      ...structuredClone(duplicateTime.scene.timeline.objectKeyframes[0]),
      id: 'key-2'
    })
    expect(() => parseProjectDocument(JSON.stringify(duplicateTime))).toThrow('无效数据')
  })
})
