import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { Logger } from "../logger";

describe("Logger", () => {
  let originalLog: typeof console.log;
  let originalError: typeof console.error;
  let captured: string[];

  beforeEach(() => {
    captured = [];
    originalLog = console.log;
    originalError = console.error;
    console.log = (msg: string) => captured.push(msg);
    console.error = (msg: string) => captured.push(msg);
  });

  afterEach(() => {
    console.log = originalLog;
    console.error = originalError;
  });

  test("defaults to info level when undefined", () => {
    const logger = new Logger(undefined);
    logger.debug("should not appear");
    expect(captured.length).toBe(0);

    logger.info("should appear");
    expect(captured.length).toBe(1);
  });

  test("defaults to info level for invalid string", () => {
    const logger = new Logger("invalid_level");
    logger.debug("hidden");
    expect(captured.length).toBe(0);

    logger.info("visible");
    expect(captured.length).toBe(1);
  });

  test("debug level shows all messages", () => {
    const logger = new Logger("debug");
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    expect(captured.length).toBe(4);
  });

  test("error level only shows errors", () => {
    const logger = new Logger("error");
    logger.debug("hidden");
    logger.info("hidden");
    logger.warn("hidden");
    logger.error("visible");
    expect(captured.length).toBe(1);
  });

  test("outputs valid JSON with expected fields", () => {
    const logger = new Logger("info");
    logger.info("test message", { key: "value" });
    expect(captured.length).toBe(1);

    const parsed = JSON.parse(captured[0]);
    expect(parsed.level).toBe("info");
    expect(parsed.message).toBe("test message");
    expect(parsed.data).toEqual({ key: "value" });
    expect(typeof parsed.timestamp).toBe("string");
  });

  test("omits data field when no data provided", () => {
    const logger = new Logger("info");
    logger.info("no data");
    const parsed = JSON.parse(captured[0]);
    expect(parsed.data).toBeUndefined();
  });

  test("error level uses console.error", () => {
    let usedError = false;
    console.error = (msg: string) => {
      usedError = true;
      captured.push(msg);
    };

    const logger = new Logger("error");
    logger.error("err");
    expect(usedError).toBe(true);
  });

  test("warn level filters out debug and info", () => {
    const logger = new Logger("warn");
    logger.debug("hidden");
    logger.info("hidden");
    logger.warn("visible");
    logger.error("visible");
    expect(captured.length).toBe(2);
  });
});
