import { useMutation, useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { errorMessage, get, post } from '../lib/api';
import { Alert, Button, CenteredMessage, Money } from '../components/ui';

/** Local-dev stand-in for Paystack checkout (mock payment provider only). */
export default function MockPay() {
  const { reference = '' } = useParams();
  const info = useQuery({
    queryKey: ['mock-pay', reference],
    queryFn: () =>
      get<{
        reference: string;
        amountKobo: number;
        email: string;
        venueName: string;
        status: string;
        callbackUrl: string | null;
      }>(`/v1/dev/mock-pay/${reference}`),
  });
  const done = (returnUrl: string | null) => window.location.assign(returnUrl ?? '/');
  const complete = useMutation({
    mutationFn: (body: { outcome: 'success' | 'failed'; channel: string }) =>
      post(`/v1/dev/mock-pay/${reference}/complete`, body),
    // Like Paystack: send the customer back to the callback URL given at initialize.
    onSuccess: () => done(info.data?.callbackUrl ?? null),
  });
  if (info.isLoading) return null;
  if (!info.data)
    return (
      <CenteredMessage title="Unknown payment">
        {info.error ? errorMessage(info.error) : null}
      </CenteredMessage>
    );
  return (
    <main className="mx-auto max-w-sm space-y-4 p-6">
      <Alert tone="amber">Test checkout (mock Paystack). No real money moves.</Alert>
      <div className="rounded-3xl bg-white p-5 text-center ring-1 ring-stone-200">
        <p className="text-stone-500">{info.data.venueName}</p>
        <p className="my-2 text-3xl font-bold">
          <Money kobo={info.data.amountKobo} />
        </p>
        <p className="text-sm text-stone-500">{info.data.email}</p>
      </div>
      {complete.error && <Alert>{errorMessage(complete.error)}</Alert>}
      <Button
        className="w-full"
        busy={complete.isPending}
        onClick={() => complete.mutate({ outcome: 'success', channel: 'card' })}
      >
        Pay with card (test)
      </Button>
      <Button
        variant="secondary"
        className="w-full"
        busy={complete.isPending}
        onClick={() => complete.mutate({ outcome: 'success', channel: 'bank_transfer' })}
      >
        Pay by bank transfer (test)
      </Button>
      <Button
        variant="ghost"
        className="w-full"
        busy={complete.isPending}
        onClick={() => complete.mutate({ outcome: 'failed', channel: 'card' })}
      >
        Decline (test)
      </Button>
    </main>
  );
}
