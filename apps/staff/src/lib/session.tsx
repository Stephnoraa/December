import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, type ReactNode } from 'react';
import { hasPermission, type MeDto, type Permission } from '@app/shared';
import { ApiError, get, post } from './api';
import { resetSocket } from './socket';

interface SessionValue {
  me: MeDto;
  can: (p: Permission) => boolean;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function useMeQuery() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await get<MeDto>('/v1/auth/me');
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 60_000,
  });
}

export function SessionProvider({ me, children }: { me: MeDto; children: ReactNode }) {
  const qc = useQueryClient();
  const value: SessionValue = {
    me,
    can: (p) => hasPermission(me.staff.role, p),
    logout: async () => {
      await post('/v1/auth/logout').catch(() => undefined);
      resetSocket();
      qc.clear();
      window.location.assign('/');
    },
  };
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const v = useContext(SessionContext);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
}
