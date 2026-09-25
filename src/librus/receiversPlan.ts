export const WIADOMOSCI_RECEIVER_TYPE_PATH = '/api/receivers/types?includeClass=true';

export function wiadomosciReceiverApiPaths(): string[] {
  return [WIADOMOSCI_RECEIVER_TYPE_PATH];
}

export function wiadomosciReceiverApiPathsHitPeople(paths: string[]): boolean {
  return paths.some((path) => /\/api\/receivers(\?|\/)/.test(path) && !path.includes('/api/receivers/types?'));
}
