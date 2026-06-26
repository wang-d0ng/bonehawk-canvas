import "dotenv/config";
import { startCanvasBotServer } from "./appRuntime.js";
import { loadEnv } from "./config/env.js";

const env = loadEnv();
const started = await startCanvasBotServer({ env });

console.log(`Canvas bot API listening on ${started.url}`);
