export const EX = {
  OK: 0,
  GENERIC: 1,
  USAGE: 2,
  CONFIG: 3,
  NETWORK: 4,
  QA_FAIL: 5,
  INTERRUPT: 130,
};

export class CliError extends Error {
  constructor(message, exitCode = EX.GENERIC, cause) {
    super(message);
    this.exitCode = exitCode;
    if (cause) this.cause = cause;
  }
}
