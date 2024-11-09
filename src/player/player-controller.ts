import { BehaviorSubject, combineLatest, map, Subject, take, takeUntil, takeWhile } from "rxjs";
import { LocalStorage } from "../storage/local-storage";

export interface PlayerControllerOptions {
  autoSave?: boolean;
  audioElement?: HTMLAudioElement;
  loop?: boolean;
  fadeIn?: boolean;
  fadeOut?: boolean;
  fadeInterval?: number;
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

  private trackId: string | null = null;

  public readonly status = new BehaviorSubject<PlayerStatus | null>(null);
  public readonly playing = this.status.pipe(map((status) => status === "playing"));

  private playerElement: HTMLAudioElement;

  private localStorage = new LocalStorage({ prefix: "player" });

  private options: PlayerControllerOptions & Required<Pick<PlayerControllerOptions, "fadeInterval">>;
  private defaultOptions: Required<Pick<PlayerControllerOptions, "fadeInterval">> = {
    fadeInterval: 2000,
  };

  private destroyEvent = new Subject<void>();

  private fadeIntervalSubscription?: number;
  private fadePromiseResolve?: () => void;

  constructor(trackId: string, trackUrl: string, options: PlayerControllerOptions = {}) {
    this.options = { ...this.defaultOptions, ...options };

    this.playerElement = this.options.audioElement ?? new Audio();

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
      this.currentTime.next(this.playerElement.currentTime);

      if (this.playerElement.duration) {
        this.totalTime.next(this.playerElement.duration);
      }
    });

    if (this.options.autoSave) {
      this.currentTime.pipe(takeUntil(this.destroyEvent)).subscribe((currentTime) => this.savePosition(currentTime));
    }

    if (this.options.fadeOut && !this.options.loop) {
      combineLatest([this.currentTime, this.totalTime])
        .pipe(takeUntil(this.destroyEvent))
        .pipe(
          takeWhile(([currentTime, totalTime]) => totalTime - currentTime < this.options.fadeInterval),
          take(1)
        )
        .subscribe(async (currentTime) => {
          this.onStop.next();
          this.fadeOut();
        });
    }

    if (this.options.loop) {
      this.onStop.pipe(takeUntil(this.destroyEvent)).subscribe(() => {
        this.playerElement.currentTime = 0;
        this.playerElement.play();
      });
    }

    this.open(trackId, trackUrl);

    this.log("Initialized player", this.playerElement);
  }

  async open(id: string, file: string) {
    this.trackId = id;
    this.playerElement.src = file;

    const position = await this.localStorage.get(`progress-${this.trackId}`, (value) => typeof value === "number");
    if (position && this.options.autoSave) this.playerElement.currentTime = position;
  }

  async destroy() {
    this.destroyEvent.next();

    await this.pause();

    this.playerElement.remove();
  }

  async play(options: { fadeIn?: boolean } = {}) {
    if (!this.playerElement.src) throw new Error("No file opened");

    this.log("Called play");
    await this.playerElement?.play();

    if (options.fadeIn !== undefined ? options.fadeIn : this.options.fadeIn) await this.fadeIn();
  }

  async fadeIn() {
    this.clearFade();

    return new Promise<void>((resolve) => {
      this.playerElement.volume = 0;

      this.fadePromiseResolve = resolve;
      this.fadeIntervalSubscription = setInterval(() => {
        if (this.playerElement.volume >= 1) {
          clearInterval(this.fadeIntervalSubscription);
          return resolve();
        }
        this.playerElement.volume = Math.min(this.playerElement.volume + (1 / this.options.fadeInterval) * 100, 1);
      }, 100);
    });
  }

  async fadeOut() {
    this.clearFade();

    return new Promise<void>((resolve) => {
      this.fadePromiseResolve = resolve;
      this.fadeIntervalSubscription = setInterval(() => {
        if (this.playerElement.volume <= 0) {
          clearInterval(this.fadeIntervalSubscription);
          this.playerElement.pause();
          return;
        }
        this.playerElement.volume = Math.max(this.playerElement.volume - (1 / this.options.fadeInterval) * 100, 0);
      }, 100);
    });
  }

  private clearFade() {
    clearInterval(this.fadeIntervalSubscription);
    this.fadePromiseResolve?.();
  }

  async pause(options: { fadeIn?: boolean } = {}) {
    if (!this.playerElement.src) throw new Error("No file opened");
    this.log("Called pause");
    this.playerElement?.pause();

    if (options.fadeIn !== undefined ? options.fadeIn : this.options.fadeIn) await this.fadeOut();
  }

  seekTo(seconds: number) {
    if (!this.playerElement.src) throw new Error("No file opened");

    this.log("Called seekTo");
    this.playerElement.currentTime = seconds;
  }

  back(seconds: number = 10) {
    if (!this.playerElement.src) throw new Error("No file opened");

    const position = this.playerElement.currentTime;
    this.seekTo(Math.max(position - seconds, 0));
  }

  forward(seconds: number = 10) {
    if (!this.playerElement.src) throw new Error("No file opened");

    const position = this.playerElement.currentTime;
    const duration = this.playerElement.duration;
    this.seekTo(duration && duration > 0 ? Math.min(position + seconds, duration) : position + seconds);
  }

  private async savePosition(currentTime: number) {
    if (!this.playerElement.src) return;
    await this.localStorage.set(`progress-${this.trackId}`, currentTime);
  }

  private log(message: string, ...args: any[]) {
    const time = this.playerElement?.currentTime ? Math.round(this.playerElement?.currentTime) : null;

    if (time) message += ` @${time}s`;

    console.log(`[PlayerController] ${message}`, ...args);
  }
}
