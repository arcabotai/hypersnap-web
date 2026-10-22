import React from 'react';
import {
  ConfirmationModalContextType,
  ConfirmationModalContext,
  ConfirmationModalProviderProps,
} from './ConfirmationModalProviderState';

// Provider component
export const ConfirmationModalProvider: React.FC<
  ConfirmationModalProviderProps
> = ({ children, showConfirmationModal }) => {
  const contextValue: ConfirmationModalContextType = {
    showConfirmationModal,
  };

  return (
    <ConfirmationModalContext.Provider value={contextValue}>
      {children}
    </ConfirmationModalContext.Provider>
  );
};
