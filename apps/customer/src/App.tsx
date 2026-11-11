import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router';
import { MenuSkeleton } from './components/ui';
import { Home } from './pages/Home';
import { TablePage } from './pages/table/TablePage';

const Receipt = lazy(() => import('./pages/Receipt'));
const MockPay = lazy(() => import('./pages/MockPay'));

export function App() {
  return (
    <Suspense fallback={<MenuSkeleton />}>
      <Routes>
        <Route path="/t/:slug/:token" element={<TablePage />} />
        <Route path="/r/:token" element={<Receipt />} />
        <Route path="/mock-pay/:reference" element={<MockPay />} />
        <Route path="*" element={<Home />} />
      </Routes>
    </Suspense>
  );
}
