import { BehaviorSubject, combineLatest, filter, interval, map, Subject, take, takeUntil } from "rxjs";
import { LocalStorageController } from "../storage/local-storage.controller";

export interface PlayerControllerOptions {
  autoSave?: boolean;
  audioElement?: HTMLAudioElement | null;
  loop?: boolean;
  fadeIn?: boolean;
  fadeOut?: boolean;
  fadeTime?: number;
  keepPlayer?: boolean;
  volume?: number;
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
  public readonly totalTime = new BehaviorSubject<number | null>(null);
  public readonly progress = combineLatest([this.currentTime, this.totalTime]).pipe(
    map(([currentTime, totalTime]) => (totalTime ? currentTime / totalTime : null))
  );

  public readonly status = new BehaviorSubject<PlayerStatus | null>(null);
  public readonly playing = this.status.pipe(map((status) => status === "playing"));

  private playerElement: HTMLAudioElement;

  private localStorage = new LocalStorageController({ prefix: "player" });

  private options: Required<PlayerControllerOptions>;

  private defaultOptions: Required<PlayerControllerOptions> = {
    fadeTime: 2000,
    audioElement: null,
    autoSave: false,
    loop: false,
    fadeIn: false,
    fadeOut: false,
    keepPlayer: false,
    volume: 1,
  };

  private destroyed = false;
  private destroyEvent = new Subject<void>();

  private volume: number = 1;

  private fadeCancelEvent = new Subject<void>();

  constructor(private trackId: string, trackUrl: string, options: PlayerControllerOptions = {}) {
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

      if (!this.options.fadeOut && !this.options.loop) {
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

    if (this.options.fadeOut && !this.options.loop) {
      combineLatest([this.currentTime, this.totalTime])
        .pipe(takeUntil(this.destroyEvent))
        .pipe(filter(([currentTime, totalTime]) => !!totalTime)) // track is loaded
        .pipe(filter(([currentTime, totalTime]) => currentTime >= totalTime! - this.options.fadeTime / 1000)) // crossfading should start
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

  async destroy(params: { now?: boolean; fadeOut?: boolean } = { now: false, fadeOut: this.options.fadeOut }) {
    this.log("Called destroy", params);

    this.destroyed = true;

    if (this.status.value !== PlayerStatus.ended) {
      await this.stop({ fadeOut: params.fadeOut });
      return this.destroyNow();
    }

    // if crossfade is enabled, we might be in stopped status but ending crossfade, so wait for the crossfade to finish
    if (this.playerElement.paused !== true) {
      this.log("Waiting for crossfade to finish destroying player");
      setTimeout(() => this.destroyNow(), this.options.fadeTime);
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
    await this.playerElement.play().catch(() => {});
    this.playerElement.pause();
    this.playerElement.volume = this.volume;

    this.log("Preloaded");
  }

  async play(params: { fadeIn?: boolean } = { fadeIn: this.options.fadeIn }) {
    if (!this.playerElement.src) throw new Error("No file opened");
    if (this.status.value === PlayerStatus.playing) return;

    this.log("Called play", params);

    this.fadeCancelEvent.next();

    await this.playerElement?.play();

    if (params.fadeIn) {
      await this.fadeIn();
    } else {
      this.playerElement.volume = this.volume;
    }

    return this;
  }

  async pause(params: { fadeOut?: boolean } = { fadeOut: this.options.fadeOut }) {
    if (!this.playerElement.src) throw new Error("No file opened");
    if (this.status.value === PlayerStatus.ended) return;

    this.log("Called pause", params);

    this.status.next(PlayerStatus.paused);
    this.onPause.next();

    this.fadeCancelEvent.next();

    if (params.fadeOut) {
      await this.fadeOut();
    }

    this.playerElement?.pause();
  }

  async stop(params: { fadeOut?: boolean } = { fadeOut: this.options.fadeOut }) {
    this.log("Called stop", params);

    if (!this.destroyed && this.status.value !== PlayerStatus.ended) {
      this.status.next(PlayerStatus.ended);
      this.onStop.next();
    }

    this.fadeCancelEvent.next();

    if (params.fadeOut) {
      await this.fadeOut();
    } else {
      this.playerElement.pause();
    }

    this.playerElement.currentTime = 0;
  }

  seekTo(seconds: number) {
    if (!this.playerElement.src) throw new Error("No file opened");
    if (this.status.value === PlayerStatus.ended) return;

    this.log("Called seekTo", seconds);
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

  private async fadeToVolume(targetVolume: number) {
    return new Promise<void>((resolve, reject) => {
      this.fadeCancelEvent.next();

      const fadeOutInterval = 100;
      const fadeOutSteps = this.options.fadeTime / fadeOutInterval;
      const fadeOutStep = (targetVolume - this.playerElement.volume) / fadeOutSteps;

      if (fadeOutStep === 0) return resolve();

      interval(fadeOutInterval)
        .pipe(takeUntil(this.fadeCancelEvent))
        .pipe(takeUntil(this.destroyEvent))
        .pipe(take(fadeOutSteps))
        .subscribe({
          next: () => {
            this.playerElement.volume = Math.max(0, Math.min(1, this.playerElement.volume + fadeOutStep));
          },
          error: (error) => reject(error),
          complete: () => {
            this.playerElement.volume = targetVolume;
            resolve();
          },
        });
    });
  }

  async fadeOut() {
    await this.fadeToVolume(0);
    this.playerElement.pause();
    this.playerElement.volume = this.volume;
  }

  async fadeIn() {
    this.playerElement.volume = 0.01;
    this.playerElement.play();
    await this.fadeToVolume(this.volume);
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
