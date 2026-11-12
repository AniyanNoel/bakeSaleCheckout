/** An error whose message is safe and useful to show the person using the app. */
export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserError";
  }
}

export class ForbiddenError extends UserError {
  constructor(message = "Your account doesn't have permission to do that.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** Postgres unique-violation, e.g. a duplicate item code. */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = (err as { cause?: unknown })?.cause ?? err;
  const pg = e as { code?: string; constraint?: string };
  return pg?.code === "23505" && (!constraint || pg.constraint === constraint);
}
