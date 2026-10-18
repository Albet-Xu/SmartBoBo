import type { PropsWithOverlays } from '@overlastic/react'
import { TriangleExclamationFill } from '@gravity-ui/icons'
import { AlertDialog, Button, Chip, InputGroup, Label, TextField } from '@heroui/react'
import { useDisclosure } from '@overlastic/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { normalizeProfileId } from '@/utils/profile-id'

/** 核心升级时的选择：切到配套档案，或无视风险直接切核心 */
export type CoreUpgradeChoice
  = | { mode: 'profile', name: string }
    | { mode: 'ignore' }

export interface CoreUpgradeProfileDialogProps extends PropsWithOverlays {
  /** 当前使用中的核心版本（展示用） */
  fromVersion: string
  /** 目标核心版本（展示用） */
  toVersion: string
  /** 档案名默认值：目标版本号（含 patch，如 `Core-0.1.7`；同一 patch 的 rc 共用档案） */
  defaultName: string
}

/**
 * 「升级到更新的核心」警告对话框：核心与档案配套，升到任何更新的 dsh 版本都可能破坏
 * 当前档案里的插件与设置。
 *
 * - 确认：resolve `{ mode: 'profile', name }`，由调用方创建/切换档案后再切核心并重启；
 * - 「无视风险切换」：resolve `{ mode: 'ignore' }`，跳过档案切换直接切核心；
 * - 取消/关闭：reject，调用方中止本次切换。
 */
export function CoreUpgradeProfileDialog(props: CoreUpgradeProfileDialogProps) {
  const disclosure = useDisclosure({ props })
  const { t } = useTranslation()
  const [name, setName] = useState(props.defaultName)
  const profileId = normalizeProfileId(name)

  function confirmProfile() {
    if (!profileId)
      return
    disclosure.confirm({ mode: 'profile', name })
  }

  return (
    <AlertDialog onOpenChange={disclosure.cancel} isOpen={disclosure.visible}>
      <AlertDialog.Backdrop>
        <AlertDialog.Container>
          <AlertDialog.Dialog className="sm:max-w-[420px]">
            <AlertDialog.CloseTrigger />
            <AlertDialog.Header>
              <AlertDialog.Icon status="danger" />
              <AlertDialog.Heading>{t('core.breaking_title')}</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body className="space-y-3">
              <p className="text-xs leading-[1.7] text-muted">
                {t('core.breaking_desc', { from: props.fromVersion, to: props.toVersion })}
              </p>
              <TextField className="w-full" name="profile">
                <Label>{t('core.breaking_profile_label')}</Label>
                <InputGroup fullWidth variant="secondary">
                  <InputGroup.Input
                    autoFocus
                    value={name}
                    onChange={e => setName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter')
                        confirmProfile()
                    }}
                  />
                </InputGroup>
              </TextField>
            </AlertDialog.Body>
            <AlertDialog.Footer className="justify-end">
              <Chip className="cursor-pointer" color="warning" variant="soft" onClick={() => disclosure.confirm({ mode: 'ignore' })}>
                <TriangleExclamationFill width={12} />
                {t('core.breaking_ignore')}
              </Chip>
              <div className="flex flex-row items-center gap-2">
                <Button variant="tertiary" onPress={disclosure.cancel}>
                  {t('buttons.cancel')}
                </Button>
                <Button
                  variant="primary"
                  isDisabled={!profileId}
                  onPress={confirmProfile}
                >
                  {t('buttons.confirm')}
                </Button>
              </div>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </AlertDialog>
  )
}
