import type { ExtensionRouteDeps } from './routes/index.types'
import { defineWebServer } from 'dsh-h3'
import { guard } from './guard'
import restart from './routes/host/restart/post'
import importApply from './routes/import/apply/post'
import importScan from './routes/import/scan/get'
import marketDetail from './routes/market/detail/get'
import marketFile from './routes/market/file/get'
import marketInstall from './routes/market/install/post'
import marketSearch from './routes/market/search/get'
import mcpCheck from './routes/mcp/check/post'
import mcpCopy from './routes/mcp/copy/post'
import mcpRemove from './routes/mcp/delete'
import mcp from './routes/mcp/get'
import mcpSave from './routes/mcp/post'
import mcpToggle from './routes/mcp/toggle/post'
import openDir from './routes/open/dir/post'
import repoCategory from './routes/repo/category/post'
import repoDetail from './routes/repo/detail/get'
import repoInstall from './routes/repo/install/post'
import repoList from './routes/repo/list/get'
import repoScope from './routes/repo/scope/post'
import repoUninstall from './routes/repo/uninstall/post'
import rootsRemove from './routes/roots/delete'
import roots from './routes/roots/get'
import rootsAdd from './routes/roots/post'
import skillDelete from './routes/skill/delete'
import skill from './routes/skill/get'
import skillPolicy from './routes/skill/policy/post'
import skillSave from './routes/skill/post'
import skills from './routes/skills/get'
import skillsRefresh from './routes/skills/refresh/post'

export const server = defineWebServer<ExtensionRouteDeps>((app) => {
  app.use(guard)
  app.get('/api/tauri/extension/skills', skills)
  app.post('/api/tauri/extension/skills/refresh', skillsRefresh)
  app.get('/api/tauri/extension/skill', skill)
  app.post('/api/tauri/extension/skill', skillSave)
  app.delete('/api/tauri/extension/skill', skillDelete)
  app.post('/api/tauri/extension/skill/policy', skillPolicy)
  app.post('/api/tauri/extension/open/dir', openDir)

  app.get('/api/tauri/extension/mcp', mcp)
  app.post('/api/tauri/extension/mcp', mcpSave)
  app.delete('/api/tauri/extension/mcp', mcpRemove)
  app.post('/api/tauri/extension/mcp/toggle', mcpToggle)
  app.post('/api/tauri/extension/mcp/check', mcpCheck)
  app.post('/api/tauri/extension/mcp/copy', mcpCopy)

  app.get('/api/tauri/extension/import/scan', importScan)
  app.post('/api/tauri/extension/import/apply', importApply)

  app.get('/api/tauri/extension/roots', roots)
  app.post('/api/tauri/extension/roots', rootsAdd)
  app.delete('/api/tauri/extension/roots', rootsRemove)

  app.post('/api/tauri/extension/host/restart', restart)

  app.get('/api/tauri/extension/repo/list', repoList)
  app.get('/api/tauri/extension/repo/detail', repoDetail)
  app.post('/api/tauri/extension/repo/install', repoInstall)
  app.post('/api/tauri/extension/repo/uninstall', repoUninstall)
  app.post('/api/tauri/extension/repo/scope', repoScope)
  app.post('/api/tauri/extension/repo/category', repoCategory)

  app.get('/api/tauri/extension/market/search', marketSearch)
  app.get('/api/tauri/extension/market/detail', marketDetail)
  app.get('/api/tauri/extension/market/file', marketFile)
  app.post('/api/tauri/extension/market/install', marketInstall)
})
