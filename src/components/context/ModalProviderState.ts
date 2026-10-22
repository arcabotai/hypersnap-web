import { createContext, useContext, ReactNode } from 'react';
import {
  type ModalState,
  type MuteUserTarget,
  type KickUserTarget,
  type BlockUserTarget,
} from '../../hooks/business/ui/useModalState';

// Context interface
export interface ModalContextType {
  state: ModalState;
  openUserSettings: () => void;
  closeUserSettings: () => void;
  openSpaceEditor: (
    spaceId: string,
    initialTab?: 'account' | 'general' | 'invites' | 'roles'
  ) => void;
  closeSpaceEditor: () => void;
  openChannelEditor: (
    spaceId: string,
    groupName: string,
    channelId: string
  ) => void;
  closeChannelEditor: () => void;
  openGroupEditor: (spaceId: string, groupName?: string) => void;
  closeGroupEditor: () => void;
  openLeaveSpace: (spaceId: string) => void;
  closeLeaveSpace: () => void;
  openNewDirectMessage: () => void;
  closeNewDirectMessage: () => void;
  openKickUser: (target: KickUserTarget) => void;
  closeKickUser: () => void;
  openMuteUser: (target: MuteUserTarget) => void;
  closeMuteUser: () => void;
  openBlockUser: (target: BlockUserTarget) => void;
  closeBlockUser: () => void;
  openConversationSettings: (conversationId: string) => void;
  closeConversationSettings: () => void;
  openFolderEditor: (folderId?: string) => void;
  closeFolderEditor: () => void;
  openNotifications: () => void;
  closeNotifications: () => void;
  // Legacy compatibility with existing useModalContext
  isNewDirectMessageOpen: boolean;
}

// Context
export const ModalContext = createContext<ModalContextType | undefined>(
  undefined
);

// Hook
export const useModals = () => {
  const context = useContext(ModalContext);
  if (!context) {
    throw new Error('useModals must be used within ModalProvider');
  }
  return context;
};

// Legacy hook for backward compatibility
export const useModalContext = () => {
  const context = useContext(ModalContext);
  if (!context) {
    throw new Error('useModalContext must be used within ModalProvider');
  }
  return context;
};

// Provider props
export interface ModalProviderProps {
  children: ReactNode;
  user?: any;
  setUser?: any;
}
