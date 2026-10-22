import * as React from 'react';
import {
  useFloating,
  offset,
  flip,
  shift,
  hide,
  autoUpdate,
  useDismiss,
  useRole,
  useInteractions,
  FloatingPortal,
  FloatingFocusManager,
} from '@floating-ui/react';
import {
  FloatingPopoverProps,
  DEFAULT_GAP,
  DEFAULT_VIEWPORT_PADDING,
} from './FloatingPopoverState';

export const FloatingPopover: React.FC<FloatingPopoverProps> = ({
  open,
  onClose,
  anchor,
  placement = 'right-start',
  gap = DEFAULT_GAP,
  viewportPadding = DEFAULT_VIEWPORT_PADDING,
  manageFocus = true,
  zIndex = 9999,
  role = 'dialog',
  closeWhenAnchorHidden = true,
  closeOnScroll = false,
  positionViaLayout = false,
  dismissable = true,
  className,
  style,
  children,
}) => {
  // Keep onClose identity-stable inside effects/callbacks: callers often pass
  // a fresh closure each render, which would otherwise re-arm listeners and
  // can fire close spuriously. We read the latest via a ref.
  const onCloseRef = React.useRef(onClose);
  React.useEffect(() => {
    onCloseRef.current = onClose;
  });

  const { refs, floatingStyles, context, middlewareData } = useFloating({
    open,
    onOpenChange: (next) => {
      if (!next) onCloseRef.current();
    },
    placement,
    // 'fixed' positions relative to the viewport — the right strategy for a
    // body-portalled popover (immune to transformed/positioned ancestors and
    // to page scroll affecting the offset parent).
    strategy: 'fixed',
    // When the floating element animates its own transform, position via
    // top/left so the keyframe doesn't clobber floating-ui's translate.
    transform: !positionViaLayout,
    // Reference held in state (reactive) — the critical fix vs. setReference
    // in an effect. floating-ui sees the anchor the same render open flips.
    // The controlled `elements.reference` option is typed `Element` but
    // floating-ui supports virtual elements (any { getBoundingClientRect })
    // here at runtime — it only calls getBoundingClientRect for positioning.
    // Cast through the option's narrower type; `anchor` is validated as
    // HTMLElement | VirtualElement | null by the prop type.
    elements: { reference: (anchor ?? null) as Element | null },
    middleware: [
      offset(gap),
      // Flip handles BOTH axes:
      // - mainAxis: side flip (right↔left, top↔bottom) when the side is full.
      // - crossAxis + fallbackAxisSideDirection: when a *-start card near the
      //   bottom would extend past the viewport, flip its alignment so the
      //   card's bottom anchors to the trigger and it extends UPWARD — the
      //   whole card moves up to stay fully visible (no internal scroll).
      flip({
        padding: viewportPadding,
        crossAxis: true,
        fallbackAxisSideDirection: 'end',
      }),
      // Final clamp: slide along the cross-axis so any remaining overflow is
      // pulled back into the viewport. Runs after flip as the safety net.
      shift({ padding: viewportPadding }),
      // Reports when the anchor is scrolled out of view (referenceHidden) so
      // we can close — the card follows the anchor while visible and only
      // dismisses once it leaves the viewport.
      hide(),
    ],
    // Recompute position on scroll, resize and layout shifts. Default
    // autoUpdate (listener-based, no animationFrame polling) keeps the card
    // glued to the anchor as the list scrolls without the per-frame lag.
    whileElementsMounted: autoUpdate,
  });

  const dismiss = useDismiss(context, {
    // Gate both interceptions on `dismissable`: when the caller owns
    // visibility, useDismiss must not intercept (and stopPropagation) Escape /
    // outside-press — those belong to the caller's own handlers.
    enabled: dismissable,
    outsidePress: true,
    escapeKey: true,
  });
  const roleProps = useRole(context, { role });
  const { getFloatingProps } = useInteractions([dismiss, roleProps]);

  // Close once the anchor has scrolled fully out of view. Until then the card
  // stays pinned and follows the anchor (autoUpdate). referenceHidden is only
  // true when the anchor is genuinely off-screen, so normal reading scrolls
  // keep the card open. (Ignored when closeOnScroll handles scrolling.)
  const referenceHidden = middlewareData.hide?.referenceHidden;
  React.useEffect(() => {
    if (open && !closeOnScroll && closeWhenAnchorHidden && referenceHidden) {
      onCloseRef.current();
    }
  }, [open, closeOnScroll, closeWhenAnchorHidden, referenceHidden]);

  // Close on any scroll — for anchors inside a virtualized list whose items
  // move via transforms JS positioning can't track in lockstep. Capture phase
  // catches scrolls on nested scrollers (the message list), not just window.
  //
  // Scrolls from INSIDE the popover are exempt. Capture walks window →
  // document → target, so this one listener also sees the popover's own
  // scrollers even though it is portalled out of the anchor's subtree and
  // scroll events don't bubble. Without the exemption, a popover with
  // scrollable content dismisses itself the moment the user scrolls it — as
  // the emoji picker did, both on wheel and on the programmatic scroll its
  // category buttons issue.
  React.useEffect(() => {
    if (!open || !closeOnScroll) return;
    const handleScroll = (e: Event) => {
      const target = e.target as Node | null;
      if (target && refs.floating.current?.contains(target)) return;
      onCloseRef.current();
    };
    window.addEventListener('scroll', handleScroll, true);
    return () => window.removeEventListener('scroll', handleScroll, true);
  }, [open, closeOnScroll, refs.floating]);

  if (!open || !anchor) return null;

  // FloatingFocusManager inspects the reference element (isTypeableCombobox
  // calls getAttribute on it), so it only works with a real, connected DOM
  // element. A *virtual* element (point/caret/selection rect) has no
  // getAttribute and would crash it; a detached node would also misbehave.
  // Virtual-anchored surfaces have no real trigger to trap/return focus to
  // anyway, so use the focus manager only for connected DOM elements —
  // matching the pre-migration behaviour of the virtual-anchored surfaces.
  // (`anchor` is non-null here: the guard above already returned on !anchor.)
  const anchorIsElement = anchor instanceof Element && anchor.isConnected;
  const useFocusManager = manageFocus && anchorIsElement;

  const floating = (
    <div
      ref={refs.setFloating}
      style={{ ...floatingStyles, zIndex, ...style }}
      className={className}
      {...getFloatingProps()}
    >
      {children}
    </div>
  );

  return (
    <FloatingPortal>
      {useFocusManager ? (
        // returnFocus={false}: returning focus to the previous trigger on
        // close fights with switching to a new trigger and can re-open the
        // card (floating-ui issue #3366).
        <FloatingFocusManager
          context={context}
          modal={false}
          returnFocus={false}
        >
          {floating}
        </FloatingFocusManager>
      ) : (
        floating
      )}
    </FloatingPortal>
  );
};
