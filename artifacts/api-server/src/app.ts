import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import router from "./routes";
import { logger } from "./lib/logger";
import {
  authorizationServerMetadata,
  publicOrigin,
  protectedResourceMetadata,
} from "./lib/oauth";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";

const app: Express = express();
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
app.use(cors({ credentials: true, origin: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.get("/.well-known/oauth-protected-resource/api/mcp", (req, res): void => {
  try {
    const origin = publicOrigin(req);
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json(protectedResourceMetadata(origin));
  } catch {
    res.status(400).json({ error: "Invalid public request host." });
  }
});
app.get("/.well-known/oauth-authorization-server/api/oauth", (req, res): void => {
  try {
    const origin = publicOrigin(req);
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json(authorizationServerMetadata(origin));
  } catch {
    res.status(400).json({ error: "Invalid public request host." });
  }
});
app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

app.use("/api", router);

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ error }, "Unhandled request error");
  res.status(500).json({ error: "Internal server error" });
});

export default app;
