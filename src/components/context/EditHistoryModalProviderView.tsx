import React from 'react';
import {
  EditHistoryModalContextType,
  EditHistoryModalContext,
  EditHistoryModalProviderProps,
} from './EditHistoryModalProviderState';

// Provider component
export const EditHistoryModalProvider: React.FC<
  EditHistoryModalProviderProps
> = ({ children, showEditHistoryModal }) => {
  const contextValue: EditHistoryModalContextType = {
    showEditHistoryModal,
  };

  return (
    <EditHistoryModalContext.Provider value={contextValue}>
      {children}
    </EditHistoryModalContext.Provider>
  );
};
