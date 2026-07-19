function hashIdentifier(identifier: string): number {
  let hash = 2166136261
  for (const character of identifier) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export function objectIdColor(identifier: string): string {
  const hash = hashIdentifier(identifier)
  const red = 64 + (hash & 0x9f)
  const green = 64 + ((hash >>> 8) & 0x9f)
  const blue = 64 + ((hash >>> 16) & 0x9f)
  return `#${[red, green, blue].map((value) => value.toString(16).padStart(2, '0')).join('')}`
}
