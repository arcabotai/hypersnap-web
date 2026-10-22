import React from 'react';
import {
  ImageModalContextType,
  ImageModalContext,
  ImageModalProviderProps,
} from './ImageModalProviderState';

// Provider component
export const ImageModalProvider: React.FC<ImageModalProviderProps> = ({
  children,
  showImageModal,
}) => {
  const contextValue: ImageModalContextType = {
    showImageModal,
  };

  return (
    <ImageModalContext.Provider value={contextValue}>
      {children}
    </ImageModalContext.Provider>
  );
};
