import { BehaviorSubject, distinctUntilChanged, map, Subject } from "rxjs";
import { LocalStorageController } from "../storage/local-storage.controller";

export interface BasicChapterDefinition<ChapterId extends string = string, StoryState extends {} = {}> {
  id: ChapterId;
  nextChapter: ChapterId | ((state: StoryState) => ChapterId) | ((state: StoryState) => Promise<ChapterId>) | null;
}

export interface BasicStoryState<ChapterId extends string = string> {
  currentChapter: ChapterId;
}

export interface StoryControllerOptions<StoryState> {
  stateStorageKey?: string;
  validateState?: (state: any) => state is StoryState;
}

export interface StoryDefinition<
  ChapterId extends string = string,
  StoryState extends { currentChapter?: ChapterId } = BasicStoryState<ChapterId>,
  ChapterDefinition extends BasicChapterDefinition<ChapterId, StoryState> = BasicChapterDefinition<
    ChapterId,
    StoryState
  >
> {
  chapters: Record<ChapterId, ChapterDefinition>;
  initialState: StoryState;
}

export class StoryController<
  ChapterId extends string = string,
  StoryState extends { currentChapter?: ChapterId } = BasicStoryState<ChapterId>,
  ChapterDefinition extends BasicChapterDefinition<ChapterId, StoryState> = BasicChapterDefinition<
    ChapterId,
    StoryState
  >
> {
  public readonly storyState = new BehaviorSubject<StoryState>({} as any);
  public readonly currentChapter = new BehaviorSubject<ChapterDefinition | null>(null);
  public readonly end = new Subject<void>();

  private readonly localStorage: LocalStorageController;

  private readonly stateStorageKey = "state";

  constructor(
    public readonly story: StoryDefinition<ChapterId, StoryState, ChapterDefinition>,
    private options: StoryControllerOptions<StoryState> = {}
  ) {
    this.localStorage = new LocalStorageController({ prefix: options.stateStorageKey ?? "story-state" });

    this.storyState
      .pipe(map((state) => state.currentChapter))
      .pipe(distinctUntilChanged())
      .pipe(map((currentChapter) => (currentChapter ? story.chapters[currentChapter] : null)))
      .subscribe(this.currentChapter);

    this.loadState().then((state) => {
      if (state) this.storyState.next(state);
      else this.setState(story.initialState);
    });
  }

  async setState(state: StoryState) {
    await this.saveState(state);
    this.storyState.next(state);
  }

  async updateState(update: Partial<StoryState> | ((state: StoryState) => StoryState)) {
    const oldState = (await this.loadState()) ?? this.storyState.value;
    let newState = oldState;

    if (typeof update === "function") {
      newState = update(oldState);
    } else if (typeof update === "object") {
      newState = { ...oldState, ...update };
    }

    this.setState(newState);
  }

  async setChapter(string: ChapterId) {
    this.updateState((state) => ({ ...state, currentChapter: string }));
  }

  async nextChapter() {
    const chapter = this.currentChapter.value;

    if (!chapter) return null;

    if (chapter.nextChapter === null) {
      return this.endStory();
    }

    if (typeof chapter.nextChapter === "string") {
      return this.setChapter(chapter.nextChapter);
    }

    if (typeof chapter.nextChapter === "function") {
      const storyState = this.storyState.value;
      const string = await chapter.nextChapter(storyState);

      return this.setChapter(string);
    }

    throw new Error(`Invalid nextChapter type in chapter ${chapter.id}`);
  }

  async resetStory() {
    await LocalStorageController.clearAll();
    await this.setState(this.story.initialState);
  }

  endStory() {
    this.end.next();
  }

  private async loadState(): Promise<StoryState | null> {
    try {
      const stateData = await this.localStorage.get(this.stateStorageKey, this.options.validateState);

      if (!stateData) return null;

      return stateData;
    } catch (error) {
      console.error("Story state is invalid", error);
      return null;
    }
  }

  private async saveState(state: StoryState) {
    await this.localStorage.set(this.stateStorageKey, state);
  }
}
