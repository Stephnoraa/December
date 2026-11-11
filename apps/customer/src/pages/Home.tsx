import { CenteredMessage } from '../components/ui';

export function Home() {
  return (
    <CenteredMessage title="Scan the QR code on your table" icon="📱">
      Point your phone camera at the code on your table to see the menu and order.
    </CenteredMessage>
  );
}
