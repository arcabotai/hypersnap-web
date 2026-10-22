import { createRoot } from 'react-dom/client';
import { Root } from './Root';
import '../src/index.scss';
import { installLogControl } from '../src/utils/productionLogControl';

// DM Doctor's warning counters must start counting at t=0, not whenever the
// /dev/dm-doctor page happens to be opened — so they install here, at the
// earliest point in app startup, rather than on page mount like the rest of
// src/dev/'s tools. The `process.env.NODE_ENV === 'development'` guard mirrors
// `lazyDevImport` in src/components/Router/Router.web.tsx: in a production
// build NODE_ENV is statically replaced with the literal "production", so this
// whole branch — including the dynamic import() call — is dead-code-eliminated
// at build time, never just skipped at runtime. web/vite.config.ts's
// `rolldownOptions.external` additionally excludes every module under
// `src/dev/` from production builds outright, so nothing here can ship even if
// this guard were somehow bypassed.
if (process.env.NODE_ENV === 'development') {
  import('../src/dev/dm-doctor/warningCounters').then((m) =>
    m.installDmWarningCounters()
  );
}

// Deliberately NOT behind a NODE_ENV guard, and deliberately not under src/dev/
// — unlike the block above, this is meant to ship. It is what makes production
// diagnostics reachable at all.
//
// The safety properties, and why a narrow wrapper is exposed rather than the
// logger itself, are documented once in src/utils/productionLogControl.ts.
// Do not restate them here; two copies drift.
if (typeof window !== 'undefined') {
  installLogControl(window as unknown as Record<string, unknown>);
}

createRoot(document.getElementById('root')!).render(<Root />);
