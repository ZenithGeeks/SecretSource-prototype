import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Merge conditional class names, letting later Tailwind utilities win. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Keeps only the keys `incoming` shares with `defaults`, each kept only if its value has the
 * same type as the default's — a defensive merge for data from localStorage or a backend blob
 * that might be stale, hand-edited, or from an older shape. */
export function pickMatching<T extends Record<string, unknown>>(
  defaults: T,
  incoming: unknown,
): Partial<T> {
  if (typeof incoming !== 'object' || incoming === null || Array.isArray(incoming)) return {}
  const source = incoming as Record<string, unknown>
  const result: Partial<T> = {}
  for (const key of Object.keys(defaults) as (keyof T)[]) {
    const value = source[key as string]
    if (typeof value === typeof defaults[key]) result[key] = value as T[typeof key]
  }
  return result
}
