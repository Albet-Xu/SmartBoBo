import type { ChipVariant, UiComponentEntry } from 'dsh-tauri-ui/client'
import type { ReactElement, ReactNode } from 'react'
import {
  Action,
  ArrowRightFromSquare,
  Button,
  CircleTree,
  Comments,
  ConversationBar,
  ConversationBarAction,
  Dot,
  Gear,
  Icon,
  Input,
  Magnifier,
  Person,
  Pill,
  Plus,
  Puzzle,
  Select,
  Switch,
  Tag,
  TerminalLine,
  TrashBin,
  UI_COMPONENT_REGISTRY,
  useMountStyle,
  Xmark,
} from 'dsh-tauri-ui/client'
import { useState } from 'react'
import { PLUGIN_ID } from '../../../shared/constants'
import { UI_COMPONENTS_STYLE_ID } from '../../constants'
import uiComponentsStyle from './ui-components.cssr'

const BUTTON_VARIANTS = ['primary', 'outline', 'ghost', 'toolbar'] as const
const BUTTON_SIZES = ['md', 'sm'] as const
const TAG_TONES = ['outline', 'solid', 'neutral', 'quiet', 'success', 'info', 'warning', 'danger'] as const

interface SampleOption { value: string, label: string }

const SEAT_OPTIONS: readonly SampleOption[] = [
  { value: 'default', label: '默认' },
  { value: 'plan', label: '计划模式' },
  { value: 'review', label: '评审模式' },
]
const PERMISSION_OPTIONS: readonly SampleOption[] = [
  { value: 'default', label: '默认权限' },
  { value: 'acceptEdits', label: '接受编辑' },
  { value: 'bypass', label: '跳过确认' },
]
const THEME_OPTIONS: readonly SampleOption[] = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
]

/** 通用的 `Select` 把三个 chip 变体都铺成触发器，这里逐档演示（选中态/chevron 旋转/弹层位置由它自管）。 */
function SelectSample({ variant, icon, options }: {
  variant: ChipVariant
  icon?: ReactNode
  options: readonly SampleOption[]
}): ReactElement {
  const [value, setValue] = useState(options[0]?.value ?? '')
  return <Select icon={icon} options={options} value={value} variant={variant} onChange={setValue} />
}

function SourceCard({ entry }: { entry: UiComponentEntry }): ReactElement {
  const { source } = entry
  return (
    <div className="dshp-ui-components__card">
      <div className="dshp-ui-components__cardHead">
        <span className="dshp-ui-components__name">{entry.title}</span>
        <span className="dshp-ui-components__badge">{source.kind}</span>
      </div>
      <div className="dshp-ui-components__meta">
        <span>
          {source.variant === undefined
            ? `映射组件：${source.component}`
            : `映射组件：${source.component} · ${source.variant}`}
        </span>
        <span className="dshp-ui-components__code">{source.package}</span>
        <span>{`版本：${source.availableAt.join(' / ')}`}</span>
        {source.mappedClass === undefined
          ? null
          : <span>{`官方类名：.${source.mappedClass}`}</span>}
        <span className="dshp-ui-components__code">{source.upstreamPath}</span>
      </div>
    </div>
  )
}

export function UiComponentsPanel(): ReactElement {
  useMountStyle(uiComponentsStyle, UI_COMPONENTS_STYLE_ID, PLUGIN_ID)
  const [checked, setChecked] = useState(true)
  const [activePill, setActivePill] = useState('alpha')
  const [query, setQuery] = useState('')

  return (
    <div className="dshp-ui-components">
      <section className="dshp-ui-components__section">
        <span className="dshp-ui-components__title">官方转发（reexport）</span>
        <span className="dshp-ui-components__hint">
          两代内核都导出，直接转发官方实现，样式由官方 CSS Modules 提供。
        </span>
        <div className="dshp-ui-components__sample">
          {BUTTON_SIZES.map(size => BUTTON_VARIANTS.map(variant => (
            <Button key={`${size}-${variant}`} size={size} variant={variant}>
              {`${variant} / ${size}`}
            </Button>
          )))}
        </div>
        <div className="dshp-ui-components__sample">
          <Button icon={<Plus />} variant="primary">带图标</Button>
          <Button icon={<TrashBin />} variant="ghost">带图标</Button>
          {TAG_TONES.map(tone => <Tag key={tone} tone={tone}>{tone}</Tag>)}
          <Pill active={activePill === 'alpha'} onClick={() => setActivePill('alpha')}>alpha</Pill>
          <Pill active={activePill === 'beta'} onClick={() => setActivePill('beta')}>beta</Pill>
          <Switch checked={checked} label="开关" onChange={setChecked} />
          <Input
            icon={<Magnifier />}
            placeholder="搜索"
            value={query}
            onChange={event => setQuery(event.target.value)}
          />
        </div>
      </section>

      <section className="dshp-ui-components__section">
        <span className="dshp-ui-components__title">refork 组件</span>
        <span className="dshp-ui-components__hint">
          官方只在 0.1.7 有实现或未导出，按官方 CSS 在本地重写；映射见下方表格。
        </span>
        <div className="dshp-ui-components__sample">
          <div className="dshp-ui-components__stack">
            <Button icon={<Plus width={16} height={16} />} variant="elevated">新建会话</Button>
            <Button disabled icon={<Plus width={16} height={16} />} variant="elevated">禁用态</Button>
            <Button icon={<Plus width={16} height={16} />} variant="add">添加模型</Button>
            <Button icon={<Comments width={16} height={16} />} variant="addGhost">通过 Chat 创建</Button>
            <Button icon={<TrashBin width={16} height={16} />} variant="danger">删除</Button>
            <Button icon={<TrashBin width={16} height={16} />} size="sm" variant="danger">删除 / sm</Button>
          </div>
          <Action aria-label="搜索" icon={<Magnifier width={16} height={16} />} variant="search" />
          <Action aria-label="工具栏" icon={<Gear width={16} height={16} />} variant="toolbar" />
          <Action aria-label="模型" icon={<Puzzle width={16} height={16} />} variant="model" />
          <Action aria-label="圆形" icon={<Plus width={16} height={16} />} variant="round" />
          <Action aria-label="行内" icon={<TrashBin width={16} height={16} />} variant="row" />
          <Action aria-expanded aria-label="帮助" icon={<Person width={16} height={16} />} variant="help" />
          <Action aria-label="消息动作" icon={<Comments width={16} height={16} />} variant="action" />
        </div>
        <div className="dshp-ui-components__sample">
          <div className="dshp-ui-components__stack">
            <ConversationBar
              actions={(
                <>
                  <ConversationBarAction
                    aria-label="检出本地"
                    iconOnly
                    title="检出本地"
                  >
                    <Icon as={ArrowRightFromSquare} size={14} />
                  </ConversationBarAction>
                  <ConversationBarAction
                    aria-label="放弃"
                    iconOnly
                    title="放弃"
                  >
                    <Icon as={TrashBin} size={14} />
                  </ConversationBarAction>
                </>
              )}
              glyph={<Icon as={CircleTree} size={14} />}
              label="工作树"
              objective="deepseek-harness-desktop · worktree 5a25420f"
            >
              <ConversationBarAction
                aria-label="日志"
                iconOnly
                title="日志"
              >
                <Icon as={TerminalLine} size={14} />
              </ConversationBarAction>
            </ConversationBar>
            <ConversationBar
              actions={(
                <>
                  <ConversationBarAction
                    aria-label="关闭"
                    iconOnly
                    title="关闭"
                  >
                    <Icon as={Xmark} size={14} />
                  </ConversationBarAction>
                  <ConversationBarAction>文本动作</ConversationBarAction>
                </>
              )}
              error="worktree create failed: exit 128"
              glyph={<Icon as={CircleTree} size={14} />}
              label="错误"
            />
          </div>
        </div>
        <div className="dshp-ui-components__sample">
          <SelectSample icon={<Icon as={Person} size={16} />} options={SEAT_OPTIONS} variant="seat" />
          <SelectSample icon={<Icon as={Gear} size={14} />} options={PERMISSION_OPTIONS} variant="composerTrigger" />
          <SelectSample options={THEME_OPTIONS} variant="selector" />
          <Tag variant="version">1.0.0</Tag>
          <Tag tone="neutral" variant="version">1.0.0</Tag>
          <Tag tone="outline" variant="status">outline</Tag>
          <Tag tone="info" variant="status">info</Tag>
          <Tag tone="danger" variant="status">danger</Tag>
        </div>
        <div className="dshp-ui-components__sample">
          <Dot state="done" />
          <Dot state="warning" />
          <Dot state="error" />
          <Dot state="idle" />
          <Dot />
          <Dot size={16} state="done" />
        </div>
      </section>

      <section className="dshp-ui-components__section">
        <span className="dshp-ui-components__title">{`映射表（${UI_COMPONENT_REGISTRY.length}）`}</span>
        <span className="dshp-ui-components__hint">
          kind = reexport 表示直接转发官方；refork 表示按官方 CSS 在本地重写。
        </span>
        <div className="dshp-ui-components__grid">
          {UI_COMPONENT_REGISTRY.map(entry => <SourceCard key={entry.id} entry={entry} />)}
        </div>
      </section>

      <section className="dshp-ui-components__section">
        <span className="dshp-ui-components__title">图标</span>
        <span className="dshp-ui-components__hint">
          官方 icons 桶两代导出名不同，统一走 @gravity-ui/icons，经 dsh-tauri-ui/client 转发。
        </span>
        <div className="dshp-ui-components__sample">
          <Icon as={Plus} size={20} />
          <Icon as={TrashBin} size={20} />
          <Icon as={Magnifier} size={20} />
          <Icon as={Gear} size={20} />
        </div>
      </section>
    </div>
  )
}
