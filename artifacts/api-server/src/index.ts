import app from "./app";
import { logger } from "./lib/logger";
import { seedServiceCatalog } from "./lib/seed-dev";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function startServer(): Promise<void> {
  try {
    if (process.env.NODE_ENV === "development") {
      await seedServiceCatalog();
    }
    app.listen(port, (err) => {
      if (err) {
        logger.error({ err }, "Error listening on port");
        process.exit(1);
      }
      logger.info({ port }, "Server listening");
    });
  } catch (error) {
    logger.error({ error }, "Server startup failed");
    process.exit(1);
  }
}

void startServer();
