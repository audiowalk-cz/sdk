import { BehaviorSubject, combineLatest, map, Subject } from "rxjs";

export interface PlayerControllerOptions {
  playOnInit?: boolean;
  autoSave?: boolean;
}

export enum PlayerStatus {
  "playing" = "playing",
  "paused" = "paused",
  "ended" = "ended",
}

export class PlayerController {
  public readonly onPlay = new Subject<void>();
  public readonly onPause = new Subject<void>();
  public readonly onStop = new Subject<void>();

  public readonly currentTime = new BehaviorSubject<number>(0);
  public readonly totalTime = new BehaviorSubject<number>(0);
  public readonly progress = combineLatest([this.currentTime, this.totalTime]).pipe(
    map(([currentTime, totalTime]) => currentTime / totalTime)
  );

  public readonly status = new BehaviorSubject<PlayerStatus | null>(null);

  public readonly playing = this.status.pipe(map((status) => status === "playing"));

  private file?: string;

  constructor(private readonly playerElement: HTMLAudioElement, private options: PlayerControllerOptions = {}) {
    navigator.mediaSession.setActionHandler("play", () => this.play());
    navigator.mediaSession.setActionHandler("pause", () => this.pause());
    navigator.mediaSession.setActionHandler("seekbackward", () => this.back());
    navigator.mediaSession.setActionHandler("seekforward", () => this.forward());
    navigator.mediaSession.setActionHandler("previoustrack", () => this.back());
    navigator.mediaSession.setActionHandler("nexttrack", () => this.forward());
    navigator.mediaSession.setActionHandler("seekto", (details) => {
      // The fastSeek dictionary member will be true if the seek action is being called
      // multiple times as part of a sequence and this is not the last call in that sequence.
      if (details.fastSeek !== true && details.seekTime) this.seekTo(details.seekTime);
    });

    this.status.subscribe((status) => {
      switch (status) {
        case "playing":
          navigator.mediaSession.playbackState = "playing";
          break;
        case "paused":
          navigator.mediaSession.playbackState = "paused";
          break;

        default:
        case "ended":
          navigator.mediaSession.playbackState = "none";
          break;
      }
    });

    this.playerElement.addEventListener("play", () => {
      this.onPlay.next();
      this.status.next(PlayerStatus.playing);
    });

    this.playerElement.addEventListener("pause", () => {
      this.onPause.next();
      this.status.next(PlayerStatus.paused);
    });

    this.playerElement.addEventListener("ended", () => {
      this.onStop.next();
      this.status.next(PlayerStatus.ended);
    });

    this.playerElement.addEventListener("loadedmetadata", (event) => {
      if (this.playerElement.duration) {
        this.totalTime.next(this.playerElement.duration);
      }
    });

    this.playerElement.addEventListener("timeupdate", () => {
      navigator.mediaSession.setPositionState({
        duration: this.playerElement.duration,
        playbackRate: this.playerElement.playbackRate,
        position: this.playerElement.currentTime,
      });

      this.currentTime.next(this.playerElement.currentTime);

      if (this.playerElement.duration) {
        this.totalTime.next(this.playerElement.duration);
      }

      this.savePosition(this.playerElement.currentTime);
    });
  }

  open(file: string, metadata: MediaMetadataInit) {
    this.file = file;

    navigator.mediaSession.metadata = new MediaMetadata(metadata);

    const position = localStorage.getItem(`progress-${this.file}`);
    if (position && this.options.autoSave) this.playerElement.currentTime = parseFloat(position);

    if (this.options.playOnInit) this.playerElement.play();
  }

  close() {
    this.file = undefined;
    this.playerElement.pause();
    this.playerElement.src = "";

    navigator.mediaSession.setActionHandler("play", null);
    navigator.mediaSession.setActionHandler("pause", null);
    navigator.mediaSession.setActionHandler("previoustrack", null);
    navigator.mediaSession.setActionHandler("nexttrack", null);
    navigator.mediaSession.playbackState = "none";
    navigator.mediaSession.metadata = null;
  }

  play() {
    if (!this.file) throw new Error("No file opened");

    this.log("Called play");
    this.playerElement?.play();
  }

  pause() {
    if (!this.file) throw new Error("No file opened");
    this.log("Called pause");
    this.playerElement?.pause();
  }

  seekTo(seconds: number) {
    if (!this.file) throw new Error("No file opened");

    this.log("Called seekTo");
    this.playerElement.currentTime = seconds;
  }

  back() {
    if (!this.file) throw new Error("No file opened");

    const position = this.playerElement.currentTime;
    this.seekTo(Math.max(position - 10, 0));
  }

  forward() {
    if (!this.file) throw new Error("No file opened");

    const position = this.playerElement.currentTime;
    const duration = this.playerElement.duration;
    this.seekTo(duration && duration > 0 ? Math.min(position + 10, duration) : position + 10);
  }

  private savePosition(currentTime: number) {
    if (!this.file) return;
    localStorage.setItem(`progress-${this.file}`, String(currentTime));
  }

  private log(message: string) {
    const time = this.playerElement?.currentTime ? Math.round(this.playerElement?.currentTime) : null;

    if (time) message += ` @${time}s`;

    console.log(`[PlayerController] ${message}`);
  }
}
