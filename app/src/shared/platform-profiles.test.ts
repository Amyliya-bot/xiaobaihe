import { describe, expect, it } from 'vitest'
import {
  PLATFORM_PROFILE_RULES,
  parsePlatformProfileRules,
  validateVideoProfile
} from './platform-profiles'

describe('platform video profiles', () => {
  it('loads unique versioned profiles with a check date', () => {
    expect(PLATFORM_PROFILE_RULES.schemaVersion).toBe(1)
    expect(PLATFORM_PROFILE_RULES.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(new Set(PLATFORM_PROFILE_RULES.profiles.map((profile) => profile.id)).size).toBe(
      PLATFORM_PROFILE_RULES.profiles.length
    )
  })

  it('blocks durations and aspect ratios outside a strict platform profile', () => {
    const profile = PLATFORM_PROFILE_RULES.profiles.find((item) => item.id === 'veo-extend')!
    expect(validateVideoProfile(profile, 31, 4, 3).errors).toHaveLength(2)
    expect(validateVideoProfile(profile, 10, 16, 9).errors).toHaveLength(0)
  })

  it('rejects duplicate profile ids', () => {
    const profile = PLATFORM_PROFILE_RULES.profiles[0]
    expect(() =>
      parsePlatformProfileRules({
        ...PLATFORM_PROFILE_RULES,
        profiles: [profile, profile]
      })
    ).toThrow('重复')
  })
})
