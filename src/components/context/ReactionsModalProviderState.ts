import { createContext, useContext, ReactNode } from 'react';
import type { Reaction } from '@quilibrium/quorum-shared';
import type { CustomEmoji } from '../emoji-picker/types';
import type { MemberInfo } from '../modals/ReactionsModal';

// Context interface
export interface ReactionsModalContextType {
  showReactionsModal: (config: {
    reactions: Reaction[];
    customEmojis: CustomEmoji[];
    members: Record<string, MemberInfo>;
    spaceId: string;
    channelId: string;
  }) => void;
}

// Context
export const ReactionsModalContext = createContext<
  ReactionsModalContextType | undefined
>(undefined);

// Hook
export const useReactionsModal = () => {
  const context = useContext(ReactionsModalContext);
  if (!context) {
    throw new Error(
      'useReactionsModal must be used within ReactionsModalProvider'
    );
  }
  return context;
};

// Provider props
export interface ReactionsModalProviderProps {
  children: ReactNode;
  showReactionsModal: (config: {
    reactions: Reaction[];
    customEmojis: CustomEmoji[];
    members: Record<string, MemberInfo>;
    spaceId: string;
    channelId: string;
  }) => void;
}
