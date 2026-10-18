import { readFileSync } from 'node:fs'

export function readSource(relativePath: string): string {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8')
}

export function readLocale(name: string): Record<string, string> {
  return JSON.parse(readSource(`src/i18n/locales/${name}.json`)) as Record<string, string>
}
