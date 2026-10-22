import React, { useState, ReactNode } from 'react';
import {
  SidebarContextType,
  SidebarContext,
  SidebarProviderProps,
} from './SidebarProviderState';

// Provider component
export const SidebarProvider: React.FC<SidebarProviderProps> = ({
  children,
}) => {
  const [showRightSidebar, setShowRightSidebar] = useState(false);
  const [rightSidebarContent, setRightSidebarContent] =
    useState<ReactNode>(null);

  const contextValue: SidebarContextType = {
    showRightSidebar,
    setShowRightSidebar,
    rightSidebarContent,
    setRightSidebarContent,
  };

  return (
    <SidebarContext.Provider value={contextValue}>
      {children}
    </SidebarContext.Provider>
  );
};
