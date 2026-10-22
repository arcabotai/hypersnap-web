import React, { createContext, useContext } from 'react';
import { EncryptedMessage } from '../../db/messages';
import { t } from '@lingui/core/macro';

export type MessageHandler = (message: EncryptedMessage) => Promise<void>;
export type OutboundMessage = () => Promise<string[]>;

interface WebSocketContextValue {
  connected: boolean;
  setMessageHandler: (handler: MessageHandler) => void;
  enqueueOutbound: (message: OutboundMessage) => void;
  flushOutbound: (timeoutMs?: number) => Promise<boolean>;
  setResubscribe: (resubscribe: () => Promise<void>) => void;
}

export const WebSocketContext = createContext<WebSocketContextValue | null>(
  null
);

export interface WebSocketProviderProps {
  children: React.ReactNode;
}

// Grace period before reporting disconnect (prevents flicker during reconnection)
export const DISCONNECT_GRACE_MS = 3000;

// How long flushOutbound() waits for the socket's own send buffer to drain, and
// how often it re-checks. Short: its only caller is tearing the page down.
export const FLUSH_TIMEOUT_MS = 3000;
export const FLUSH_POLL_MS = 25;

export function useWebSocket() {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error(t`useWebSocket must be used within a WebSocketProvider`);
  }
  return context;
}
