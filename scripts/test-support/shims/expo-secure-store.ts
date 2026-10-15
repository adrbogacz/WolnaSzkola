// In-memory SecureStore. `delayMs` makes every call yield, so tests can catch interleaved writes.
export const store = new Map<string, string>();
export const options = { delayMs: 0 };

async function tick() {
  if (options.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
}

export async function getItemAsync(key: string): Promise<string | null> {
  await tick();
  return store.get(key) ?? null;
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  await tick();
  store.set(key, value);
}

export async function deleteItemAsync(key: string): Promise<void> {
  await tick();
  store.delete(key);
}
