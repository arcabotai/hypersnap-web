import React from 'react';
import {
  ReactionsModalContextType,
  ReactionsModalContext,
  ReactionsModalProviderProps,
} from './ReactionsModalProviderState';

// Provider component
export const ReactionsModalProvider: React.FC<ReactionsModalProviderProps> = ({
  children,
  showReactionsModal,
}) => {
  const contextValue: ReactionsModalContextType = {
    showReactionsModal,
  };

  return (
    <ReactionsModalContext.Provider value={contextValue}>
      {children}
    </ReactionsModalContext.Provider>
  );
};
