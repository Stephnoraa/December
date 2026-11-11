import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { ENV, type Env } from '../config/env';
import { REDIS, type RedisHandle } from '../common/redis';
import { PaymentsService } from './payments.service';

/**
 * In-process scheduled work (no job queue in the MVP). With several API instances a short
 * Redis lock makes sure only one of them runs each tick.
 */
@Injectable()
export class PaymentsScheduler {
  private readonly logger = new Logger('Scheduler');
  private running = false;

  constructor(
    private readonly payments: PaymentsService,
    @Inject(REDIS) private readonly redis: RedisHandle,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private async claim(name: string, ttlMs: number): Promise<boolean> {
    if (!this.redis.client) return true;
    const res = await this.redis.client.set(
      `${this.env.redisKeyPrefix}:lock:${name}`,
      '1',
      'PX',
      ttlMs,
      'NX',
    );
    return res === 'OK';
  }

  @Interval('payments-reconcile', 60_000)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      if (!(await this.claim('payments-tick', 55_000))) return;
      const r = await this.payments.reconcile();
      const expired = await this.payments.expirePrepayOrders();
      if (r.checked || expired)
        this.logger.log(
          `reconciled ${r.checked} (confirmed ${r.confirmed}, failed ${r.failed}); expired ${expired} prepay orders`,
        );
    } catch (err) {
      this.logger.error(`Scheduled payment work failed: ${String(err)}`);
    } finally {
      this.running = false;
    }
  }
}
