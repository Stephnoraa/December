import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { homeRouteForRole, Permission } from '@app/shared';
import { Layout } from './components/Layout';
import { Loading } from './components/ui';
import { AuthLanding, LoginPage, SignupPage } from './pages/auth/AuthPages';
import { SessionProvider, useMeQuery, useSession } from './lib/session';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Settings = lazy(() => import('./pages/Settings'));
const Stations = lazy(() => import('./pages/setup/Stations'));
const Tables = lazy(() => import('./pages/setup/Tables'));
const Menu = lazy(() => import('./pages/setup/Menu'));
const Staff = lazy(() => import('./pages/setup/Staff'));
const Floor = lazy(() => import('./pages/floor/Floor'));
const TableTab = lazy(() => import('./pages/floor/TableTab'));
const Station = lazy(() => import('./pages/station/Station'));
const Audit = lazy(() => import('./pages/Audit'));
const Platform = lazy(() => import('./pages/platform/Platform'));

function Guard({ permission, children }: { permission: Permission; children: React.ReactNode }) {
  const { can, me } = useSession();
  if (!can(permission)) return <Navigate to={homeRouteForRole(me.staff.role)} replace />;
  return <>{children}</>;
}

function Home() {
  const { me } = useSession();
  return <Navigate to={homeRouteForRole(me.staff.role)} replace />;
}

function StaffApp() {
  const me = useMeQuery();
  if (me.isLoading) return <Loading />;
  if (!me.data) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="*" element={<AuthLanding />} />
      </Routes>
    );
  }
  return (
    <SessionProvider me={me.data}>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Home />} />
            <Route
              path="/dashboard"
              element={
                <Guard permission={Permission.DASHBOARD_VIEW}>
                  <Dashboard />
                </Guard>
              }
            />
            <Route
              path="/settings/*"
              element={
                <Guard permission={Permission.VENUE_SETTINGS}>
                  <Settings />
                </Guard>
              }
            />
            <Route
              path="/setup/stations"
              element={
                <Guard permission={Permission.STATIONS_MANAGE}>
                  <Stations />
                </Guard>
              }
            />
            <Route
              path="/setup/tables"
              element={
                <Guard permission={Permission.TABLES_MANAGE}>
                  <Tables />
                </Guard>
              }
            />
            <Route
              path="/setup/menu"
              element={
                <Guard permission={Permission.MENU_MANAGE}>
                  <Menu />
                </Guard>
              }
            />
            <Route
              path="/setup/staff"
              element={
                <Guard permission={Permission.STAFF_MANAGE}>
                  <Staff />
                </Guard>
              }
            />
            <Route
              path="/floor"
              element={
                <Guard permission={Permission.FLOOR_OPERATE}>
                  <Floor />
                </Guard>
              }
            />
            <Route
              path="/floor/sessions/:id"
              element={
                <Guard permission={Permission.FLOOR_OPERATE}>
                  <TableTab />
                </Guard>
              }
            />
            <Route
              path="/station"
              element={
                <Guard permission={Permission.STATION_OPERATE}>
                  <Station />
                </Guard>
              }
            />
            <Route
              path="/audit"
              element={
                <Guard permission={Permission.AUDIT_VIEW}>
                  <Audit />
                </Guard>
              }
            />
            <Route path="/login" element={<Home />} />
            <Route path="/signup" element={<Home />} />
            <Route path="*" element={<Home />} />
          </Route>
        </Routes>
      </Suspense>
    </SessionProvider>
  );
}

export function App() {
  const location = useLocation();
  if (location.pathname.startsWith('/platform')) {
    return (
      <Suspense fallback={<Loading />}>
        <Platform />
      </Suspense>
    );
  }
  return <StaffApp />;
}
