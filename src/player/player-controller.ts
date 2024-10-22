import { BehaviorSubject, map, Subject } from "rxjs";

export interface PlayerControllerOptions {
  file: string | null = null``;

  playOnInit: boolean = false;
  autoSave: boolean = true;

  title: string = "Bílý obraz";
  author: string = "Pomezí, z. s.";
  artwork: MediaImage[] = [];
  ticker: string;
}

export class PlayerController {
  public readonly onPlay = new Subject();
  public readonly onPause = new Subject();
  public readonly onStop = new Subject();
  public readonly onTime = new Subject<number>();

  public readonly status = new BehaviorSubject<MediaSessionPlaybackState>("none");

  public readonly playing = this.status.pipe(map((status) => status === "playing"));

  constructor(playerElement: HTMLAudioElement, options: PlayerControllerOptions) {
    this.createControls({
      title: options.title,
      artist: options.author,
      artwork: options.artwork,
    });

    this.status.subscribe((status) => {
      navigator.mediaSession.playbackState = status;
    });
  }

  ngAfterViewInit() {
    const position = localStorage.getItem(`progress-${this.file()}`);
    if (position && this.autoSave()) this.playerElement!.nativeElement.currentTime = parseFloat(position);

    if (this.playOnInit()) this.playerElement!.nativeElement.play();

    this.playerElement!.nativeElement.addEventListener("play", () => {
      this.onPlay.emit();
      this.status.set("playing");
    });

    this.playerElement!.nativeElement.addEventListener("pause", () => {
      this.onPause.emit();
      this.status.set("paused");
    });

    this.playerElement!.nativeElement.addEventListener("ended", () => {
      this.onStop.emit();
      this.status.set("none");
    });

    this.playerElement!.nativeElement.addEventListener("timeupdate", () => {
      navigator.mediaSession.setPositionState({
        duration: this.playerElement!.nativeElement.duration,
        playbackRate: this.playerElement!.nativeElement.playbackRate,
        position: this.playerElement!.nativeElement.currentTime,
      });

      this.onTime.emit(this.playerElement!.nativeElement.currentTime);

      this.savePosition(this.playerElement!.nativeElement.currentTime);
    });
  }

  private log(message: string) {
    const time = this.playerElement?.nativeElement.currentTime
      ? Math.round(this.playerElement?.nativeElement.currentTime)
      : null;

    if (time) message += ` @${time}s`;

    console.log(`[${WalkPlayerComponent.name}] ${message}`);
  }

  savePosition(currentTime: number) {
    localStorage.setItem(`progress-${this.file()}`, String(currentTime));
  }

  play() {
    this.log("Called play");
    this.playerElement?.nativeElement.play();
  }

  pause() {
    this.log("Called pause");
    this.playerElement?.nativeElement.pause();
  }

  seekTo(seconds: number) {
    if (!this.playerElement) return;
    this.log("Called seekTo");
    this.playerElement.nativeElement.currentTime = seconds;
  }

  back() {
    if (!this.playerElement) return;
    const position = this.playerElement.nativeElement.currentTime;
    this.seekTo(Math.max(position - 10, 0));
  }

  async forward() {
    if (!this.playerElement) return;
    const position = this.playerElement.nativeElement.currentTime;
    const duration = this.playerElement.nativeElement.duration;
    this.seekTo(duration && duration > 0 ? Math.min(position + 10, duration) : position + 10);
  }

  createControls(metadata: MediaMetadataInit) {
    navigator.mediaSession.metadata = new MediaMetadata(metadata);

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
  }
}
