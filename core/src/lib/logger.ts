type Level = "debug" | "info" | "warn" | "error";

const priority: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export class Logger {
  private readonly minLevel: Level;

  constructor(level: string | undefined) {
    this.minLevel = this.normalizeLevel(level);
  }

  debug(message: string, data?: unknown): void {
    this.log("debug", message, data);
  }

  info(message: string, data?: unknown): void {
    this.log("info", message, data);
  }

  warn(message: string, data?: unknown): void {
    this.log("warn", message, data);
  }

  error(message: string, data?: unknown): void {
    this.log("error", message, data);
  }

  private normalizeLevel(value: string | undefined): Level {
    if (value === "debug" || value === "info" || value === "warn" || value === "error") {
      return value;
    }
    return "info";
  }

  private log(level: Level, message: string, data?: unknown): void {
    if (priority[level] < priority[this.minLevel]) {
      return;
    }

    const payload = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(data === undefined ? {} : { data }),
    };

    const line = JSON.stringify(payload);
    if (level === "error") {
      console.error(line);
      return;
    }
    console.log(line);
  }
}
