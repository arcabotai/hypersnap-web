import { createContext, useContext, ReactNode } from 'react';
import type { Message as MessageType } from '@quilibrium/quorum-shared';

// Context interface
export interface EditHistoryModalContextType {
  showEditHistoryModal: (message: MessageType) => void;
}

// Context
export const EditHistoryModalContext = createContext<
  EditHistoryModalContextType | undefined
>(undefined);

// Hook
export const useEditHistoryModal = () => {
  const context = useContext(EditHistoryModalContext);
  if (!context) {
    throw new Error(
      'useEditHistoryModal must be used within EditHistoryModalProvider'
    );
  }
  return context;
};

// Provider props
export interface EditHistoryModalProviderProps {
  children: ReactNode;
  showEditHistoryModal: (message: MessageType) => void;
}
