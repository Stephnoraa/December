import type { Type } from '@nestjs/common';
import { OrderingModule } from './ordering/ordering.module';
import { PaymentsModule } from './payments/payments.module';
import { SetupModule } from './setup/setup.module';

/** Feature modules, registered in AppModule. */
export const FEATURE_MODULES: Type[] = [SetupModule, OrderingModule, PaymentsModule];
