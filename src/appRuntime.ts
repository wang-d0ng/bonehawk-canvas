import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { CanvasOAuthService } from "./auth/canvasOAuthService.js";
import { FileTokenStore } from "./auth/tokenStore.js";
import { CanvasClient } from "./canvas/canvasClient.js";
import type { AppEnv } from "./config/env.js";
import { createApp } from "./api/app.js";
import { FileImportedCanvasStore } from "./import/importedCanvasStore.js";
import { createReporter } from "./reporters/createReporter.js";
import type { Reporter } from "./reporters/reporter.js";
import { startDailyReportScheduler } from "./scheduler/dailyReportScheduler.js";
import { AssignmentSupportService } from "./services/assignmentSupportService.js";
import { CanvasTaskService } from "./services/canvasTaskService.js";
import { FileUploadedSyllabusStore } from "./syllabi/uploadedSyllabusStore.js";

export interface StartCanvasBotServerOptions {
  env: AppEnv;
  port?: number;
  host?: string;
  publicDir?: string;
  enableScheduler?: boolean;
}

export interface StartedCanvasBotServer {
  server: Server;
  url: string;
  close(): Promise<void>;
}

export async function startCanvasBotServer(
  options: StartCanvasBotServerOptions
): Promise<StartedCanvasBotServer> {
  const runtime = createRuntimeServices(options.env);
  const app = createApp({
    env: options.env,
    taskService: runtime.taskService,
    supportService: runtime.supportService,
    reporter: runtime.reporter,
    authService: runtime.authService,
    importedCanvasStore: runtime.importedCanvasStore,
    uploadedSyllabusStore: runtime.uploadedSyllabusStore,
    publicDir: options.publicDir
  });
  const port = options.port ?? options.env.PORT;
  const host = options.host ?? "127.0.0.1";

  const server = await new Promise<Server>((resolve, reject) => {
    const listener = app.listen(port, host, () => resolve(listener));
    listener.once("error", reject);
  });
  const address = server.address();
  const actualPort = typeof address === "object" && address ? (address as AddressInfo).port : port;
  const scheduler = options.enableScheduler !== false && options.env.CANVAS_ACCESS_TOKEN
    ? startDailyReportScheduler(options.env.DAILY_REPORT_CRON, runtime.taskService, runtime.reporter)
    : undefined;

  return {
    server,
    url: `http://${host}:${actualPort}`,
    async close() {
      scheduler?.stop();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  };
}

function createRuntimeServices(env: AppEnv): {
  taskService: CanvasTaskService;
  supportService: AssignmentSupportService;
  reporter: Reporter;
  importedCanvasStore: FileImportedCanvasStore;
  uploadedSyllabusStore: FileUploadedSyllabusStore;
  authService?: CanvasOAuthService;
} {
  const canvasClient = new CanvasClient({
    baseUrl: env.CANVAS_BASE_URL,
    accessToken: env.CANVAS_ACCESS_TOKEN
  });
  const taskService = new CanvasTaskService(canvasClient);
  const supportService = new AssignmentSupportService(canvasClient);
  const reporter = createReporter(env);
  const importedCanvasStore = new FileImportedCanvasStore(env.IMPORT_STORE_PATH);
  const uploadedSyllabusStore = new FileUploadedSyllabusStore(env.SYLLABUS_STORE_PATH);
  const authService = env.CANVAS_CLIENT_ID
    ? new CanvasOAuthService(
        {
          canvasBaseUrl: env.CANVAS_BASE_URL,
          clientId: env.CANVAS_CLIENT_ID,
          clientSecret: env.CANVAS_CLIENT_SECRET,
          redirectUri: env.CANVAS_REDIRECT_URI
        },
        new FileTokenStore(env.TOKEN_STORE_PATH)
      )
    : undefined;

  return {
    taskService,
    supportService,
    reporter,
    importedCanvasStore,
    uploadedSyllabusStore,
    authService
  };
}
