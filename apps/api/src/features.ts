import type { Type } from '@nestjs/common';
import { SetupModule } from './setup/setup.module';

/** Feature modules, registered in AppModule. */
export const FEATURE_MODULES: Type[] = [SetupModule];
