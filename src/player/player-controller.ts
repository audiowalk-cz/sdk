import { BehaviorSubject, combineLatest, filter, interval, map, Subject, takeUntil } from "rxjs";
import { LocalStorage } from "../storage/local-storage";

export class PlayerControllerOptions {
  autoSave?: boolean;
  audioElement?: HTMLAudioElement;
  loop?: boolean;
  crossfade?: boolean;
  crossfadeTime: number = 2000;
  initialVolume: number = 1;
  destroyOnStop: boolean = false;
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

  private trackId: string | null = null;

  public readonly status = new BehaviorSubject<PlayerStatus | null>(null);
  public readonly playing = this.status.pipe(map((status) => status === "playing"));

  private playerElement: Howl;

  private localStorage = new LocalStorage({ prefix: "player" });

  private options: PlayerControllerOptions;

  private destroyEvent = new Subject<void>();

  private volume: number = 1;

  private fadeCancelEvent = new Subject<void>();

  constructor(trackId: string, trackUrl: string, options: Partial<PlayerControllerOptions> = {}) {
    this.options = { ...new PlayerControllerOptions(), ...options };

    this.playerElement = new Howl({
      src: trackUrl,
      onplayerror: () => {
        this.playerElement.once("unlock", () => {
          this.playerElement.play();
        });
      },
    });

    this.playerElement.volume(this.volume);

    this.trackId = trackId;

    this.localStorage
      .get(`progress-${this.trackId}`, (value) => typeof value === "number")
      .then((position) => {
        if (position && this.options.autoSave) this.playerElement.seek(position);
      });

    this.playerElement.on("play", () => {
      this.onPlay.next();
      this.status.next(PlayerStatus.playing);
    });

    this.playerElement.on("pause", () => {
      this.onPause.next();
      this.status.next(PlayerStatus.paused);
    });

    this.playerElement.on("ended", () => {
      if (!this.options.crossfade && !this.options.loop) {
        this.onStop.next();
        this.status.next(PlayerStatus.ended);
      }
    });

    interval(100)
      .pipe(takeUntil(this.destroyEvent))
      .subscribe(() => {
        this.currentTime.next(this.playerElement.seek());
        this.totalTime.next(this.playerElement.duration());
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

    if (this.options.loop) {
      this.onStop.pipe(takeUntil(this.destroyEvent)).subscribe(() => {
        this.playerElement.seek(0);
        this.playerElement.play();
      });
    }

    this.log("Initialized player", trackId);
  }

  async destroy(now: boolean = false) {
    this.log("Called destroy", now ? "now" : "");

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
    this.playerElement.unload();
    this.playerElement.pause();
  }

  async play(params: { fade?: boolean } = { fade: this.options.crossfade }) {
    if (this.status.value === PlayerStatus.playing) return;

    this.log("Called play", params.fade ? "with fade" : "");

    if (params.fade) {
      this.playerElement.volume(0);
    }

    this.playerElement?.play();

    if (params.fade) {
      await this.fadeToVolume(this.volume);
    }
  }

  async pause() {
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
    this.playerElement.seek(0);

    if (this.options.destroyOnStop) this.destroyNow();
  }

  seekTo(seconds: number) {
    if (this.status.value === PlayerStatus.ended) return;

    this.log("Called seekTo");
    this.playerElement.seek(seconds);
  }

  async setVolume(volume: number, params: { fade?: boolean } = {}) {
    this.log("Called set volume", volume, params.fade ? "with fade" : "");

    this.volume = volume;

    if (params.fade) {
      await this.fadeToVolume(volume);
    } else {
      this.playerElement.volume(Math.max(Math.min(volume, 1), 0));
    }
  }

  async fadeToVolume(volume: number) {
    return new Promise<void>((resolve, reject) => {
      this.playerElement.fade(this.playerElement.volume(), volume, this.options.crossfadeTime);
      this.playerElement.on("fade", (id) => resolve());
    });
  }

  back(seconds: number = 10) {
    const position = this.playerElement.seek();
    this.seekTo(Math.max(position - seconds, 0));
  }

  forward(seconds: number = 10) {
    const position = this.playerElement.seek();
    const duration = this.playerElement.duration();
    this.seekTo(duration && duration > 0 ? Math.min(position + seconds, duration) : position + seconds);
  }

  private async savePosition(currentTime: number) {
    await this.localStorage.set(`progress-${this.trackId}`, currentTime);
  }

  private log(message: string, ...args: any[]) {
    const time = this.playerElement?.seek() ? Math.round(this.playerElement?.seek()) : null;

    if (time) args.push(`@${time}s`);

    console.log(`[PlayerController] ${message}`, ...args);
  }
}
