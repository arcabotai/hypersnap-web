// Public compatibility exports; component implementations have their own refresh boundary.
export type {
  FloatingPopoverProps,
  Placement,
  ReferenceType,
  VirtualElement,
} from './FloatingPopoverState';
export { FloatingPopover } from './FloatingPopoverView';
export { rectAnchor } from './FloatingPopoverState';
export { FloatingPopover as default } from './FloatingPopoverView';
