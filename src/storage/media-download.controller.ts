import axios from "axios";
import { BehaviorSubject, Subject } from "rxjs";
import { FileStorageController, FileStorageControllerOptions } from "./file-storage.controller";
import { LocalStorageController } from "./local-storage.controller";

export interface MediaServiceOptions extends FileStorageControllerOptions {}

export enum DownloadStatus {
  Checking = "checking",
  NotDownloaded = "not-downloaded",
  Downloading = "downloading",
  Downloaded = "downloaded",
  Error = "error",
}

export interface MediaFileDefinition<TrackId extends string> {
  id: TrackId;
  url: string;
  mimeType: string;
}

export interface MediaFileDownloadMetadata {
  isDownloaded?: boolean;
  progress?: number | null;
}

export type MediaFile<TrackId extends string> = MediaFileDefinition<TrackId> & MediaFileDownloadMetadata;

export class MediaDownloadController<TrackId extends string> {
  downloadStatus = new BehaviorSubject<DownloadStatus>(DownloadStatus.NotDownloaded);
  downloadProgress = new BehaviorSubject<number>(0);

  fileStorage: FileStorageController;
  localStorage: LocalStorageController;

  tracks: Record<TrackId, MediaFile<TrackId>>;

  constructor(tracks: Record<TrackId, MediaFileDefinition<TrackId>>, private readonly options: MediaServiceOptions) {
    this.tracks = tracks;
    this.fileStorage = new FileStorageController(options);
    this.localStorage = new LocalStorageController();

    this.updateDownloadStatus();
  }

  async getFiles(): Promise<MediaFile<TrackId>[]> {
    return Promise.all(Object.values<MediaFile<TrackId>>(this.tracks).map((fileDef) => this.getFile(fileDef.id)));
  }

  async getFile(trackId: TrackId): Promise<MediaFile<TrackId>> {
    const trackDef = this.tracks[trackId];
    if (!trackDef) throw new Error(`Track ${trackId} not found`);

    const storedData = await this.fileStorage.get<ArrayBuffer>(trackDef.id).catch(() => null);
    const url = storedData ? URL.createObjectURL(new Blob([storedData], { type: trackDef.mimeType })) : trackDef.url;
    const isDownloaded = !!storedData;

    const progress = await this.localStorage
      .get<number>(`progress-${trackDef.id}`, (value): value is number => typeof value === "number")
      .catch(() => null);

    return { ...trackDef, url, progress, isDownloaded };
  }

  async updateDownloadStatus(): Promise<void> {
    this.downloadStatus.next(DownloadStatus.Checking);

    const downloadStatus = await this.getFiles()
      .catch(() => [])
      .then((tracks) => tracks.every((track) => track.isDownloaded));

    this.downloadStatus.next(downloadStatus ? DownloadStatus.Downloaded : DownloadStatus.NotDownloaded);
  }

  async downloadTracks() {
    const trackDefs = Object.values<MediaFile<TrackId>>(this.tracks);

    this.downloadStatus.next(DownloadStatus.Downloading);
    this.downloadProgress.next(0);

    try {
      for (let [i, track] of trackDefs.entries()) {
        const trackProgress = new Subject<number>();
        trackProgress.subscribe((progress) =>
          this.downloadProgress.next((i * 1) / trackDefs.length + progress / trackDefs.length)
        );

        await this.downloadTrack(track, trackProgress);
      }
      this.downloadStatus.next(DownloadStatus.Downloaded);
    } catch (e) {
      this.downloadStatus.next(DownloadStatus.Error);
    }
  }

  async deleteTracks() {
    const trackDefs = Object.values<MediaFile<TrackId>>(this.tracks);

    for (let [i, track] of trackDefs.entries()) {
      await this.fileStorage.delete(track.id).catch();
    }

    await this.updateDownloadStatus();
  }

  private async downloadTrack(trackDef: MediaFileDefinition<TrackId>, progress: Subject<number>) {
    console.debug("Downloading track", trackDef.id, trackDef.url);
    const res = await axios.get<ArrayBuffer>(trackDef.url, {
      responseType: "arraybuffer",
      onDownloadProgress: (e: any) => {
        if (e.total) progress.next(e.loaded / e.total);
      },
    });

    await this.fileStorage.put(trackDef.id, res.data);
  }
}
