import * as React from 'react';
import { useQueries } from '@tanstack/react-query';
import { QuorumApiClient, isHandledFetchError } from '../api/baseTypes';
import type { PublicProfileResponse } from '../api/baseTypes';
import { publicProfileQueryKey } from '../hooks/business/user/useUserPublicProfile';
import {
  profileGlobalNamesFrom,
  useVerifiedQnsNames,
} from './useVerifiedQnsNames';
import {
  EMPTY_LOCAL_NAMES,
  RosterNameRow,
  IdentityContextValue,
  IdentityContext,
  mergeFlat,
  mergeRostersBySpace,
} from './identityProviderState';

export const IdentityScopeProvider: React.FunctionComponent<{
  /** The Space this subtree lives in, if any. Absent for DMs and global views.
   *  NOT inherited from an enclosing scope (see the MERGE note below) — a
   *  provider that doesn't pass this always resolves on the global ladder,
   *  regardless of what an ancestor's own `spaceId` happens to be. Every
   *  detached surface (bookmarks, notifications, search, reactions) relies
   *  on exactly this: it deliberately omits `spaceId` and expects the
   *  global ladder, even though the ROOT provider above it is, in App.tsx,
   *  always spaceId-less too — but a future ancestor scoped to a real Space
   *  must not leak its spaceId down into a sibling detached surface that
   *  never asked for it. */
  spaceId?: string;
  /** spaceId -> roster, already loaded by the caller (local IndexedDB read). */
  rostersBySpace: Record<string, Record<string, RosterNameRow>>;
  selfAddress: string | null;
  /** See `IdentitySources.locallyKnownNames`. Optional — Space surfaces have
   *  no local-name source and simply don't pass it. */
  locallyKnownNames?: Record<string, string>;
  children: React.ReactNode;
}> = ({
  spaceId,
  rostersBySpace,
  selfAddress,
  locallyKnownNames = EMPTY_LOCAL_NAMES,
  children,
}) => {
  // Addresses that asked for a profile and are not in a roster-only render.
  const [requested, setRequested] = React.useState<ReadonlySet<string>>(
    new Set()
  );
  const request = React.useCallback((address: string) => {
    if (!address) return;
    setRequested((prev) =>
      prev.has(address) ? prev : new Set(prev).add(address)
    );
  }, []);

  const addresses = React.useMemo(() => Array.from(requested), [requested]);

  const queries = useQueries({
    queries: addresses.map((address) => ({
      queryKey: publicProfileQueryKey(address),
      queryFn: async (): Promise<PublicProfileResponse | null> => {
        try {
          const response = await new QuorumApiClient().getPublicProfile(
            address
          );
          return response.data;
        } catch (error: unknown) {
          if (isHandledFetchError(error) && error.status === 404) return null;
          throw error;
        }
      },
      staleTime: 60 * 60 * 1000,
      gcTime: 24 * 60 * 60 * 1000,
      retry: false,
    })),
  });

  // `useQueries` returns a fresh array every render, so build the map from the
  // stable per-query data refs and memo on those — a naive dep on `queries`
  // invalidates every render and cascades through every consumer.
  const dataKey = queries.map((q) => q?.data ?? null);
  // Fingerprint on `dataUpdatedAt`, not on data presence: `setQueryData` (e.g.
  // useUserSettings.ts's self-profile-edit write) replaces the cached object
  // at an address that is ALREADY loaded — non-null before and after, so a
  // presence/truthy flag can't see the change. `dataUpdatedAt` is bumped by
  // every `setQueryData` write, so it is content-sensitive; it stays the same
  // number across renders where nothing changed, so it doesn't reintroduce
  // the fresh-array-every-render hazard the comment above guards against; and
  // joining it into one string keeps the deps array a constant two elements
  // regardless of how many addresses are requested (no variable-length spread).
  const updatedAtKey = queries.map((q) => q?.dataUpdatedAt ?? 0).join('|');
  const profiles = React.useMemo(() => {
    const map: Record<string, PublicProfileResponse | null> = {};
    addresses.forEach((a, i) => {
      map[a] = dataKey[i] ?? null;
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addresses, updatedAtKey]);

  // The two maps that replace the raw profile object. Derived HERE, at the one
  // point every profile this provider fetched passes through, so there is
  // exactly one place that can write a verified name.
  const profileGlobalNames = React.useMemo(
    () => profileGlobalNamesFrom(profiles),
    [profiles]
  );
  const verifiedQnsNames = useVerifiedQnsNames(profiles);

  React.useEffect(() => {
    if (selfAddress) request(selfAddress);
  }, [selfAddress, request]);

  // MERGE, not replace. `useContext` (not `useIdentityContext`) deliberately
  // — the ROOT provider (App.tsx) and any isolated test mount legitimately
  // have no ancestor, and that must degrade to "nothing to merge with", not
  // throw. Every OTHER provider in the app (Channel, DirectMessage,
  // BookmarksPage, ReactionsModal, GlobalNotificationsModal, MessagePreview,
  // SearchResults...) IS a descendant of the root provider (App.tsx mounts
  // it above the Router, which is above every ModalProvider/Layout host —
  // see App.tsx's own comment), so `parent` here is almost always at least
  // the root's own merged sources, recursively accumulated: each level only
  // ever merges with its DIRECT parent, which already carries everything
  // merged in above IT, so there is no need to walk further than one level.
  //
  // This is the structural fix for the recurring "provider mounted with
  // less data than the one above it" bug class (four rounds of it, found by
  // hand each time — see .agents/issues/2026-08-10-name-surfaces-that-never-
  // reached-the-resolver.md): a provider that forgets a tier, or whose own
  // fetch for a tier is still loading, now still resolves through whatever
  // its ANCESTOR already knows, instead of silently shadowing it with less.
  // A provider that DOES supply its own data for a given key keeps winning
  // over its ancestor for that key (see `mergeFlat`/`mergeRostersBySpace`),
  // so Channel's own roster for its own space is never shadowed by root's.
  const parent = React.useContext(IdentityContext);

  const mergedRostersBySpace = React.useMemo(
    () =>
      parent
        ? mergeRostersBySpace(parent.sources.rostersBySpace, rostersBySpace)
        : rostersBySpace,
    [parent, rostersBySpace]
  );
  const mergedVerifiedQnsNames = React.useMemo(
    () =>
      parent
        ? mergeFlat(parent.sources.verifiedQnsNames, verifiedQnsNames)
        : verifiedQnsNames,
    [parent, verifiedQnsNames]
  );
  const mergedProfileGlobalNames = React.useMemo(
    () =>
      parent
        ? mergeFlat(parent.sources.profileGlobalNames, profileGlobalNames)
        : profileGlobalNames,
    [parent, profileGlobalNames]
  );
  const mergedLocallyKnownNames = React.useMemo(
    () =>
      parent
        ? mergeFlat(parent.sources.locallyKnownNames, locallyKnownNames)
        : locallyKnownNames,
    [parent, locallyKnownNames]
  );

  const value = React.useMemo<IdentityContextValue>(
    () => ({
      sources: {
        rostersBySpace: mergedRostersBySpace,
        verifiedQnsNames: mergedVerifiedQnsNames,
        profileGlobalNames: mergedProfileGlobalNames,
        selfAddress,
        locallyKnownNames: mergedLocallyKnownNames,
      },
      defaultSpaceId: spaceId,
      request,
    }),
    [
      mergedRostersBySpace,
      mergedVerifiedQnsNames,
      mergedProfileGlobalNames,
      selfAddress,
      mergedLocallyKnownNames,
      spaceId,
      request,
    ]
  );

  return (
    <IdentityContext.Provider value={value}>
      {children}
    </IdentityContext.Provider>
  );
};
