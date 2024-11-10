import { BehaviorSubject, combineLatest, map, Subject, takeUntil } from "rxjs";
import { PartialBy } from "../helpers/objects";
import { LocalStorage } from "../storage/local-storage";

export interface PlayerControllerOptions {
  autoSave?: boolean;
  audioElement?: HTMLAudioElement;
  loop?: boolean;
  crossfade?: boolean;
  crossfadeTime: number;
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
  public readonly totalTime = new BehaviorSubject<number>(0);
  public readonly progress = combineLatest([this.currentTime, this.totalTime]).pipe(
    map(([currentTime, totalTime]) => currentTime / totalTime)
  );

  private trackId: string | null = null;

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

  constructor(trackId: string, trackUrl: string, options: PlayerControllerParams = {}) {
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

    if (!this.options.crossfade && !this.options.loop) {
      this.playerElement.addEventListener("ended", () => {
        this.onStop.next();
        this.status.next(PlayerStatus.ended);
      });
    }

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
        .subscribe(([currentTime, totalTime]) => {
          const crossfadeTime = this.options.crossfadeTime / 1000;

          if (currentTime >= totalTime - crossfadeTime) {
            this.playerElement.volume = (totalTime - currentTime) / crossfadeTime;

            if (this.status.value !== PlayerStatus.ended) {
              this.onStop.next();
              this.status.next(PlayerStatus.ended);
            }
          } else if (currentTime < crossfadeTime) {
            this.playerElement.volume = currentTime / crossfadeTime;
          } else {
            this.playerElement.volume = this.volume;
          }
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

  async destroy(now?: boolean) {
    if (this.options.crossfade) {
      // destroy later to enable fade out
      setTimeout(() => this.destroy(true), this.options.crossfadeTime);
    } else {
      this.destroyEvent.next();
      await this.pause();
      this.playerElement.remove();
    }
  }

  async play() {
    if (!this.playerElement.src) throw new Error("No file opened");

    this.log("Called play");
    await this.playerElement?.play();
  }

  async pause() {
    if (!this.playerElement.src) throw new Error("No file opened");
    if (this.status.value === PlayerStatus.ended) return;

    this.log("Called pause");
    this.playerElement?.pause();
  }

  setVolume(volume: number) {
    this.volume = volume;
    this.playerElement.volume = Math.max(Math.min(volume, 1), 0);
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
