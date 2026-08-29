import { defineStore } from 'pinia'
import type { MediaFile, Work } from '../api/types'
import { mediaUrl, recordPlay } from '../api'
import { useLibraryStore } from './library'

interface PlayItem {
  rj: string
  file: MediaFile
  work: Work | null
  url: string
}

export const usePlayerStore = defineStore('player', {
  state: () => ({
    audio: null as HTMLAudioElement | null,
    current: null as PlayItem | null,
    queue: [] as MediaFile[],
    loop: false,
    playing: false,
    currentTime: 0,
    duration: 0,
    volume: 1,
    // 全屏播放器（移动端点音频文件打开，桌面端也可展开）
    fullscreenVisible: false,
    fullscreenRj: '',
    fullscreenWork: null as Work | null,
    fullscreenFiles: [] as MediaFile[],
  }),
  actions: {
    ensureAudio() {
      if (!this.audio) {
        const a = new Audio()
        a.preload = 'metadata'
        a.loop = this.loop
        a.addEventListener('timeupdate', () => (this.currentTime = a.currentTime))
        a.addEventListener('durationchange', () => (this.duration = a.duration || 0))
        a.addEventListener('play', () => (this.playing = true))
        a.addEventListener('pause', () => (this.playing = false))
        a.addEventListener('ended', () => {
          this.playing = false
          // 播完当前文件自动播放下一个（队列为空或已是最后一个则 next() 内部直接返回）
          this.next()
        })
        a.addEventListener('error', () => (this.playing = false))
        a.volume = this.volume
        this.audio = a
      }
      return this.audio
    },
    play(rj: string, file: MediaFile, work: Work | null, queue?: MediaFile[]) {
      const a = this.ensureAudio()
      const url = mediaUrl(rj, file.id)
      // 同一文件：切换播放/暂停
      if (this.current?.url === url) {
        if (a.paused) a.play()
        else a.pause()
        return
      }
      if (queue && queue.length) this.queue = [...queue]
      else if (this.current?.rj !== rj) this.queue = []
      // 保留已加载的作品信息，避免封面/标题一闪而空
      const keepWork = work || (this.current?.rj === rj ? this.current.work : null)
      this.current = { rj, file, work: keepWork, url }
      a.src = url
      a.play()
      this.record(rj, file.id)
    },
    /** 上一曲（在当前作品的播放队列内） */
    prev() {
      const cur = this.current
      if (!cur || !this.queue.length) return
      const idx = this.queue.findIndex((f) => f.id === cur.file.id)
      if (idx <= 0) return
      this.play(cur.rj, this.queue[idx - 1], cur.work, this.queue)
    },
    /** 下一曲 */
    next() {
      const cur = this.current
      if (!cur || !this.queue.length) return
      const idx = this.queue.findIndex((f) => f.id === cur.file.id)
      if (idx < 0 || idx >= this.queue.length - 1) return
      this.play(cur.rj, this.queue[idx + 1], cur.work, this.queue)
    },
    /** 快进/快退 delta 秒 */
    seekBy(delta: number) {
      const a = this.audio
      if (!a) return
      a.currentTime = Math.max(0, Math.min(this.duration || a.currentTime, a.currentTime + delta))
    },
    toggleLoop() {
      this.loop = !this.loop
      if (this.audio) this.audio.loop = this.loop
    },
    toggle() {
      const a = this.audio
      if (!a || !this.current) return
      if (a.paused) a.play()
      else a.pause()
    },
    seek(t: number) {
      const a = this.audio
      if (a) a.currentTime = t
    },
    setVolume(v: number) {
      this.volume = v
      if (this.audio) this.audio.volume = v
    },
    stop() {
      const a = this.audio
      if (a) {
        a.pause()
        a.removeAttribute('src')
        a.load()
      }
      this.current = null
      this.queue = []
      this.playing = false
      this.currentTime = 0
      this.duration = 0
    },
    // ---- 全屏播放器 ----
    /** 打开全屏播放器（不自动播放）。files 为作品的可播放队列。 */
    openFullscreen(rj: string, work: Work | null, files: MediaFile[]) {
      this.fullscreenRj = rj
      this.fullscreenWork = work
      this.fullscreenFiles = files
      this.fullscreenVisible = true
    },
    closeFullscreen() {
      this.fullscreenVisible = false
    },
    /** 用当前正在播放的作品打开全屏播放器（迷你条幅 / 桌面展开按钮使用）。 */
    openFullscreenFromCurrent() {
      const cur = this.current
      if (!cur) return
      this.openFullscreen(cur.rj, cur.work, this.queue)
    },
    /** 全屏播放器主按钮：无当前播放或不是当前作品 → 播放队列第一曲；否则切换播放/暂停。files 用于指定播放列表（如当前目录）。 */
    playFirstOrToggle(files?: MediaFile[]) {
      const list = files || this.fullscreenFiles
      if (!this.current || this.current.rj !== this.fullscreenRj) {
        const first = list.find((f) => f.is_dir !== 1 && (f.kind === 'audio' || f.kind === 'video'))
        if (first) this.play(this.fullscreenRj, first, this.fullscreenWork, list)
        return
      }
      this.toggle()
    },
    /** 记录播放历史 + 本地播放次数 +1 */
    record(rj: string, fileId: number) {
      recordPlay(rj, fileId).catch(() => {})
      const library = useLibraryStore()
      const w = library.items.find((x) => x.rj_code === rj)
      if (w) w.play_count += 1
      if (this.current?.work) this.current.work.play_count += 1
    },
  },
})
