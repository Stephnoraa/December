import { Module, type Provider } from '@nestjs/common';
import { ENV, type Env } from '../config/env';
import { OrderingModule } from '../ordering/ordering.module';
import { MockPaymentProvider } from './mock.provider';
import { PaystackProvider } from './paystack.provider';
import {
  MockPayController,
  PayoutController,
  PublicPaymentsController,
  StaffPaymentsController,
  WebhooksController,
} from './payments.controller';
import { PaymentsScheduler } from './payments.scheduler';
import { PAYMENT_PROVIDER, PaymentsService } from './payments.service';

const providerFactory: Provider = {
  provide: PAYMENT_PROVIDER,
  inject: [ENV],
  useFactory: (env: Env) =>
    env.paymentsProvider === 'paystack'
      ? new PaystackProvider(env)
      : new MockPaymentProvider(
          env.PAYSTACK_SECRET_KEY ?? 'mock-webhook-secret',
          env.CUSTOMER_APP_URL,
        ),
};

@Module({
  imports: [OrderingModule],
  controllers: [
    PublicPaymentsController,
    WebhooksController,
    StaffPaymentsController,
    PayoutController,
    MockPayController,
  ],
  // The scheduler only ticks when ScheduleModule is registered (ENABLE_SCHEDULER=true).
  providers: [providerFactory, PaymentsService, PaymentsScheduler],
  exports: [PaymentsService, PAYMENT_PROVIDER],
})
export class PaymentsModule {}
