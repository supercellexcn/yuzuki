import { defineStore } from 'pinia'
import type { MediaFile, Work } from '../api/types'
import { authedUrl, mediaUrl, recordPlay } from '../api'
import { useLibraryStore } from './library'
import { useSettingsStore } from './settings'

/** 浏览器是否支持 Media Session（锁屏 / 通知栏媒体卡片）。 */
function mediaSessionSupported(): boolean {
  return typeof navigator !== 'undefined' && 'mediaSession' in navigator
}

/** 上一次同步锁屏进度的时间，用于节流（非响应式，无需进 state）。 */
let lastPositionSyncAt = 0

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
    /** Media Session 动作处理器只需注册一次 */
    mediaSessionReady: false,
  }),
  actions: {
    ensureAudio() {
      if (!this.audio) {
        const a = new Audio()
        a.preload = 'metadata'
        a.loop = this.loop
        a.addEventListener('timeupdate', () => {
          this.currentTime = a.currentTime
          // 锁屏进度条：节流到约 1 秒一次，避免每个 timeupdate 都写
          const now = Date.now()
          if (now - lastPositionSyncAt > 900) {
            lastPositionSyncAt = now
            this.syncPositionState()
          }
        })
        a.addEventListener('durationchange', () => {
          this.duration = a.duration || 0
          this.syncPositionState()
        })
        a.addEventListener('play', () => {
          this.playing = true
          this.setMediaPlaybackState('playing')
        })
        a.addEventListener('pause', () => {
          this.playing = false
          this.setMediaPlaybackState('paused')
        })
        a.addEventListener('ended', () => {
          this.playing = false
          // 播完当前文件自动播放下一个（队列为空或已是最后一个则 next() 内部直接返回）
          this.next()
        })
        a.addEventListener('error', () => (this.playing = false))
        a.volume = this.volume
        this.audio = a
        this.initMediaSession()
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
      this.updateMediaMetadata(rj, file, keepWork)
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
      // 顺带收掉锁屏/通知栏的媒体卡片
      if (mediaSessionSupported()) {
        navigator.mediaSession.metadata = null
        navigator.mediaSession.playbackState = 'none'
      }
    },
    // ---- Media Session：锁屏 / 通知栏媒体卡片与耳机按键 ----
    /**
     * 注册系统媒体会话。它负责「元数据 + 控制入口」，
     * 让系统把网页播放当成正式媒体会话处理（锁屏卡片、线控/蓝牙按键）。
     * 注意：它不能阻止系统省电策略杀进程，息屏续播仍取决于 ROM 是否放行。
     */
    initMediaSession() {
      if (this.mediaSessionReady || !mediaSessionSupported()) return
      this.mediaSessionReady = true
      const ms = navigator.mediaSession
      /** 浏览器对不支持的动作会抛错，逐个兜住即可。 */
      const on = (
        action: MediaSessionAction,
        handler: ((details: MediaSessionActionDetails) => void) | null
      ) => {
        try {
          ms.setActionHandler(action, handler)
        } catch {
          /* 该动作在当前浏览器不受支持 */
        }
      }
      const seekSecs = () => useSettingsStore().settings?.seek_seconds || 15
      on('play', () => this.resume())
      on('pause', () => this.pause())
      on('stop', () => this.stop())
      on('previoustrack', () => this.prev())
      on('nexttrack', () => this.next())
      on('seekbackward', (d) => this.seekBy(-(d.seekOffset ?? seekSecs())))
      on('seekforward', (d) => this.seekBy(d.seekOffset ?? seekSecs()))
      on('seekto', (d) => {
        if (typeof d.seekTime === 'number') this.seek(d.seekTime)
      })
    },
    /** 明确的「继续播放」——系统侧的 play 是确定语义，不能复用 toggle。 */
    resume() {
      const a = this.audio
      if (!a || !this.current || !a.paused) return
      a.play().catch(() => {
        /* 自动播放被拦截等情况，忽略 */
      })
    },
    /** 明确的「暂停」。 */
    pause() {
      this.audio?.pause()
    },
    setMediaPlaybackState(state: MediaSessionPlaybackState) {
      if (!mediaSessionSupported()) return
      navigator.mediaSession.playbackState = state
    },
    /** 同步锁屏进度条；duration/position 非法时会抛错，先做校验。 */
    syncPositionState() {
      const a = this.audio
      if (!a || !mediaSessionSupported() || typeof navigator.mediaSession.setPositionState !== 'function') {
        return
      }
      const duration = a.duration
      const position = a.currentTime
      // 元数据未就绪时 duration 可能是 NaN / Infinity / 0，position 也可能越界
      if (!Number.isFinite(duration) || duration <= 0) return
      if (!Number.isFinite(position) || position < 0) return
      try {
        navigator.mediaSession.setPositionState({
          duration,
          position: Math.min(position, duration),
          playbackRate: a.playbackRate || 1,
        })
      } catch {
        /* 进度条属于锦上添花，失败忽略 */
      }
    },
    /** 更新锁屏/通知栏卡片上的标题、声优、社团与封面。 */
    updateMediaMetadata(rj: string, file: MediaFile, work: Work | null) {
      if (!mediaSessionSupported() || typeof MediaMetadata === 'undefined') return
      const cover = work?.cover_url ? authedUrl(work.cover_url) : ''
      navigator.mediaSession.metadata = new MediaMetadata({
        // 标题用文件名（与实际播放内容一致），专辑放作品名
        title: file.filename || work?.title || rj,
        artist: work?.actors?.length ? work.actors.join('、') : work?.circle || '',
        album: work?.title || rj,
        artwork: cover
          ? [{ src: new URL(cover, window.location.origin).href, sizes: '512x512' }]
          : [],
      })
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
