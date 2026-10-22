import { createContext, useContext, ReactNode } from 'react';

// Context interface
export interface ImageModalContextType {
  showImageModal: (imageUrl: string) => void;
}

// Context
export const ImageModalContext = createContext<
  ImageModalContextType | undefined
>(undefined);

// Hook
export const useImageModal = () => {
  const context = useContext(ImageModalContext);
  if (!context) {
    throw new Error('useImageModal must be used within ImageModalProvider');
  }
  return context;
};

// Provider props
export interface ImageModalProviderProps {
  children: ReactNode;
  showImageModal: (imageUrl: string) => void;
}
