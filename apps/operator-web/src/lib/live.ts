'use client';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { API_URL, auth } from './api';

/** Subscribes to facility events; on any event invalidates queries. Polling stays on as a fallback. */
export function useLive(facilityId?: string) {
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    if (!facilityId) return;
    const s = io(`${API_URL}/live`, { auth: { token: auth.get()?.accessToken }, transports: ['websocket'] });
    s.on('connect', () => { setConnected(true); s.emit('subscribe', { facilityId }); });
    s.on('disconnect', () => setConnected(false));
    s.onAny(() => qc.invalidateQueries());
    return () => { s.disconnect(); };
  }, [facilityId, qc]);
  return connected;
}
