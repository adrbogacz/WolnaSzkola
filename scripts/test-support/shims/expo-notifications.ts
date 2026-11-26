// Records notifications instead of showing them.
export const scheduled: Array<{ content: { title?: string; body?: string; data?: unknown } }> = [];
export const AndroidImportance = { DEFAULT: 3 };
export function setNotificationHandler(): void {}
export async function scheduleNotificationAsync(request: { content: { title?: string; body?: string } }): Promise<string> {
  scheduled.push(request);
  return String(scheduled.length);
}
export async function getPermissionsAsync() {
  return { status: 'granted' };
}
export async function requestPermissionsAsync() {
  return { status: 'granted' };
}
export async function setNotificationChannelAsync(): Promise<void> {}
export function addNotificationResponseReceivedListener() {
  return { remove() {} };
}
export function getLastNotificationResponse() {
  return null;
}
export function clearLastNotificationResponse(): void {}
