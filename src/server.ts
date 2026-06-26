import "dotenv/config";
import { CanvasClient } from "./canvas/canvasClient.js";
import { loadEnv } from "./config/env.js";
import { createApp } from "./api/app.js";
import { CanvasOAuthService } from "./auth/canvasOAuthService.js";
import { FileTokenStore } from "./auth/tokenStore.js";
import { createReporter } from "./reporters/createReporter.js";
import { FileImportedCanvasStore } from "./import/importedCanvasStore.js";
import { startDailyReportScheduler } from "./scheduler/dailyReportScheduler.js";
import { AssignmentSupportService } from "./services/assignmentSupportService.js";
import { CanvasTaskService } from "./services/canvasTaskService.js";

const env = loadEnv();
const canvasClient = new CanvasClient({
  baseUrl: env.CANVAS_BASE_URL,
  accessToken: env.CANVAS_ACCESS_TOKEN
});
const taskService = new CanvasTaskService(canvasClient);
const supportService = new AssignmentSupportService(canvasClient);
const reporter = createReporter(env);
const importedCanvasStore = new FileImportedCanvasStore(env.IMPORT_STORE_PATH);
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
const app = createApp({ env, taskService, supportService, reporter, authService, importedCanvasStore });

app.listen(env.PORT, () => {
  console.log(`Canvas bot API listening on http://localhost:${env.PORT}`);
});

if (env.CANVAS_ACCESS_TOKEN) {
  startDailyReportScheduler(env.DAILY_REPORT_CRON, taskService, reporter);
}
