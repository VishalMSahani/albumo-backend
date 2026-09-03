type LogLevel = "debug" | "info" | "warn" | "error";
type LogMeta = Record<string, unknown>;

interface LogRecord extends LogMeta {
  level: LogLevel;
  time: string;
  msg: string;
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const configuredLevel = normalizeLevel(process.env.LOG_LEVEL);

export const logger = {
  debug(message: string, meta?: LogMeta): void {
    writeLog("debug", message, meta);
  },
  info(message: string, meta?: LogMeta): void {
    writeLog("info", message, meta);
  },
  warn(message: string, meta?: LogMeta): void {
    writeLog("warn", message, meta);
  },
  error(message: string, meta?: LogMeta): void {
    writeLog("error", message, meta);
  },
};

function writeLog(level: LogLevel, message: string, meta: LogMeta = {}): void {
  if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[configuredLevel]) return;

  const record: LogRecord = {
    ...serializeMeta(meta),
    level,
    time: new Date().toISOString(),
    msg: message,
  };

  const line = JSON.stringify(record);
  if (level === "error") {
    console.error(line);
    return;
  }

  if (level === "warn") {
    console.warn(line);
    return;
  }

  console.info(line);
}

function normalizeLevel(level: string | undefined): LogLevel {
  if (level === "debug" || level === "info" || level === "warn" || level === "error") {
    return level;
  }

  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

function serializeMeta(meta: LogMeta): LogMeta {
  const serialized: LogMeta = {};
  for (const [key, value] of Object.entries(meta)) {
    if (value instanceof Error) {
      serialized[key] = {
        name: value.name,
        message: value.message,
        stack: value.stack,
      };
      continue;
    }

    serialized[key] = value;
  }

  return serialized;
}
