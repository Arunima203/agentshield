import chalk from "chalk";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel: LogLevel =
  (process.env.LOG_LEVEL as LogLevel) ?? "info";

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[currentLevel];
}

function timestamp(): string {
  return new Date().toISOString();
}

function formatMessage(level: LogLevel, context: string, message: string): string {
  const ts = chalk.gray(timestamp());
  const ctx = chalk.cyan(`[${context}]`);

  switch (level) {
    case "debug":
      return `${ts} ${chalk.white("DEBUG")} ${ctx} ${message}`;
    case "info":
      return `${ts} ${chalk.green("INFO ")} ${ctx} ${message}`;
    case "warn":
      return `${ts} ${chalk.yellow("WARN ")} ${ctx} ${message}`;
    case "error":
      return `${ts} ${chalk.red("ERROR")} ${ctx} ${message}`;
  }
}

export const logger = {
  debug(context: string, message: string, meta?: unknown): void {
    if (!shouldLog("debug")) return;
    console.debug(formatMessage("debug", context, message));
    if (meta !== undefined) console.debug(meta);
  },

  info(context: string, message: string, meta?: unknown): void {
    if (!shouldLog("info")) return;
    console.info(formatMessage("info", context, message));
    if (meta !== undefined) console.info(meta);
  },

  warn(context: string, message: string, meta?: unknown): void {
    if (!shouldLog("warn")) return;
    console.warn(formatMessage("warn", context, message));
    if (meta !== undefined) console.warn(meta);
  },

  error(context: string, message: string, meta?: unknown): void {
    if (!shouldLog("error")) return;
    console.error(formatMessage("error", context, message));
    if (meta !== undefined) console.error(meta);
  },
};
