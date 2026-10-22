/**
 * ActionQueueContext - React context for action queue state
 *
 * Provides:
 * - Queue statistics (pending, processing, failed counts)
 * - Online/offline status (combines WebSocket + navigator.onLine)
 * - Automatic refresh on queue updates
 *
 * Online detection uses WebSocket connection state as primary signal
 * because navigator.onLine is unreliable on Wi-Fi disconnect in Chromium
 * browsers. See: offline-detection-and-optimistic-message-reliability.md under .agents/issues/
 *
 * See: background-action-queue.md under .agents/issues/
 */
import { createContext, useContext, ReactNode } from 'react';
import type { QueueStats } from '../../types/actionQueue';
import type { ActionQueueService } from '../../services/ActionQueueService';

// Context interface
export interface ActionQueueContextType {
  stats: QueueStats;
  isOnline: boolean;
  refreshStats: () => Promise<void>;
}

// Default stats
export const defaultStats: QueueStats = {
  pending: 0,
  processing: 0,
  failed: 0,
  completed: 0,
  total: 0,
};

// Context
export const ActionQueueContext = createContext<
  ActionQueueContextType | undefined
>(undefined);

// Hook
export const useActionQueue = () => {
  const context = useContext(ActionQueueContext);
  if (!context) {
    throw new Error('useActionQueue must be used within ActionQueueProvider');
  }
  return context;
};

// Provider props
export interface ActionQueueProviderProps {
  children: ReactNode;
  actionQueueService: ActionQueueService | null;
}
