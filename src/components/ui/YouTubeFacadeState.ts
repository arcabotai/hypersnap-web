import React from 'react';

export interface YouTubeFacadeProps {
  videoId: string;
  /** Pre-resolved data URI for the thumbnail, or null to show plain link. */
  thumbnailSrc: string | null;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
  previewOnly?: boolean; // If true, shows only thumbnail without click-to-play functionality
}

// DOM persistence cache - tracks which videos are currently loaded as iframes
export const iframeStateCache = new Map<string, boolean>();

// Separate cache to track which videos should not autoplay on re-render
export const autoplayBlockCache = new Set<string>();

// Cleanup function to clear iframe state when component unmounts
export const clearYouTubeIframeState = (videoId: string) => {
  iframeStateCache.delete(videoId);
  autoplayBlockCache.delete(videoId);
};

// Get current iframe state
export const getYouTubeIframeState = (videoId: string): boolean => {
  return iframeStateCache.get(videoId) || false;
};

// Reset autoplay state (useful for testing or manual control)
export const resetYouTubeAutoplayState = (videoId: string) => {
  autoplayBlockCache.delete(videoId);
};
export { extractYouTubeVideoId } from '@quilibrium/quorum-shared';
