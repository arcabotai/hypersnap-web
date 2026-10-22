import React, { useRef, useCallback } from 'react';
import {
  ThreadChannelProps,
  ThreadState,
  ThreadActions,
  ThreadContextValue,
  defaultState,
  defaultActions,
  ThreadContext,
} from './ThreadContextState';

export function ThreadProvider({ children }: { children: React.ReactNode }) {
  const stateRef = useRef<ThreadState>(defaultState);
  const actionsRef = useRef<ThreadActions>(defaultActions);
  const channelPropsRef = useRef<ThreadChannelProps | null>(null);
  const listenersRef = useRef<Set<() => void>>(new Set());

  const notify = useCallback(() => {
    listenersRef.current.forEach((listener) => listener());
  }, []);

  const value = useRef<ThreadContextValue>({
    getThreadState: () => stateRef.current,
    getThreadActions: () => actionsRef.current,
    getChannelProps: () => channelPropsRef.current,
    setThreadState: (state: ThreadState) => {
      stateRef.current = state;
      notify();
    },
    setThreadActions: (actions: ThreadActions) => {
      actionsRef.current = actions;
      notify();
    },
    setChannelProps: (props: ThreadChannelProps) => {
      channelPropsRef.current = props;
      notify();
    },
    subscribe: (listener: () => void) => {
      listenersRef.current.add(listener);
      return () => {
        listenersRef.current.delete(listener);
      };
    },
  }).current;

  return (
    <ThreadContext.Provider value={value}>{children}</ThreadContext.Provider>
  );
}
