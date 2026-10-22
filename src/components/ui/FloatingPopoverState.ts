import * as React from 'react';
import {
  type Placement,
  type ReferenceType,
  type VirtualElement,
} from '@floating-ui/react';

/**
 * FloatingPopover — the app's single trigger-anchored popover primitive.
 *
 * Wraps @floating-ui/react with the project's positioning defaults (gap,
 * flip, viewport shift) and the accessibility wiring (escape-to-close,
 * outside-click-to-close, dialog role, focus management) so that every
 * anchored floating surface gets the same behaviour from one place.
 *
 * First adopter: UserProfile (sidebar / mention / message-avatar / bookmarks).
 * Designed so the other anchored surfaces (emoji picker, mention dropdown,
 * context menu, icon picker, markdown toolbar) can migrate onto it later.
 *
 * Architecture note — why the anchor is passed through `elements.reference`
 * (held in state) rather than `refs.setReference` in an effect:
 * Floating UI requires the reference element to be REACTIVE so useDismiss /
 * useInteractions can reason about it and middleware can position against it
 * in the same render the popover opens. Wiring it via a useEffect defers it
 * by one render, which made the card mis-position on first paint and let
 * dismissal/visibility logic misfire (closing the card the instant it opened).
 * See floating-ui docs: "The elements must be held in state (not plain refs)".
 */

export interface FloatingPopoverProps {
  open: boolean;
  /** Called whenever the popover should close (outside press, escape). */
  onClose: () => void;
  /**
   * The trigger the popover is anchored to. Either a real DOM node (e.g.
   * captured from a click event) or a floating-ui *virtual element* — any
   * object exposing `getBoundingClientRect()`. Virtual elements let surfaces
   * anchor to a point or a measured rect that has no backing element, e.g. a
   * right-click position, a text-caret rect, or a text-selection rect. The
   * value is passed straight through to floating-ui's `elements.reference`,
   * which supports both natively.
   */
  anchor?: HTMLElement | VirtualElement | null;
  /** Preferred placement; flips automatically when it doesn't fit. */
  placement?: Placement;
  /** Gap in px between the anchor and the floating element. */
  gap?: number;
  /** Min distance in px the floating element keeps from the viewport edge. */
  viewportPadding?: number;
  /**
   * When true, manage focus inside the card while open. Defaults to true.
   * Focus is NOT returned to the trigger on close (returnFocus={false}) to
   * avoid a focus-return → re-open loop when switching between triggers.
   */
  manageFocus?: boolean;
  /** Stacking context for the portalled floating element. */
  zIndex?: number;
  /** ARIA role for the floating element. Defaults to 'dialog'. */
  role?: 'dialog' | 'menu' | 'listbox' | 'tooltip';
  /**
   * Close the popover once its anchor scrolls fully out of view. The card
   * stays pinned to the anchor while it's visible (following it as the list
   * scrolls) and only closes when the anchor leaves the viewport. Defaults to
   * true.
   */
  closeWhenAnchorHidden?: boolean;
  /**
   * Close the popover as soon as any scroll happens. Use for anchors inside a
   * virtualized list (react-virtuoso): those items move via CSS transforms
   * that JS positioning can't track in lockstep, so following them lags on
   * fast scroll. Closing on scroll (as Discord/Slack do) avoids the lag
   * entirely. Defaults to false (other surfaces follow the anchor instead).
   */
  closeOnScroll?: boolean;
  /**
   * Position the floating element via `top`/`left` instead of floating-ui's
   * default `transform: translate(...)`. Set this when the popover's own CSS
   * animates `transform` (e.g. a `scale()` open animation): a transform-based
   * keyframe would otherwise override floating-ui's positioning transform and
   * the element would animate from the viewport origin (0,0). Defaults to
   * false (transform positioning — slightly cheaper, fine for opacity-only or
   * non-animated surfaces). See floating-ui `useFloating({ transform })`.
   */
  positionViaLayout?: boolean;
  /**
   * Whether the popover dismisses itself on outside-press / Escape (floating-ui
   * useDismiss). Defaults to true. Set false when the caller fully owns
   * visibility (e.g. a composer that shows the surface based on selection/caret
   * state): useDismiss not only calls onClose but also calls
   * stopPropagation() on the Escape keydown, which would swallow Escape from
   * other handlers even though the caller's onClose is a no-op. Disabling it
   * leaves Escape/outside-press to the caller.
   */
  dismissable?: boolean;
  className?: string;
  /**
   * Extra inline styles merged onto the floating element. Use for sizing the
   * surface (e.g. a dynamic `width`); positioning and `zIndex` are owned by
   * the primitive and applied first, so avoid overriding `position`/`top`/
   * `left`/`transform` here.
   */
  style?: React.CSSProperties;
  children: React.ReactNode;
}

export const DEFAULT_GAP = 8;
export const DEFAULT_VIEWPORT_PADDING = 16;

/**
 * Build a floating-ui virtual element that anchors to a fixed rect — a point
 * (right-click, caret) or a measured region (text selection). Pass the result
 * as <FloatingPopover anchor>. The rect is captured by value, so callers should
 * memoize the call when the point/region is stable across renders.
 */
export function rectAnchor(rect: {
  x: number;
  y: number;
  width?: number;
  height?: number;
}): VirtualElement {
  const { x, y, width = 0, height = 0 } = rect;
  return {
    getBoundingClientRect: () => ({
      x,
      y,
      top: y,
      left: x,
      right: x + width,
      bottom: y + height,
      width,
      height,
    }),
  };
}
export type { Placement, ReferenceType, VirtualElement };
