import { BehaviorSubject, Subject } from "rxjs";
import { LocalStorage } from "../storage/local-storage";

export interface StoryLogic<StoryState> {
  initialState: StoryState;
  validateState: (state: unknown) => state is StoryState;
  nextState: (state: StoryState) => StoryState;
}

export class StoryController<StoryState> {
  readonly state = new BehaviorSubject<StoryState | null>(null);

  readonly onStoryEnd = new Subject<void>();

  private readonly localStorage = new LocalStorage({ prefix: "story" });

  private readonly stateStorageKey = "state";

  constructor(private storyLogic: StoryLogic<StoryState>) {}

  async updateState(update: (state: StoryState) => StoryState) {
    const oldState = await this.loadState();
    const newState = update(oldState);
    await this.saveState(newState);

    this.state.next(newState);
  }

  async nextState() {
    const oldState = await this.loadState();
    const newState = this.storyLogic.nextState(oldState);
    await this.saveState(newState);

    this.state.next(newState);
  }

  async endStory() {
    this.onStoryEnd.next();
  }

  private async loadState(): Promise<StoryState> {
    try {
      const stateData = await this.localStorage
        .get(this.stateStorageKey)
        .then((data) => (data ? JSON.parse(data) : null));

      if (!stateData) return this.storyLogic.initialState;

      if (!this.storyLogic.validateState(stateData)) {
        throw new Error("Invalid state");
      }

      return stateData;
    } catch (error) {
      console.error("Story state is invalid", error);
      return this.storyLogic.initialState;
    }
  }

  private async saveState(state: StoryState) {
    await this.localStorage.set(this.stateStorageKey, state);
  }
}
