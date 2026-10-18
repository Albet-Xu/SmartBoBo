import { MOBILE_MEDIA_QUERIES } from '../constants'

export { MOBILE_MEDIA_QUERIES }
export function isMobileDevice(match: (query: string) => boolean): boolean {
  return MOBILE_MEDIA_QUERIES.every(query => match(query))
}

export function detectMobileDevice(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function')
    return false
  return isMobileDevice(query => window.matchMedia(query).matches)
}
