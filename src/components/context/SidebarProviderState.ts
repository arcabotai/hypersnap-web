import { createContext, useContext, ReactNode } from 'react';

// Sidebar state interface

// Context interface
export interface SidebarContextType {
  showRightSidebar: boolean;
  setShowRightSidebar: (show: boolean) => void;
  rightSidebarContent: ReactNode;
  setRightSidebarContent: (content: ReactNode) => void;
}

// Context
export const SidebarContext = createContext<SidebarContextType | undefined>(
  undefined
);

// Hook
export const useSidebar = () => {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error('useSidebar must be used within SidebarProvider');
  }
  return context;
};

// Provider props
export interface SidebarProviderProps {
  children: ReactNode;
}
