import React, { useReducer } from 'react';
import MessageActionsDrawer from '../message/MessageActionsDrawer';
import EmojiPickerDrawer from '../message/EmojiPickerDrawer';
import {
  MOBILE_DRAWER_CONFIG,
  EmojiDrawerData,
  initialMobileState,
  mobileReducer,
  MobileContextType,
  MobileContext,
  MobileProviderProps,
} from './MobileProviderState';

// Provider component
export const MobileProvider: React.FC<MobileProviderProps> = ({ children }) => {
  const [state, dispatch] = useReducer(mobileReducer, initialMobileState);

  const handleCloseMessageActions = () => {
    dispatch({ type: 'SET_MESSAGE_ACTIONS_CLOSING', isClosing: true });
    setTimeout(() => {
      dispatch({ type: 'CLOSE_MESSAGE_ACTIONS' });
      dispatch({ type: 'SET_MESSAGE_ACTIONS_CLOSING', isClosing: false });
    }, MOBILE_DRAWER_CONFIG.ANIMATION_DURATION);
  };

  const handleCloseEmojiPicker = () => {
    dispatch({ type: 'SET_EMOJI_PICKER_CLOSING', isClosing: true });
    setTimeout(() => {
      dispatch({ type: 'CLOSE_EMOJI_PICKER' });
      dispatch({ type: 'SET_EMOJI_PICKER_CLOSING', isClosing: false });
    }, MOBILE_DRAWER_CONFIG.ANIMATION_DURATION);
  };

  const contextValue: MobileContextType = {
    state,
    openMobileActionsDrawer: (messageData: any) =>
      dispatch({ type: 'OPEN_MESSAGE_ACTIONS', data: messageData }),
    closeMobileActionsDrawer: handleCloseMessageActions,
    openMobileEmojiDrawer: (emojiData: EmojiDrawerData) =>
      dispatch({ type: 'OPEN_EMOJI_PICKER', data: emojiData }),
    closeMobileEmojiDrawer: handleCloseEmojiPicker,
  };

  return (
    <MobileContext.Provider value={contextValue}>
      {/* Render mobile drawers with z-[9999] for proper stacking */}
      {state.messageActionsDrawer.isOpen && state.messageActionsDrawer.data && (
        <div className="fixed inset-0 z-[9999] flex items-end justify-center bg-overlay backdrop-blur">
          <div
            className="w-full"
            style={{ maxWidth: MOBILE_DRAWER_CONFIG.MAX_WIDTH }}
          >
            <MessageActionsDrawer
              isOpen={!state.messageActionsDrawer.isClosing}
              message={state.messageActionsDrawer.data.message}
              onClose={handleCloseMessageActions}
              onReply={state.messageActionsDrawer.data.onReply}
              onCopyLink={state.messageActionsDrawer.data.onCopyLink}
              onCopyMessageText={
                state.messageActionsDrawer.data.onCopyMessageText
              }
              onDelete={state.messageActionsDrawer.data.onDelete}
              onPin={state.messageActionsDrawer.data.onPin}
              onReaction={state.messageActionsDrawer.data.onReaction}
              onMoreReactions={state.messageActionsDrawer.data.onMoreReactions}
              onEdit={state.messageActionsDrawer.data.onEdit}
              onViewEditHistory={
                state.messageActionsDrawer.data.onViewEditHistory
              }
              canDelete={state.messageActionsDrawer.data.canDelete}
              canEdit={state.messageActionsDrawer.data.canEdit}
              canViewEditHistory={
                state.messageActionsDrawer.data.canViewEditHistory
              }
              canPinMessages={state.messageActionsDrawer.data.canPinMessages}
              userAddress={state.messageActionsDrawer.data.userAddress}
              onDeleteWithConfirmation={
                state.messageActionsDrawer.data.onDeleteWithConfirmation
              }
              onPinWithConfirmation={
                state.messageActionsDrawer.data.onPinWithConfirmation
              }
              // Bookmark props
              isBookmarked={state.messageActionsDrawer.data.isBookmarked}
              onBookmarkToggle={
                state.messageActionsDrawer.data.onBookmarkToggle
              }
            />
          </div>
          <div
            className="fixed inset-0 -z-10"
            onClick={handleCloseMessageActions}
          />
        </div>
      )}

      {state.emojiPickerDrawer.isOpen && state.emojiPickerDrawer.data && (
        <div className="fixed inset-0 z-[10000] flex items-end bg-overlay backdrop-blur">
          <EmojiPickerDrawer
            isOpen={!state.emojiPickerDrawer.isClosing}
            onClose={handleCloseEmojiPicker}
            onEmojiClick={state.emojiPickerDrawer.data.onEmojiClick}
            customEmojis={state.emojiPickerDrawer.data.customEmojis}
            stickers={state.emojiPickerDrawer.data.stickers}
            onStickerClick={state.emojiPickerDrawer.data.onStickerClick}
          />
          <div
            className="fixed inset-0 -z-10"
            onClick={handleCloseEmojiPicker}
          />
        </div>
      )}

      {children}
    </MobileContext.Provider>
  );
};
