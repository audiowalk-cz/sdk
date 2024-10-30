import { NgModule } from "@angular/core";
import {StoryController} from "@audiowalk/sdk";

export interface AudiowalkModuleOptions{
    storyLogic: any;
}

@NgModule({})
export class AudiowalkModule {
    static forRoot(): ModuleWithProviders<GreetingModule> {
        return {
          ngModule: AudiowalkModule,
          providers: [
            {provide: StoryController, useValue:  }
          ]
        };
      }
}
