import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const shims = {
  'react-native': 'react-native.ts',
  'expo-secure-store': 'expo-secure-store.ts',
  'expo-file-system': 'expo-file-system.ts',
};

function withExtension(candidate) {
  if (path.extname(candidate) && existsSync(candidate)) return candidate;
  for (const ext of ['.ts', '.tsx', '/index.ts']) {
    if (existsSync(candidate + ext)) return candidate + ext;
  }
  return null;
}

export async function resolve(specifier, context, next) {
  if (shims[specifier]) {
    return { url: pathToFileURL(path.join(root, 'scripts/test-support/shims', shims[specifier])).href, shortCircuit: true };
  }
  let candidate = null;
  if (specifier.startsWith('@/')) candidate = path.join(root, specifier.slice(2));
  else if (/^\.{1,2}\//.test(specifier) && context.parentURL?.startsWith('file:')) {
    candidate = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
  }
  const found = candidate ? withExtension(candidate) : null;
  if (found) return { url: pathToFileURL(found).href, shortCircuit: true };
  return next(specifier, context);
}

export async function load(url, context, next) {
  // The package is "type": "commonjs", but app sources are ES modules.
  if (url.startsWith('file:') && url.endsWith('.ts') && !url.includes('/node_modules/')) {
    return next(url, { ...context, format: 'module-typescript' });
  }
  return next(url, context);
}
