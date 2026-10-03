import { Router, type IRouter } from "express";
import healthRouter from "./health";
import marketplaceRouter from "./marketplace";
import oauthRouter from "../lib/oauth";
import mcpRouter from "./mcp";

const router: IRouter = Router();

router.use(healthRouter);
router.use(marketplaceRouter);
router.use("/oauth", oauthRouter);
router.use(mcpRouter);

export default router;
