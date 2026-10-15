// Lets `node --experimental-strip-types` run app modules outside React Native:
// resolves the `@/` alias and extensionless imports, and swaps native modules for shims.
import { register } from 'node:module';

globalThis.__DEV__ = false;
register('./hooks.mjs', import.meta.url);
