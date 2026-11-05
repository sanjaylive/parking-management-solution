'use client';
import { createContext, useContext } from 'react';

export interface AppCtxValue { facilityId?: string; setFacilityId: (id?: string) => void; me: any; facilities: any[]; live: boolean }
export const AppCtx = createContext<AppCtxValue>(null as any);
export const useApp = () => useContext(AppCtx);
