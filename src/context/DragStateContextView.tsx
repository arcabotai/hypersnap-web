import React from 'react';
import { useDragState } from '../hooks/business/ui/useDragState';
import {
  DragStateContext,
  DragStateProviderProps,
} from './DragStateContextState';

export const DragStateProvider: React.FC<DragStateProviderProps> = ({
  children,
}) => {
  const dragState = useDragState();

  return (
    <DragStateContext.Provider value={dragState}>
      {children}
    </DragStateContext.Provider>
  );
};
