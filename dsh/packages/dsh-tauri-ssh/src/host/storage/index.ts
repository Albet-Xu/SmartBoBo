import { createStorage } from 'unstorage'
import { sshDocumentDriver } from './driver'

export const storage = createStorage({ driver: sshDocumentDriver() })
