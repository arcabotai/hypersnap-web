import { createContext, useContext, ReactNode } from 'react';

interface SpaceModalsContextType {
  showAddSpaceModal: () => void;
  showCreateSpaceModal: () => void;
}

export const SpaceModalsContext = createContext<
  SpaceModalsContextType | undefined
>(undefined);

export const useSpaceModals = (): SpaceModalsContextType => {
  const ctx = useContext(SpaceModalsContext);
  if (!ctx) {
    throw new Error('useSpaceModals must be used within SpaceModalsProvider');
  }
  return ctx;
};

export interface SpaceModalsProviderProps {
  children: ReactNode;
  showAddSpaceModal: () => void;
  showCreateSpaceModal: () => void;
}
