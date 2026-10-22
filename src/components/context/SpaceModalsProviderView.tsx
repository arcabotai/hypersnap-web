import React from 'react';
import {
  SpaceModalsContext,
  SpaceModalsProviderProps,
} from './SpaceModalsProviderState';

export const SpaceModalsProvider: React.FC<SpaceModalsProviderProps> = ({
  children,
  showAddSpaceModal,
  showCreateSpaceModal,
}) => (
  <SpaceModalsContext.Provider
    value={{ showAddSpaceModal, showCreateSpaceModal }}
  >
    {children}
  </SpaceModalsContext.Provider>
);
