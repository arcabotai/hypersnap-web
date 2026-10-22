import * as React from 'react';
import type { MemberIdentity } from '@quilibrium/quorum-shared';

// Stable reference for callers that pass no `locallyKnownNames` (every Space
// surface) — a fresh `{}` literal on every render would invalidate the
// provider's `sources`/`value` memo on every render for those callers.
export const EMPTY_LOCAL_NAMES: Record<string, string> = {};

/** The roster fields the identity needs. Mirrors SpaceMemberRow's name slots. */
export interface RosterNameRow {
  display_name?: string | null;
  global_display_name?: string | null;
}

/**
 * Stable reference for detached DM-shaped surfaces that always pass
 * `rostersBySpace={{}}` (a DM carries no spaceId — see `ConversationSettingsModal.tsx`,
 * `DirectMessage.tsx`) — same "avoid a fresh object every render" reasoning
 * as `EMPTY_LOCAL_NAMES` above. Exported so those call sites can import it
 * instead of writing the literal inline.
 */
export const EMPTY_ROSTERS_BY_SPACE: Record<
  string,
  Record<string, RosterNameRow>
> = {};

export interface IdentitySources {
  /** spaceId -> address -> roster row. Local, from messageDB.getSpaceMembers. */
  rostersBySpace: Record<string, Record<string, RosterNameRow>>;
  /**
   * address -> a QNS name PROVEN to belong to that address.
   *
   * ⚠️ There is deliberately NO profile object in here, and that is a security
   * property rather than a tidiness one. `primary_username` is a self-reported
   * CLAIM: it arrives inside someone else's profile and nothing upstream checks
   * it. While this interface carried the raw profile, every surface could read
   * the claim and render a `.q` for it, and desktop's single read did exactly
   * that — no check of any kind.
   *
   * Now an unverified claim has nowhere to live. Only `useVerifiedQnsNames` can
   * write this map, and only after resolving the name and deriving the claimed
   * owner's address back to the address the claim arrived with. A surface
   * cannot render a forged `.q` even by mistake, because there is nothing to
   * render it FROM — which is what makes "no surface forgot" provable rather
   * than hopeful.
   *
   * An address absent from this map is UNPROVEN, and that deliberately includes
   * not-yet-known: a lookup in flight yields no entry, so the global name
   * renders and only ever upgrades INTO a `.q`.
   */
  verifiedQnsNames: Record<string, string>;
  /**
   * address -> the display name from that address's public profile.
   *
   * Split out from the verified map because a display name carries no
   * ownership claim — nobody can own "Alice" — so it needs no lookup and must
   * not be delayed behind one.
   */
  profileGlobalNames: Record<string, string>;
  selfAddress: string | null;
  /**
   * address -> a name known LOCALLY, with no network round-trip. Fed by a
   * caller that already has this in memory — today that's a DM's
   * `Conversation.displayName` (learned from a peer broadcast or a decrypted
   * message frame; see `.agents/issues/2026-08-01-dm-partner-identity-lost-on-established-sessions.md`).
   * Spaces have a roster instead and pass `{}` here.
   *
   * LAST `globalName` tier, after the roster global slot and the fetched
   * profile: a published profile is authoritative when present, the local
   * name is what the peer told you directly (still real, just unverified),
   * and a truncated address is the fallback only when NOTHING knows a name.
   * This is design constraint 5 — DM identity must render from what's
   * already local, without waiting on a fetch — stated as data instead of
   * as a per-surface special case.
   */
  locallyKnownNames: Record<string, string>;
}

const nn = (v?: string | null): string | null => {
  const t = (v ?? '').trim();
  return t.length ? t : null;
};

/**
 * Self's entry for `IdentitySources.locallyKnownNames` — the device's own
 * `currentPasskeyInfo.displayName`, used ONLY as the LAST `globalName`
 * source, below the roster global slot and the published profile.
 *
 * Why this exists: self's identity deliberately stopped reading from
 * `currentPasskeyInfo` as a PRIMARY source (it carries no QNS name — see
 * `identityFromMaps`'s `isSelf` branch), which fixed four real bugs. But that
 * left self with only the fetched public profile as a name source, and
 * desktop never publishes a primary username — so a user whose public
 * profile carries no `display_name` had NO name source at all and fell to a
 * truncated address, in their own nav rail and their own DM messages. This
 * is the same shape as a DM partner's `locallyKnownNames` entry (see that
 * field's own docstring): a name known locally, with no network round-trip,
 * used as a last resort before the address — it can never supply a `.q`,
 * because a device display name is not a QNS name.
 *
 * Returns the stable `{}` reference when there is nothing to contribute, so
 * a caller building a provider's `locallyKnownNames` doesn't invalidate its
 * own memo on every render passing an entry that resolves to empty.
 */
export function selfLocalNameEntry(
  address: string | null | undefined,
  displayName: string | null | undefined
): Record<string, string> {
  const name = nn(displayName);
  if (!address || !name) return EMPTY_LOCAL_NAMES;
  return { [address]: name };
}

/**
 * Pure tier assembly. Kept separate from React so the merge is unit-testable
 * and so a virtualised list can resolve 200 rows from maps already in memory
 * without registering 200 query observers (design constraint 1).
 */
export function identityFromMaps(
  address: string,
  spaceId: string | undefined,
  sources: IdentitySources
): MemberIdentity {
  const row = spaceId ? sources.rostersBySpace[spaceId]?.[address] : undefined;

  return {
    address,
    // Only a real space context can have a per-space nickname.
    spaceName: nn(row?.display_name),
    // Already verified, or absent. This read used to be
    // `nn(profile?.primary_username)` — the raw claim, with no check of any
    // kind. The check now happens once, upstream, in `useVerifiedQnsNames`;
    // see `IdentitySources.verifiedQnsNames` for why it cannot live here.
    //
    // Self is not a special case. Its identity comes from its own public
    // profile like anyone else's (`currentPasskeyInfo` is the device-local auth
    // record and carries no QNS name), and self's own claim is verified on the
    // same path — a name you have not registered does not become yours because
    // you are the one looking.
    qnsName: nn(sources.verifiedQnsNames[address]),
    // Prefer the live roster global slot, then the published profile, then a
    // name known only locally (no fetch) — never a second, parallel lookup
    // path; this is the one place the tiers merge.
    globalName:
      nn(row?.global_display_name) ??
      nn(sources.profileGlobalNames[address]) ??
      nn(sources.locallyKnownNames[address]),
  };
}

export interface IdentityContextValue {
  sources: IdentitySources;
  /** Scope for call sites that do not pass a spaceId. */
  defaultSpaceId?: string;
  /** Ask for an address to be fetched if it is not already cached. */
  request: (address: string) => void;
}

export const IdentityContext = React.createContext<IdentityContextValue | null>(
  null
);

export const useIdentityContext = (): IdentityContextValue => {
  const ctx = React.useContext(IdentityContext);
  if (!ctx) {
    throw new Error(
      'useResolvedName/<MemberName> used outside <IdentityScopeProvider>. Wrap the route.'
    );
  }
  return ctx;
};

/**
 * Shallow merge of a flat `address -> value` map (`profiles`,
 * `locallyKnownNames`): `own` wins per key, `parent` fills in every key
 * `own` doesn't have an opinion on. Returns one of the two inputs UNCHANGED
 * (same reference) whenever the other side is empty — both `EMPTY_LOCAL_NAMES`
 * (this file) and the default `{}` a `useQueries`-backed `profiles` memo can
 * produce are already the "nothing to contribute" case every caller up the
 * tree treats as a stable reference; returning a fresh object here even when
 * merging with nothing would quietly reintroduce the per-render allocation
 * those memos exist to avoid.
 */
export function mergeFlat<T>(
  parent: Record<string, T>,
  own: Record<string, T>
): Record<string, T> {
  const parentKeys = Object.keys(parent);
  if (parentKeys.length === 0) return own;
  const ownKeys = Object.keys(own);
  if (ownKeys.length === 0) return parent;
  return { ...parent, ...own };
}

/**
 * Merge for `rostersBySpace` specifically — TWO levels (spaceId, then
 * address), not one shallow merge of the outer map. A shallow merge would
 * let `own`'s per-space roster REPLACE `parent`'s wholesale for any spaceId
 * both sides know about, which is exactly the shape of regression this fix
 * exists to prevent: `useMultiSpaceRosters` always sets `map[spaceId] = {}`
 * for a space whose query hasn't resolved yet (see that hook's own
 * docstring), so a child provider still loading its own roster for a space
 * the PARENT already finished loading would, under a shallow merge, blank
 * out every address the parent already knew for that one render — a
 * regression this fix would have introduced, not fixed. Merging per-address
 * instead means an empty-so-far child roster simply contributes nothing for
 * that space and the parent's rows keep showing until the child's own
 * fetch catches up; a child address that HAS loaded still wins over a
 * parent's for the same key (Channel's own roster read must win over root's
 * for Channel's own space).
 */
export function mergeRostersBySpace(
  parent: Record<string, Record<string, RosterNameRow>>,
  own: Record<string, Record<string, RosterNameRow>>
): Record<string, Record<string, RosterNameRow>> {
  const parentSpaceIds = Object.keys(parent);
  if (parentSpaceIds.length === 0) return own;
  const ownSpaceIds = Object.keys(own);
  if (ownSpaceIds.length === 0) return parent;

  const merged: Record<string, Record<string, RosterNameRow>> = { ...parent };
  for (const spaceId of ownSpaceIds) {
    const parentRoster = parent[spaceId];
    merged[spaceId] = parentRoster
      ? mergeFlat(parentRoster, own[spaceId])
      : own[spaceId];
  }
  return merged;
}
