import { BehaviorSubject, combineLatest, filter, interval, map, Subject, takeUntil, takeWhile } from "rxjs";
import { PartialBy } from "../helpers/objects";
import { LocalStorage } from "../storage/local-storage";

export interface PlayerControllerOptions {
  autoSave?: boolean;
  audioElement?: HTMLAudioElement;
  loop?: boolean;
  crossfade?: boolean;
  crossfadeTime: number;
  keepPlayer?: boolean;
  volume?: number;
}

export type PlayerControllerParams = PartialBy<PlayerControllerOptions, "crossfadeTime">;

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
  public readonly totalTime = new BehaviorSubject<number | null>(null);
  public readonly progress = combineLatest([this.currentTime, this.totalTime]).pipe(
    map(([currentTime, totalTime]) => (totalTime ? currentTime / totalTime : null))
  );

  public readonly status = new BehaviorSubject<PlayerStatus | null>(null);
  public readonly playing = this.status.pipe(map((status) => status === "playing"));

  private playerElement: HTMLAudioElement;

  private localStorage = new LocalStorage({ prefix: "player" });

  private options: PlayerControllerOptions;

  private defaultOptions: PlayerControllerOptions = {
    crossfadeTime: 2000,
  };

  private destroyEvent = new Subject<void>();

  private volume: number = 1;

  private fadeCancelEvent = new Subject<void>();

  constructor(private trackId: string, trackUrl: string, options: PlayerControllerParams = {}) {
    this.options = { ...this.defaultOptions, ...options };

    this.playerElement = this.options.audioElement ?? new Audio();

    this.volume = options.volume ?? this.volume;
    this.playerElement.volume = this.volume;

    this.playerElement.addEventListener("play", () => {
      this.onPlay.next();
      this.status.next(PlayerStatus.playing);
    });

    this.playerElement.addEventListener("pause", () => {
      this.onPause.next();
      this.status.next(PlayerStatus.paused);
    });

    this.playerElement.addEventListener("ended", () => {
      this.savePosition(0);

      if (!this.options.crossfade && !this.options.loop) {
        this.onStop.next();
        this.status.next(PlayerStatus.ended);
      }

      if (this.options.keepPlayer && !this.options.loop) {
        this.playerElement.currentTime = 0;
        this.playerElement.play();
        this.playerElement.pause();
      }

      if (this.options.loop) {
        this.playerElement.currentTime = 0;
        this.playerElement.play();
      }
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

    if (this.options.crossfade && !this.options.loop) {
      combineLatest([this.currentTime, this.totalTime])
        .pipe(takeUntil(this.destroyEvent))
        .pipe(filter(([currentTime, totalTime]) => !!totalTime)) // track is loaded
        .pipe(filter(([currentTime, totalTime]) => currentTime >= totalTime! - this.options.crossfadeTime / 1000)) // crossfading should start
        .subscribe(([currentTime, totalTime]) => {
          if (this.status.value !== PlayerStatus.ended) this.stop();
        });
    }

    this.open(trackUrl).then(() => {
      this.log("Initialized player", trackId);
    });
  }

  async open(file: string) {
    this.log("Called open", file);
    this.playerElement.src = file;

    const position = await this.localStorage.get(`progress-${this.trackId}`, (value) => typeof value === "number");

    if (position && this.options.autoSave) this.playerElement.currentTime = position;
    else this.playerElement.currentTime = 0;

    this.playerElement.volume = this.volume;
  }

  async destroy(now: boolean = false) {
    this.log("Called destroy" + (now ? "now" : ""));

    if (this.status.value !== PlayerStatus.ended) {
      await this.stop();
      return this.destroyNow();
    }

    // if crossfade is enabled, we might be ending crossfade just now, so wait for the crossfade to finish
    if (this.options.crossfade && now !== true) {
      setTimeout(() => this.destroyNow(), this.options.crossfadeTime);
    } else {
      this.destroyNow();
    }
  }

  private destroyNow() {
    this.log("Destroying player");
    this.destroyEvent.next();
    this.playerElement.src = "";
    this.playerElement.pause();
    this.playerElement.remove();
  }

  async preload() {
    this.log("Called preload");
    this.playerElement.volume = 0.01;
    this.playerElement.play().catch(() => {});
    this.playerElement.pause();
    this.playerElement.volume = this.volume;

    this.log("Preloaded");
  }

  async play(params: { fade?: boolean } = { fade: this.options.crossfade }) {
    if (!this.playerElement.src) throw new Error("No file opened");
    if (this.status.value === PlayerStatus.playing) return;

    this.log("Called play" + (params.fade ? "with fade" : ""));

    await this.playerElement?.play();

    if (params.fade) {
      this.playerElement.volume = 0.01;
      await this.fadeToVolume(this.volume);
    } else {
      this.playerElement.volume = this.volume;
    }
  }

  async pause() {
    if (!this.playerElement.src) throw new Error("No file opened");
    if (this.status.value === PlayerStatus.ended) return;

    this.log("Called pause");
    this.playerElement?.pause();
  }

  async stop(params: { fade?: boolean } = { fade: this.options.crossfade }) {
    this.log("Called stop", params.fade ? "with fade" : "");

    if (this.status.value !== PlayerStatus.ended) {
      this.status.next(PlayerStatus.ended);
      this.onStop.next();
    }

    if (params.fade) {
      await this.fadeToVolume(0);
    }

    this.playerElement.pause();
    this.playerElement.currentTime = 0;
  }

  seekTo(seconds: number) {
    if (!this.playerElement.src) throw new Error("No file opened");
    if (this.status.value === PlayerStatus.ended) return;

    this.log("Called seekTo");
    this.playerElement.currentTime = seconds;
  }

  async setVolume(volume: number, params: { fade?: boolean } = {}) {
    this.log("Called set volume", volume, params.fade ? "with fade" : "");

    this.volume = volume;

    if (params.fade) {
      await this.fadeToVolume(volume);
    } else {
      this.playerElement.volume = Math.max(Math.min(volume, 1), 0);
    }
  }

  async fadeToVolume(volume: number) {
    return new Promise<void>((resolve, reject) => {
      this.fadeCancelEvent.next();

      this.volume = volume;

      const fadeOutInterval = 100;
      const fadeOutStep = (this.volume - this.playerElement.volume) / (this.options.crossfadeTime / fadeOutInterval);

      if (fadeOutStep === 0) return resolve();

      interval(fadeOutInterval)
        .pipe(takeUntil(this.fadeCancelEvent))
        .pipe(takeUntil(this.destroyEvent))
        .pipe(takeWhile(() => Math.abs(this.playerElement.volume - this.volume) > Math.abs(fadeOutStep)))
        .subscribe({
          next: () => {
            this.playerElement.volume = Math.max(0, Math.min(1, this.playerElement.volume + fadeOutStep));
          },
          error: (error) => reject(error),
          complete: () => {
            this.playerElement.volume = this.volume;
            resolve();
          },
        });
    });
  }

  back(seconds: number = 10) {
    const position = this.playerElement.currentTime;
    this.seekTo(Math.max(position - seconds, 0));
  }

  forward(seconds: number = 10) {
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

    if (time) args.push(`@${time}s`);

    console.log(`[PlayerController: ${this.trackId}] ${message}`, ...args);
  }
}
