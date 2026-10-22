// Public compatibility exports; component implementations have their own refresh boundary.
export type { RosterNameRow, IdentitySources } from './identityProviderState';
export {
  EMPTY_ROSTERS_BY_SPACE,
  selfLocalNameEntry,
  identityFromMaps,
  useIdentityContext,
} from './identityProviderState';
export { IdentityScopeProvider } from './identityProviderView';
