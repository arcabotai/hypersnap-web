// SECURITY: the membership/kicked GATE for message-body mention pills and
// (via `mapSenderToUser`) message headers. Reads ONLY the raw `members`
// roster passed into <MessageList> — never `src/identity`, which knows
// nothing about kicks and would silently let a kicked member's mention
// render as interactive again if this logic were ever routed through it.
//
// Pure and exported so it is unit-testable on its own (see
// `src/dev/tests/identity/migrated/MessageList.test.tsx`) without mounting
// the virtualized list. Answers ONLY "is this address a current, non-kicked
// member" — the NAME shown for a resolved mention comes from `src/identity`
// separately (`useNameResolver` in MessageMarkdownRenderer, `<MemberName>` /
// `useResolvedMemberName` in the header). Earlier this function's non-null
// branch returned `mapSenderToUser(senderId) ?? m` — an identity-enriched
// object — but every consumer only ever checked the result for null/non-null
// (see MessageMarkdownRenderer's `isResolved = resolvedUser != null`), so
// dropping the merge and returning the raw roster row is behaviorally
// identical for every caller while removing the gate's only dependency on
// the identity layer. Phase D row 22.
export function resolveMessageListSenderGate(
  members: Record<string, unknown>,
  senderId: string
): unknown | null {
  const m = members[senderId] as { isKicked?: boolean } | undefined;
  if (!m || m.isKicked) return null;
  return m;
}
