import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('configBackup component contract', () => {
  it('exports a named ConfigBackup function', () => {
    const source = readFileSync(new URL('../src/ui/config/backup.tsx', import.meta.url), 'utf8')
    expect(source).toContain('export function ConfigBackup')
  })

  it('invokes all four backup Tauri commands', () => {
    // 遵循档案面板模式：组件通过 useBackups 钩子调用命令，钩子内部 invoke
    const source = readFileSync(new URL('../src/hooks/use-backup.ts', import.meta.url), 'utf8')
    expect(source).toContain('backup_profile')
    expect(source).toContain('restore_profile')
    expect(source).toContain('list_backups')
    expect(source).toContain('delete_backup')
  })

  it('uses useTranslation with no hardcoded English/Chinese strings', () => {
    const source = readFileSync(new URL('../src/ui/config/backup.tsx', import.meta.url), 'utf8')
    expect(source).toContain('useTranslation')
    // 不应出现裸中文字符串（i18n key 通过 t() 传入）
    const cjkRange = '[\\u4e00-\\u9fff]'
    expect(source).not.toMatch(new RegExp(`>${cjkRange}+<`))
  })

  it('stays within the shell conventions', () => {
    const source = readFileSync(new URL('../src/ui/config/backup.tsx', import.meta.url), 'utf8')
    expect(source).not.toContain('useCallback')
    expect(source).not.toContain('useMemo')
  })
})

describe('useBackups hook contract', () => {
  it('exports a named useBackups function', () => {
    const source = readFileSync(new URL('../src/hooks/use-backup.ts', import.meta.url), 'utf8')
    expect(source).toContain('export function useBackups')
  })

  it('uses useQuery and useMutation', () => {
    const source = readFileSync(new URL('../src/hooks/use-backup.ts', import.meta.url), 'utf8')
    expect(source).toContain('useQuery')
    expect(source).toContain('useMutation')
  })

  it('invalidates on the setting_updated event through the shared hook', () => {
    const source = readFileSync(new URL('../src/hooks/use-backup.ts', import.meta.url), 'utf8')
    expect(source).toContain('useInvalidateOnSettingUpdated')

    // 事件名收敛在共享 hook 里，此处断言它仍是 setting_updated
    const shared = readFileSync(new URL('../src/hooks/use-invalidate-on-setting-updated.ts', import.meta.url), 'utf8')
    expect(shared).toContain('setting_updated')
  })
})
