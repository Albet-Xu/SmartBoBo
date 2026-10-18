import type { NotificationSound } from '../types'
import { PLUGIN_ID } from '../../shared/constants'
import { builtinSound, requestBuiltinSounds } from './sound-assets'

export interface SoundPlayer {
  /** 播放提示音；`custom` 且无自定义音频时不发声（由设置层保证退回默认）。 */
  play: (sound: NotificationSound, customSound: string | null) => void
  dispose: () => void
}

/**
 * 合成音兜底：内置音用的是壳层 `public/*.wav`，只有壳层还没把资源送进来时才会响。
 * 保留它而不是静默，是因为「通知响了」比「音色对不对」重要。
 */
const DEFAULT_NOTES: readonly (readonly [number, number])[] = [[1318.51, 0.09], [1760, 0.12]]
const CLASSIC_NOTES: readonly (readonly [number, number])[] = [[880, 0.12], [587.33, 0.2]]

/**
 * 提示音播放器。
 *
 * 内置音用壳层送进来的 data URL（`public/notification.wav`、`public/classic.wav`），
 * 自定义音用用户选的文件，两者都走 `<audio>`；资源没到位时内置音退回 WebAudio 合成。
 * 整个播放器在插件卸载时随 register 控制器一起释放。
 */
export function createSoundPlayer(): SoundPlayer {
  let context: AudioContext | undefined
  let custom: HTMLAudioElement | undefined

  const ensureContext = (): AudioContext | undefined => {
    if (context)
      return context
    if (typeof AudioContext === 'undefined')
      return undefined
    context = new AudioContext()
    return context
  }

  const playTone = (audio: AudioContext, frequency: number, duration: number, start: number): void => {
    const oscillator = audio.createOscillator()
    const gain = audio.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.value = frequency
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(0.16, start + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
    oscillator.connect(gain)
    gain.connect(audio.destination)
    oscillator.start(start)
    oscillator.stop(start + duration)
  }

  const playNotes = (notes: readonly (readonly [number, number])[]): void => {
    const audio = ensureContext()
    if (!audio)
      return
    if (audio.state === 'suspended')
      void audio.resume()
    let start = audio.currentTime + 0.01
    for (const [frequency, duration] of notes) {
      playTone(audio, frequency, duration, start)
      start += duration
    }
  }

  const playFile = (dataUrl: string): void => {
    if (typeof Audio === 'undefined')
      return
    custom ??= new Audio()
    if (custom.src !== dataUrl)
      custom.src = dataUrl
    try {
      custom.currentTime = 0
    }
    catch (error) {
      console.warn(`[${PLUGIN_ID}] failed to rewind notification sound`, error)
    }
    void custom.play().catch((error: unknown) => {
      console.warn(`[${PLUGIN_ID}] failed to play notification sound`, error)
    })
  }

  return {
    play(sound, customSound) {
      if (sound === 'none')
        return
      if (sound === 'custom') {
        if (customSound)
          playFile(customSound)
        return
      }
      const asset = builtinSound(sound)
      if (asset) {
        playFile(asset)
        return
      }
      // 首响时资源可能还在路上：先放着合成音，同时催一次壳层。
      requestBuiltinSounds()
      playNotes(sound === 'classic' ? CLASSIC_NOTES : DEFAULT_NOTES)
    },
    dispose() {
      custom?.pause()
      custom = undefined
      void context?.close()
      context = undefined
    },
  }
}
