import React from 'react';
import {
  ThreadSettingsModalContext,
  ThreadSettingsModalProviderProps,
} from './ThreadSettingsModalProviderState';

export const ThreadSettingsModalProvider: React.FC<
  ThreadSettingsModalProviderProps
> = ({ children, openThreadSettings }) => {
  return (
    <ThreadSettingsModalContext.Provider value={{ openThreadSettings }}>
      {children}
    </ThreadSettingsModalContext.Provider>
  );
};
