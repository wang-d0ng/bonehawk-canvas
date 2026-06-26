# Canvas Assignment Bot

API-first Instructure Canvas bot for reading courses, syllabi, assignments, deadlines, and producing a daily plan.

## What It Does

- Reads active Canvas courses with syllabus bodies.
- Reads course assignments with due dates, details, submission metadata, and Canvas links.
- Generates a daily report of what is due today, overdue, upcoming, undated, and syllabus-mentioned tasks.
- Sends the report to the console or email.
- Provides assignment instruction support and a UI-ready "do it for me" endpoint that creates a guided plan, outline, checklist, and starter template without submitting work.
- Serves the Open Design UI template from `public/` and hydrates it from the API when Canvas is configured.
- Supports a no-admin browser extension sync path for students whose schools do not provide OAuth developer keys.

## Setup

1. Copy `.env.example` to `.env`.
2. Set `CANVAS_BASE_URL`.
3. Start the app once. The home page will show first-time setup.
4. For no-admin student use, install the companion extension from `extension/` and sync from a logged-in Canvas tab.
5. For school/institution use, configure Canvas OAuth:
   - `CANVAS_CLIENT_ID`
   - `CANVAS_CLIENT_SECRET`
   - `CANVAS_REDIRECT_URI`
   - `OAUTH_STATE_SECRET`
6. For a local-only developer prototype, `CANVAS_ACCESS_TOKEN` still works as a fallback.
7. Choose `REPORT_CHANNEL=console` or `REPORT_CHANNEL=email`.
8. If using email, set the `SMTP_*` values and `REPORT_RECIPIENT_EMAIL`.

Canvas personal access tokens are only for local testing. Canvas documentation says multi-user apps must use OAuth instead of asking users to manually generate tokens.

## Commands

```bash
npm install
npm run dev
npm test
npm run test:coverage
npm run build
npm run desktop:dev
npm run desktop:dist
```

## Desktop App

The Electron desktop app wraps the same local Canvas Workbench server in a native window.

- Development launch: `npm run desktop:dev`
- macOS release build: `npm run desktop:dist`
- Output directory: `release/`

Desktop data is stored in the app user-data folder, not in the packaged app. The release build currently targets macOS Apple Silicon and is unsigned, so macOS may require opening it through Finder's security prompt the first time.

## API

- `GET /`
- `GET /health`
- `GET /api/auth/status`
- `GET /api/auth/canvas/start`
- `GET /api/auth/canvas/callback`
- `POST /api/auth/logout`
- `POST /api/import/canvas-snapshot`
- `DELETE /api/import/canvas-snapshot`
- `GET /api/courses`
- `GET /api/tasks`
- `GET /api/report/daily?date=2026-06-25`
- `POST /api/report/daily/send`
- `GET /api/assignments/:courseId/:assignmentId/instructions`
- `POST /api/assignments/:courseId/:assignmentId/do-it-for-me`

The service never returns Canvas access tokens. The no-admin extension uses the student’s existing Canvas browser session and does not ask for the student’s Canvas password.
