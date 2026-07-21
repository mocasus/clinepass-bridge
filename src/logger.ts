export type LogMeta = Record<string, unknown>;

function emit(level: "info" | "warn" | "error", msg: string, meta?: LogMeta): void {
  const line = JSON.stringify({ level, time: new Date().toISOString(), msg, ...(meta ?? {}) });
  if (level === "error") console.error(line);
  else console.log(line);
}

export const logger = {
  info: (msg: string, meta?: LogMeta) => emit("info", msg, meta),
  warn: (msg: string, meta?: LogMeta) => emit("warn", msg, meta),
  error: (msg: string, meta?: LogMeta) => emit("error", msg, meta),
};

export type Logger = typeof logger;
