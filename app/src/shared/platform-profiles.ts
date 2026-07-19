import profileData from './platform-profiles.json'

export type ProfileVerification = 'generic' | 'partial' | 'official-format' | 'official'

export interface VideoPlatformProfile {
  id: string
  name: string
  description: string
  verification: ProfileVerification
  frameRate: number
  maxDimension: number
  bitrate: number
  minDurationSeconds: number
  maxDurationSeconds: number
  maxFileSizeMb: number
  aspectRatios: string[]
  sourceUrl: string
}

export interface PlatformProfileRules {
  schemaVersion: number
  rulesVersion: string
  checkedAt: string
  profiles: VideoPlatformProfile[]
}

export interface ProfileValidationResult {
  errors: string[]
  warnings: string[]
  estimatedFileSizeMb: number
}

function isFinitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

export function parsePlatformProfileRules(value: unknown): PlatformProfileRules {
  if (!value || typeof value !== 'object') throw new Error('平台规则不是有效对象。')
  const rules = value as Partial<PlatformProfileRules>
  if (rules.schemaVersion !== 1) throw new Error('平台规则版本不受支持。')
  if (typeof rules.rulesVersion !== 'string' || typeof rules.checkedAt !== 'string') {
    throw new Error('平台规则缺少版本或核对日期。')
  }
  if (!Array.isArray(rules.profiles) || rules.profiles.length === 0) {
    throw new Error('平台规则没有可用预设。')
  }
  const ids = new Set<string>()
  for (const profile of rules.profiles) {
    if (!profile || typeof profile !== 'object') throw new Error('平台预设无效。')
    if (typeof profile.id !== 'string' || !profile.id || ids.has(profile.id)) {
      throw new Error('平台预设 ID 缺失或重复。')
    }
    ids.add(profile.id)
    if (
      typeof profile.name !== 'string' ||
      typeof profile.description !== 'string' ||
      !['generic', 'partial', 'official-format', 'official'].includes(profile.verification) ||
      !Number.isInteger(profile.frameRate) ||
      profile.frameRate < 1 ||
      profile.frameRate > 120 ||
      !Number.isInteger(profile.maxDimension) ||
      profile.maxDimension < 16 ||
      profile.maxDimension > 4096 ||
      !isFinitePositive(profile.bitrate) ||
      !isFinitePositive(profile.minDurationSeconds) ||
      !isFinitePositive(profile.maxDurationSeconds) ||
      profile.minDurationSeconds > profile.maxDurationSeconds ||
      !isFinitePositive(profile.maxFileSizeMb) ||
      !Array.isArray(profile.aspectRatios) ||
      typeof profile.sourceUrl !== 'string'
    ) {
      throw new Error(`平台预设“${profile.id}”包含无效参数。`)
    }
  }
  return rules as PlatformProfileRules
}

export const PLATFORM_PROFILE_RULES = parsePlatformProfileRules(profileData)

function aspectRatioLabel(width: number, height: number): string | null {
  const ratio = width / height
  const candidates = [
    { label: '16:9', ratio: 16 / 9 },
    { label: '9:16', ratio: 9 / 16 },
    { label: '1:1', ratio: 1 }
  ]
  return candidates.find((candidate) => Math.abs(candidate.ratio - ratio) <= 0.015)?.label ?? null
}

export function validateVideoProfile(
  profile: VideoPlatformProfile,
  durationSeconds: number,
  aspectWidth: number,
  aspectHeight: number
): ProfileValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  if (
    durationSeconds < profile.minDurationSeconds ||
    durationSeconds > profile.maxDurationSeconds
  ) {
    errors.push(
      `该预设要求时长为 ${profile.minDurationSeconds}-${profile.maxDurationSeconds} 秒，当前为 ${durationSeconds} 秒。`
    )
  }
  const aspectLabel = aspectRatioLabel(aspectWidth, aspectHeight)
  if (
    profile.aspectRatios.length > 0 &&
    (!aspectLabel || !profile.aspectRatios.includes(aspectLabel))
  ) {
    errors.push(`该预设只接受 ${profile.aspectRatios.join(' 或 ')} 画幅。`)
  }
  const estimatedFileSizeMb = (profile.bitrate * durationSeconds) / 8 / 1024 / 1024
  if (estimatedFileSizeMb > profile.maxFileSizeMb) {
    errors.push(`预计文件约 ${estimatedFileSizeMb.toFixed(1)} MB，超过该预设的大小上限。`)
  }
  if (profile.verification === 'partial') {
    warnings.push('此规则来自公开 API 资料，不同产品入口可能不同，请在上传页面再次核对。')
  } else if (profile.verification === 'official-format') {
    warnings.push('格式已按官方资料核对，但具体生成功能可能另有时长或画幅限制。')
  } else if (profile.verification === 'generic') {
    warnings.push('这是跨平台通用参考，不代表任一平台的强制接收标准。')
  }
  return { errors, warnings, estimatedFileSizeMb }
}
