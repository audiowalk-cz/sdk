import { combineLatest, Subject, takeUntil } from "rxjs";
import { PlayerController } from "./player.controller";

export class MediaControlsController {
  private playerDetachEvent = new Subject<void>();

  setMetadata(metadata: MediaMetadataInit) {
    navigator.mediaSession.metadata = new MediaMetadata(metadata);
    navigator.mediaSession.playbackState = "paused";
    navigator.mediaSession.setActionHandler("play", () => console.log("play"));
  }

  attachPlayer(player: PlayerController) {
    this.detachPlayer();

    navigator.mediaSession.setActionHandler("play", () => player.play());
    navigator.mediaSession.setActionHandler("pause", () => player.pause());
    navigator.mediaSession.setActionHandler("seekbackward", () => player.back());
    navigator.mediaSession.setActionHandler("seekforward", () => player.forward());
    navigator.mediaSession.setActionHandler("previoustrack", () => player.back());
    navigator.mediaSession.setActionHandler("nexttrack", () => player.forward());
    navigator.mediaSession.setActionHandler("seekto", (details) => {
      // The fastSeek dictionary member will be true if the seek action is being called
      // multiple times as part of a sequence and this is not the last call in that sequence.
      if (details.fastSeek !== true && details.seekTime !== undefined) player.seekTo(details.seekTime);
    });

    player.status.pipe(takeUntil(this.playerDetachEvent)).subscribe((status) => {
      switch (status) {
        case "playing":
          navigator.mediaSession.playbackState = "playing";
          break;
        case "paused":
          navigator.mediaSession.playbackState = "paused";
          break;
      }
    });

    combineLatest([player.currentTime, player.totalTime])
      .pipe(takeUntil(this.playerDetachEvent))
      .subscribe(([currentTime, totalTime]) => {
        navigator.mediaSession.setPositionState({
          duration: totalTime || 0,
          position: currentTime || 0,
        });
      });
  }

  detachPlayer() {
    this.playerDetachEvent.next();

    navigator.mediaSession.setActionHandler("play", null);
    navigator.mediaSession.setActionHandler("pause", null);
    navigator.mediaSession.setActionHandler("previoustrack", null);
    navigator.mediaSession.setActionHandler("nexttrack", null);
  }

  clear() {
    this.detachPlayer();

    navigator.mediaSession.playbackState = "none";
    navigator.mediaSession.metadata = null;
  }
}
