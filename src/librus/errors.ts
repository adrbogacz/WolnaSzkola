export class KlasowaError extends Error {
  status?: number;
  causeDetail?: unknown;

  constructor(message: string, status?: number, causeDetail?: unknown) {
    super(message);
    this.name = 'KlasowaError';
    this.status = status;
    this.causeDetail = causeDetail;
  }
}

export function messageFromUnknown(error: unknown): string {
  if (error instanceof KlasowaError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return 'Coś poszło nie tak. Spróbuj ponownie.';
}
