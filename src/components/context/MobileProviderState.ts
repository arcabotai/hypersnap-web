import { createContext, useContext, ReactNode } from 'react';
import type { CustomEmoji } from '../emoji-picker/types';

// Mobile drawer configuration constants
export const MOBILE_DRAWER_CONFIG = {
  MAX_WIDTH: '480px',
  ANIMATION_DURATION: 300,
} as const;

/** Sticker type for mobile drawer (matches quorumApi.Sticker) */
interface DrawerSticker {
  id: string;
  name: string;
  imgUrl: string;
}

/** Typed data for the mobile emoji drawer */
export interface EmojiDrawerData {
  onEmojiClick: (emoji: string) => void;
  customEmojis: CustomEmoji[];
  /** When provided, the drawer shows an Emojis/Stickers tab bar */
  stickers?: DrawerSticker[];
  onStickerClick?: (stickerId: string) => void;
}

// Mobile state interface
interface MobileState {
  messageActionsDrawer: {
    isOpen: boolean;
    data?: any;
    isClosing: boolean;
  };
  emojiPickerDrawer: {
    isOpen: boolean;
    data?: EmojiDrawerData;
    isClosing: boolean;
  };
}

// Mobile actions
type MobileAction =
  | { type: 'OPEN_MESSAGE_ACTIONS'; data: any }
  | { type: 'CLOSE_MESSAGE_ACTIONS' }
  | { type: 'SET_MESSAGE_ACTIONS_CLOSING'; isClosing: boolean }
  | { type: 'OPEN_EMOJI_PICKER'; data: EmojiDrawerData }
  | { type: 'CLOSE_EMOJI_PICKER' }
  | { type: 'SET_EMOJI_PICKER_CLOSING'; isClosing: boolean };

// Initial state
export const initialMobileState: MobileState = {
  messageActionsDrawer: { isOpen: false, isClosing: false },
  emojiPickerDrawer: { isOpen: false, isClosing: false },
};

// Mobile reducer
export function mobileReducer(
  state: MobileState,
  action: MobileAction
): MobileState {
  switch (action.type) {
    case 'OPEN_MESSAGE_ACTIONS':
      return {
        ...state,
        messageActionsDrawer: {
          isOpen: true,
          data: action.data,
          isClosing: false,
        },
      };
    case 'CLOSE_MESSAGE_ACTIONS':
      return {
        ...state,
        messageActionsDrawer: {
          ...state.messageActionsDrawer,
          isOpen: false,
        },
      };
    case 'SET_MESSAGE_ACTIONS_CLOSING':
      return {
        ...state,
        messageActionsDrawer: {
          ...state.messageActionsDrawer,
          isClosing: action.isClosing,
        },
      };

    case 'OPEN_EMOJI_PICKER':
      return {
        ...state,
        // Close message actions drawer when opening emoji picker
        messageActionsDrawer: {
          isOpen: false,
          data: undefined,
          isClosing: false,
        },
        emojiPickerDrawer: {
          isOpen: true,
          data: action.data,
          isClosing: false,
        },
      };
    case 'CLOSE_EMOJI_PICKER':
      return {
        ...state,
        emojiPickerDrawer: {
          ...state.emojiPickerDrawer,
          isOpen: false,
        },
      };
    case 'SET_EMOJI_PICKER_CLOSING':
      return {
        ...state,
        emojiPickerDrawer: {
          ...state.emojiPickerDrawer,
          isClosing: action.isClosing,
        },
      };

    default:
      return state;
  }
}

// Context interface
export interface MobileContextType {
  state: MobileState;
  openMobileActionsDrawer: (messageData: any) => void;
  closeMobileActionsDrawer: () => void;
  openMobileEmojiDrawer: (emojiData: EmojiDrawerData) => void;
  closeMobileEmojiDrawer: () => void;
}

// Context
export const MobileContext = createContext<MobileContextType | undefined>(
  undefined
);

// Hook
export const useMobile = () => {
  const context = useContext(MobileContext);
  if (!context) {
    throw new Error('useMobile must be used within MobileProvider');
  }
  return context;
};

// Provider props
export interface MobileProviderProps {
  children: ReactNode;
}
