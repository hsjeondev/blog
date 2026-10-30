import type { HTMLAttributes } from 'react';

// Only symbols used by this site are shipped. See public/icons/ionicons-LICENSE.txt.
export type IconName =
  | "arrow-back-outline"
  | "arrow-forward-outline"
  | "book-outline"
  | "checkmark-circle"
  | "checkmark-outline"
  | "chevron-back-outline"
  | "chevron-down-outline"
  | "chevron-forward"
  | "chevron-forward-outline"
  | "chevron-up-outline"
  | "close"
  | "close-outline"
  | "desktop-outline"
  | "document-text-outline"
  | "film-outline"
  | "hand-left-outline"
  | "headset-outline"
  | "help-circle-outline"
  | "information-circle-outline"
  | "menu-outline"
  | "moon-outline"
  | "musical-notes-outline"
  | "open-outline"
  | "pause"
  | "play"
  | "play-skip-back"
  | "play-skip-forward"
  | "search"
  | "search-outline"
  | "share-outline"
  | "share-social-outline"
  | "sunny-outline"
  | "swap-vertical-outline"
  | "sync-outline"
  | "volume-high-outline"
  | "volume-mute-outline";
type Props = HTMLAttributes<HTMLSpanElement> & { name: IconName; size?: 'small' | 'large' };

export default function Icon({ name, size, style, ...props }: Props) {
  const dimension = size === 'small' ? '.5em' : size === 'large' ? '2em' : '1em';
  return <span {...props} aria-hidden={props['aria-label'] ? undefined : (props['aria-hidden'] ?? true)} style={{ display: 'inline-block', height: dimension, width: dimension, visibility: 'inherit', fill: 'currentColor', boxSizing: 'content-box', stroke: 'currentColor', ...style }}>
    <svg viewBox="0 0 512 512" width="100%" height="100%" aria-hidden="true" focusable="false"><use href={`/icons/book-icons-1d814ced79.svg#${name}`} /></svg>
  </span>;
}
