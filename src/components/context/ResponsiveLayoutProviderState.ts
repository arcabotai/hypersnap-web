import React, { createContext, useContext } from 'react';
import { ResponsiveLayoutState } from '../../hooks/useResponsiveLayout';

export const ResponsiveLayoutContext = createContext<
  ResponsiveLayoutState | undefined
>(undefined);

export interface ResponsiveLayoutProviderProps {
  children: React.ReactNode;
}

export const useResponsiveLayoutContext = (): ResponsiveLayoutState => {
  const context = useContext(ResponsiveLayoutContext);
  if (context === undefined) {
    throw new Error(
      'useResponsiveLayoutContext must be used within a ResponsiveLayoutProvider'
    );
  }
  return context;
};
