// A single error type carrying an HTTP status, so route handlers can `throw`
// and the central onError handler (app.ts) turns it into a clean JSON response.

export class HttpError extends Error {
  status: number;
  extra: Record<string, unknown> | null;

  constructor(status: number, message: string, extra?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.extra = extra || null;
  }
}
