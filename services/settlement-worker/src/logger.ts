import { Logger, logLevel } from "@conditional-stocks/shared";

export const logger = new Logger({
  service: "settlement-worker",
  level: logLevel(process.env.LOG_LEVEL),
});
