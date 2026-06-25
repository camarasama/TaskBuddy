'use client';

/**
 * contexts/SocketContext.tsx - M10 Phase 5
 *
 * Provides a Socket.io connection to all children of <SocketProvider>.
 * Connects automatically when user is authenticated; disconnects on logout.
 *
 * Room joining (handled by SocketService.ts on the server):
 *   family:{familyId}  - family-wide events (task:approved, etc.)
 *   user:{userId}      - user-specific events (notification:new, points:updated)
 *
 * Usage in any component:
 *   const { socket, isConnected } = useSocket();
 *   useEffect(() => {
 *     if (!socket) return;
 *     socket.on('task:approved', (data) => { ... });
 *     return () => { socket.off('task:approved'); };
 *   }, [socket]);
 */

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  ReactNode,
} from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from '@/contexts/AuthContext';
import { getAccessToken } from '@/lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SocketContextValue {
  /** The socket.io socket, or null before the first authenticated connection */
  socket: Socket | null;
  /** True when the WebSocket transport is in a connected state */
  isConnected: boolean;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const SocketContext = createContext<SocketContextValue>({
  socket: null,
  isConnected: false,
});

// ─── Provider ─────────────────────────────────────────────────────────────────

// Derive the socket server URL from the API base URL.
// If NEXT_PUBLIC_API_URL is absolute (http/https), strip the /api/v1 suffix.
// Otherwise default to localhost:3001 (the backend dev port).
const SOCKET_URL = (() => {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? '';
  if (apiUrl.startsWith('http')) return apiUrl.replace('/api/v1', '');
  return 'http://localhost:3001';
})();

export function SocketProvider({ children }: { children: ReactNode }) {
  const { user, isAuthenticated } = useAuth();
  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  const disconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
      setIsConnected(false);
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated || !user) {
      disconnect();
      return;
    }

    // Don't re-create if already connected for this user
    if (socketRef.current?.connected) return;

    const token = getAccessToken();

    const socket = io(SOCKET_URL, {
      // Auth payload - SocketService.ts uses this to join rooms on connection
      auth: { userId: user.id, familyId: user.familyId, token },
      transports: ['websocket', 'polling'],
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 8_000,
    });

    socket.on('connect', () => {
      console.log('[Socket] Connected:', socket.id);
      setIsConnected(true);
    });

    socket.on('disconnect', (reason) => {
      console.log('[Socket] Disconnected:', reason);
      setIsConnected(false);
    });

    let errorCount = 0;
    socket.on('connect_error', (err) => {
      errorCount++;
      if (errorCount === 1) {
        console.warn('[Socket] WebSocket unavailable, falling back to polling:', err.message);
      }
      // Suppress repeated errors - polling handles connectivity silently
    });

    socketRef.current = socket;

    return () => {
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, user?.id]);

  return (
    <SocketContext.Provider value={{ socket: socketRef.current, isConnected }}>
      {children}
    </SocketContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useSocket(): SocketContextValue {
  return useContext(SocketContext);
}
