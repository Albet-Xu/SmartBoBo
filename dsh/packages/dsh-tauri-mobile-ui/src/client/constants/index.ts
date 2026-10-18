import { MOBILE_MEDIA_QUERIES } from 'dsh-tauri/client'

export const MOBILE_SETTINGS_MEDIA = `${MOBILE_MEDIA_QUERIES.join(' and ')} and (max-width: 767px)`
