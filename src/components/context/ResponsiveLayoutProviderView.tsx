import React from 'react';
import { useResponsiveLayout } from '../../hooks/useResponsiveLayout';
import {
  ResponsiveLayoutContext,
  ResponsiveLayoutProviderProps,
} from './ResponsiveLayoutProviderState';

export const ResponsiveLayoutProvider: React.FC<
  ResponsiveLayoutProviderProps
> = ({ children }) => {
  const responsiveLayout = useResponsiveLayout();

  return (
    <ResponsiveLayoutContext.Provider value={responsiveLayout}>
      {children}
    </ResponsiveLayoutContext.Provider>
  );
};
