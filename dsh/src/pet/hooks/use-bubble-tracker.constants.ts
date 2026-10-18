import type { Motion } from 'dsh-pet-component'

/** 桌宠窗口无 i18n 基础设施，就地按窗口语言取单语文案。 */
export const IS_ZH = (typeof document !== 'undefined' ? document.documentElement.lang || navigator.language : 'zh-CN')
  .toLowerCase()
  .startsWith('zh')

/** 语言二选一助手，降低代码冗余 */
export const pickLang = <T>(zh: T, en: T): T => (IS_ZH ? zh : en)

/** 会话标题兜底文案 */
export const UNTITLED_SESSION_TITLE = pickLang('新会话', 'New session')

/** 会话标题前缀 */
export const SESSION_LABELS = {
  subagent: pickLang('子代理', 'Subagent'),
  waitApproval: pickLang('需授权', 'Needs approval'),
  waitChoice: pickLang('需选择', 'Needs your input'),
} as const

/** 气泡文案库（按组多备选句） */
export const STATUS_COPY: Record<string, readonly string[]> = {
  thinking: pickLang(['正在分析', '思考中', '整理结果中'], ['Analyzing information', 'Thinking', 'Organizing results']),
  working: pickLang(['正在处理任务', '步骤正在进行中', '系统运行中'], ['Processing task', 'Step in progress', 'System is working']),
  result: pickLang(['正在整理结果', '步骤已完成，准备下一步', '正在确认后续操作'], ['Organizing results', 'Step completed, preparing for next step', 'Confirming next action']),
  waiting: pickLang(['等待确认', '需提供后续指令', '请决策下一步操作'], ['Awaiting your confirmation', 'Requires your input', 'Please decide on the next step']),
  approval: pickLang(['等待审批', '需授权确认', '敏感操作确认授权'], ['Awaiting your approval', 'Authorization required', 'Please confirm and authorize this action']),
  success: pickLang(['任务已完成', '本阶段任务已完成', '流程执行成功'], ['Task completed successfully', 'Current phase completed', 'Execution succeeded']),
  running: pickLang(['任务运行中', '当前步骤正在处理'], ['Task is running', 'Current step is processing']),
  review: pickLang(['正在汇总变更', '变更已就绪，等待审阅'], ['Consolidating', 'Ready for your review']),
  failed: pickLang(['步骤执行失败', '操作执行过程中发生异常'], ['Step execution failed', 'An error occurred during operation']),
  error: pickLang(['任务发生错误', '出现异常，请进行排查', '流程未能成功'], ['Task encountered an error', 'Exception detected, please check', 'Process failed to complete']),
  stopped: pickLang(['任务已终止', '任务已在此处暂停'], ['Task terminated', 'Task paused at this stage']),
} as const

/** 工具活动分类文案 */
export const ACTIVITY_COPY: Record<string, readonly string[]> = {
  searching: pickLang(['正在检索', '正在项目中进行全面搜索', '正在调阅相关文件'], ['Searching', 'Searching across the project', 'Checking related files']),
  editing: pickLang(['正在修改', '正在写入变更内容', '正在调整代码实现'], ['Editing', 'Applying changes', 'Adjusting implementation']),
  testing: pickLang(['正在检验', '正在运行测试集进行确认', '正在验证变更有效性'], ['Verifying', 'Running test suites', 'Verifying changes']),
  commanding: pickLang(['正在执行', '正在启动项目服务', '正在监控指令执行状态'], ['Executing', 'Starting project services', 'Monitoring command execution']),
} as const

/** 状态与动画分类集合 */
export const DONE_BUBBLE_TIMEOUT = 3000
export const TERMINAL_MOTIONS = new Set<Motion>(['failed', 'review', 'error', 'success'])
export const WORK_STATUSES = new Set(['thinking', 'working', 'result', 'waiting', 'success', 'error'])
export const ACTIVE_MOTIONS = new Set<Motion>(['running', 'thinking', 'working', 'result'])

export const TOOL_LABELS: Record<string, string> = {
  pwsh: 'Pwsh',
  bash: 'Bash',
  grep: 'Grep',
  glob: 'Glob',
  read: '读取',
  read_image: '看图',
  write: '写入',
  edit: '编辑',
  str_replace_editor: '编辑',
  web_search: '搜索',
  web_fetch: '抓取',
  think: '思考',
  skill: '技能',
}

export const TOOL_ARG_KEYS: Record<string, readonly string[]> = {
  pwsh: ['command'],
  bash: ['command'],
  grep: ['pattern'],
  glob: ['pattern'],
  read: ['file_path', 'path'],
  read_image: ['file_path', 'path'],
  write: ['file_path', 'path'],
  edit: ['file_path', 'path'],
  str_replace_editor: ['file_path', 'path'],
  web_search: ['queries', 'query'],
  web_fetch: ['url'],
  think: ['thought'],
  skill: ['name'],
}

export const TOOL_PATTERNS: Array<[RegExp, string]> = [
  [/search|grep|find|glob|web|read|fetch|open/, 'searching'],
  [/write|edit|patch|replace|create|move|delete/, 'editing'],
  [/test|check|lint|build|verify/, 'testing'],
  [/shell|bash|exec|command|terminal|powershell|pwsh/, 'commanding'],
]

export const STATUS_TEXT_MAP: Record<string, string> = {
  think: pickLang('思考中', 'Thinking'),
  thinking: pickLang('思考中', 'Thinking'),
  working: pickLang('处理中', 'Working'),
  result: pickLang('整理中', 'Organizing'),
  waiting: pickLang('等待中', 'Waiting'),
  review: pickLang('待审阅', 'Review'),
  failed: pickLang('失败', 'Failed'),
  error: pickLang('出错', 'Error'),
  success: pickLang('已完成', 'Done'),
}
