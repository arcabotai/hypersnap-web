import { createContext, useContext, ReactNode } from 'react';
import { ActiveDragItem, DropTarget } from '../hooks/business/ui/useDragState';

interface DragStateContextType {
  isDragging: boolean;
  setIsDragging: (dragging: boolean) => void;
  activeItem: ActiveDragItem | null;
  setActiveItem: (item: ActiveDragItem | null) => void;
  dropTarget: DropTarget | null;
  setDropTarget: (target: DropTarget | null) => void;
  isContextMenuOpen: boolean;
  setIsContextMenuOpen: (open: boolean) => void;
}

export const DragStateContext = createContext<DragStateContextType | undefined>(
  undefined
);

export interface DragStateProviderProps {
  children: ReactNode;
}

export const useDragStateContext = (): DragStateContextType => {
  const context = useContext(DragStateContext);
  if (context === undefined) {
    throw new Error(
      'useDragStateContext must be used within a DragStateProvider'
    );
  }
  return context;
};

/** Non-throwing variant for components that may render outside the provider. */
export const useOptionalDragStateContext = ():
  | DragStateContextType
  | undefined => useContext(DragStateContext);
