export class IntegrationError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 502) {
    super(message);
    this.name = 'IntegrationError';
    this.statusCode = statusCode;
  }
}
