export interface Logger {
  info(event: string, data?: Record<string, unknown>): void;
  warn(event: string, data?: Record<string, unknown>): void;
  error(event: string, data?: Record<string, unknown>): void;
}

/** Structured JSON logs (visible in the Netlify function log). Never log card data or secrets. */
export const consoleLogger: Logger = {
  info: (event, data) => console.log(JSON.stringify({ level: 'info', event, ...data })),
  warn: (event, data) => console.warn(JSON.stringify({ level: 'warn', event, ...data })),
  error: (event, data) => console.error(JSON.stringify({ level: 'error', event, ...data })),
};

export const silentLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};
