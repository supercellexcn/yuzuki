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

/** 诊断日志只打一次，避免刷屏（媒体控件属于「静默失效」型功能，留个线索好排查）。 */
let mediaSessionLogged = false

interface PlayItem {
  rj: string
  file: MediaFile
  work: Work | null
  url: string
}

export const usePlayerStore = defineStore('player', {
  state: () => ({
    /** 当前活跃的音频元素 */
    audio: null as HTMLAudioElement | null,
    /** 备用音频元素：预载下一首，换曲时顶上来播（见 play 里的说明） */
    audioSpare: null as HTMLAudioElement | null,
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
    /**
     * 建一个隐藏的音频元素并挂好事件。
     * 元素会 append 到文档里（隐藏）—— 放进文档比游离元素更稳，个别浏览器对游离元素
     * 设置 src 会走额外的加载校验。
     * 所有事件都判断「是不是当前活跃元素」：换曲时会暂停旧元素，它同样会触发 pause，
     * 不加判断会把播放状态改错。
     */
    createAudio(): HTMLAudioElement {
      const a = new Audio()
      a.preload = 'metadata'
      a.loop = this.loop
      a.volume = this.volume
      a.style.display = 'none'
      document.body.appendChild(a)
      a.addEventListener('timeupdate', () => {
        if (a !== this.audio) return
        this.currentTime = a.currentTime
        // 锁屏进度条：节流到约 1 秒一次，避免每个 timeupdate 都写
        const now = Date.now()
        if (now - lastPositionSyncAt > 900) {
          lastPositionSyncAt = now
          this.syncPositionState()
        }
      })
      a.addEventListener('durationchange', () => {
        if (a !== this.audio) return
        this.duration = a.duration || 0
        this.syncPositionState()
      })
      a.addEventListener('play', () => {
        if (a !== this.audio) return
        this.playing = true
      })
      /*
       * 「真正开始出声」的时机才声明媒体卡片与播放状态 —— 都在真实事件里更新，
       * 不为了保住通知栏去强行置 state。
       */
      a.addEventListener('playing', () => {
        if (a !== this.audio) return
        this.playing = true
        this.setMediaPlaybackState('playing')
        this.applyMediaMetadata()
        this.preloadNext()
      })
      a.addEventListener('pause', () => {
        if (a !== this.audio) return
        this.playing = false
        this.setMediaPlaybackState('paused')
      })
      a.addEventListener('ended', () => {
        if (a !== this.audio) return
        this.playing = false
        // 播完当前文件自动播放下一个（队列为空或已是最后一个则 next() 内部直接返回）
        this.next()
      })
      a.addEventListener('error', () => {
        if (a !== this.audio) return
        this.playing = false
      })
      return a
    },
    ensureAudio() {
      if (!this.audio) {
        this.audio = this.createAudio()
        this.audioSpare = this.createAudio()
        this.initMediaSession()
      }
      return this.audio
    },
    play(rj: string, file: MediaFile, work: Work | null, queue?: MediaFile[]) {
      this.ensureAudio()
      const active = this.audio as HTMLAudioElement
      const url = mediaUrl(rj, file.id)
      // 同一文件：切换播放/暂停
      if (this.current?.url === url) {
        if (active.paused) active.play().catch((err: DOMException) => this.onPlayRejected(err))
        else active.pause()
        return
      }
      if (queue && queue.length) this.queue = [...queue]
      else if (this.current?.rj !== rj) this.queue = []
      // 保留已加载的作品信息，避免封面/标题一闪而空
      const keepWork = work || (this.current?.rj === rj ? this.current.work : null)
      this.current = { rj, file, work: keepWork, url }
      this.applyMediaMetadata()

      /*
       * 换曲改用「另一个音频元素」来播，而不是给正在播的元素换 src。
       * 复用同一元素换 src 时，Android 会把媒体通知撤掉且不再重建（Chromium 已知问题，
       * Google 官方 Media Session 示例的写法同样会触发）；而「另一个元素开始播放」相当于
       * 一次全新的媒体播放，系统才会像首次播放那样重新给出通知。
       * 先把引用换好再 play()，这样事件里「是不是活跃元素」的判断才能通过。
       */
      const next = this.audioSpare as HTMLAudioElement
      const prev = active
      this.audio = next
      this.audioSpare = prev
      // 已预载同一首时不要重复赋值（会重新触发加载、白费掉预载）
      if (next.src !== new URL(url, window.location.origin).href) next.src = url
      next.play().catch((err: DOMException) => this.onPlayRejected(err))
      /*
       * 新元素真正出声后再停旧元素：避免出现「两个都不播」的空窗 —— 通知正是在那时被撤掉。
       * 停之前都要确认它「已经不是活跃元素」：只有两个元素轮换，连点几次切歌时同一个元素
       * 可能又被换回活跃位置，此时把它 pause 掉会误停正在播的那一首。
       */
      const stopPrevIfIdle = () => {
        if (prev !== this.audio && !prev.paused) prev.pause()
      }
      if (!prev.paused) {
        next.addEventListener('playing', stopPrevIfIdle, { once: true })
        // 兜底：万一 playing 没触发，也不能让两个元素同时出声
        setTimeout(stopPrevIfIdle, 1500)
      }
      this.record(rj, file.id)
    },
    /** play() 的 Promise 被拒绝时记录原因（过去是静默失败，表现就是「不切歌也不报错」）。 */
    onPlayRejected(err: DOMException) {
      // 快速切歌时上一次 play() 会以 AbortError 结束，属正常情况
      if (err?.name === 'AbortError') return
      this.playing = false
      console.warn('[player] 播放被拒绝：', err?.name, err?.message)
    },
    /** 把队列里的下一首预载到备用元素，换曲时几乎没有加载间隙。 */
    preloadNext() {
      const cur = this.current
      const spare = this.audioSpare
      if (!cur || !spare) return
      const idx = this.queue.findIndex((f) => f.id === cur.file.id)
      const nextFile = idx >= 0 ? this.queue[idx + 1] : undefined
      if (!nextFile) {
        spare.removeAttribute('src')
        return
      }
      const rel = mediaUrl(cur.rj, nextFile.id)
      if (spare.src === new URL(rel, window.location.origin).href) return // 已经是它了
      spare.preload = 'auto'
      spare.src = rel
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
      // 两个元素都要同步，否则换曲后循环设置会丢
      if (this.audio) this.audio.loop = this.loop
      if (this.audioSpare) this.audioSpare.loop = this.loop
    },
    toggle() {
      const a = this.audio
      if (!a || !this.current) return
      if (a.paused) a.play().catch((err: DOMException) => this.onPlayRejected(err))
      else a.pause()
    },
    seek(t: number) {
      const a = this.audio
      if (a) a.currentTime = t
    },
    setVolume(v: number) {
      this.volume = v
      // 两个元素都要同步，否则换曲后音量会跳回旧值
      if (this.audio) this.audio.volume = v
      if (this.audioSpare) this.audioSpare.volume = v
    },
    stop() {
      for (const el of [this.audio, this.audioSpare]) {
        if (!el) continue
        el.pause()
        el.removeAttribute('src')
        el.load()
      }
      this.current = null
      this.queue = []
      this.playing = false
      this.currentTime = 0
      this.duration = 0
      // 顺带收掉锁屏/通知栏的媒体卡片
      this.releaseMediaSession()
    },
    // ---- Media Session：锁屏 / 通知栏媒体卡片与耳机按键 ----
    /**
     * 注册系统媒体会话。它负责「元数据 + 控制入口」，
     * 让系统把网页播放当成正式媒体会话处理（锁屏卡片、线控/蓝牙按键）。
     * 注意：它不能阻止系统省电策略杀进程，息屏续播仍取决于 ROM 是否放行。
     */
    initMediaSession() {
      if (this.mediaSessionReady) return
      if (!mediaSessionSupported()) {
        console.warn('[mediaSession] 当前浏览器不支持系统媒体控件（navigator.mediaSession 不存在）')
        return
      }
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
    /**
     * 把「当前曲目」写进锁屏/通知栏媒体卡片。读取 this.current，可重复调用
     * （同一首重复写没有副作用），所以既用于首次播放，也用于换曲后的重建。
     */
    applyMediaMetadata() {
      const cur = this.current
      if (!cur || !mediaSessionSupported() || typeof MediaMetadata === 'undefined') return
      const { rj, file, work } = cur
      const cover = work?.cover_url ? authedUrl(work.cover_url) : ''
      if (!mediaSessionLogged) {
        mediaSessionLogged = true
        console.info('[mediaSession] 已写入系统媒体卡片', {
          title: file.filename || work?.title || rj,
          artwork: cover ? 1 : 0,
          secureContext: window.isSecureContext,
        })
      }
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
    /** 释放媒体会话：清空卡片并把播放状态置为 none（通知随之收起）。仅用于 stop()。 */
    releaseMediaSession() {
      if (!mediaSessionSupported()) return
      navigator.mediaSession.metadata = null
      navigator.mediaSession.playbackState = 'none'
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
