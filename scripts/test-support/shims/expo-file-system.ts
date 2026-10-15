// In-memory subset of the expo-file-system `File` / `Directory` API the app uses.
export const files = new Map<string, string>();
const dirs = new Set<string>();

function join(parts: Array<string | { uri: string }>): string {
  return parts.map((part) => (typeof part === 'string' ? part : part.uri)).join('/');
}

export const Paths = { document: { uri: 'doc:' } };

export class Directory {
  uri: string;
  constructor(...parts: Array<string | { uri: string }>) {
    this.uri = join(parts);
  }
  get exists() {
    return dirs.has(this.uri);
  }
  create() {
    dirs.add(this.uri);
  }
  delete() {
    for (const key of [...files.keys()]) if (key.startsWith(`${this.uri}/`)) files.delete(key);
    for (const key of [...dirs]) if (key === this.uri || key.startsWith(`${this.uri}/`)) dirs.delete(key);
  }
}

export class File {
  uri: string;
  constructor(...parts: Array<string | { uri: string }>) {
    this.uri = join(parts);
  }
  get exists() {
    return files.has(this.uri);
  }
  create() {
    if (!files.has(this.uri)) files.set(this.uri, '');
  }
  write(content: string) {
    files.set(this.uri, content);
  }
  textSync() {
    return files.get(this.uri) ?? '';
  }
  async text() {
    return this.textSync();
  }
  delete() {
    files.delete(this.uri);
  }
  move(target: File) {
    files.set(target.uri, this.textSync());
    files.delete(this.uri);
  }
}
