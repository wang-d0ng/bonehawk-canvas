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

### Student No-Admin Setup

1. Open the desktop app.
2. On the home page, open the first-time setup guide.
3. Install the companion extension from the app's `/extension/README.md` guide.
4. Log into Canvas in the browser like normal.
5. Click the extension sync button from a Canvas tab.
6. Return to the desktop app and refresh setup status.

The desktop app listens on `http://localhost:3000` so the extension can sync without Canvas developer keys, admin access, or student-generated API tokens.

### Developer / Institution Setup

1. Copy `.env.example` to `.env`.
2. Set `CANVAS_BASE_URL`.
3. Start the app once. The home page will show first-time setup.
4. For school/institution use, configure Canvas OAuth:
   - `CANVAS_CLIENT_ID`
   - `CANVAS_CLIENT_SECRET`
   - `CANVAS_REDIRECT_URI`
   - `OAUTH_STATE_SECRET`
5. For a local-only developer prototype, `CANVAS_ACCESS_TOKEN` still works as a fallback.
6. Choose `REPORT_CHANNEL=console` or `REPORT_CHANNEL=email`.
7. If using email, set the `SMTP_*` values and `REPORT_RECIPIENT_EMAIL`.

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

The extension guide and extension files are bundled into desktop builds. Use the in-app setup card to open the guide, check sync health, and reset local Canvas/syllabus data when testing.

## Release Readiness

Ready for real student use:

- No-admin Canvas sync through the companion extension.
- First-run setup health checks in the app.
- Local reset for imported Canvas data and uploaded syllabi.
- Desktop packaging with bundled UI and extension files.
- GitHub tag release workflow for unsigned macOS builds and extension ZIPs.

Still needed before broad public distribution:

- Apple Developer signing and notarization for smoother macOS installs.
- Chrome Web Store or Firefox Add-ons publishing for simpler extension install.
- Auto-update signing/channel setup.
- Privacy policy and support docs for stored local Canvas data.
- Windows packaging if non-Mac users are in scope.

## API

- `GET /`
- `GET /health`
- `GET /api/setup/health`
- `GET /api/auth/status`
- `GET /api/auth/canvas/start`
- `GET /api/auth/canvas/callback`
- `POST /api/auth/logout`
- `POST /api/import/canvas-snapshot`
- `DELETE /api/import/canvas-snapshot`
- `DELETE /api/local-data`
- `GET /api/courses`
- `GET /api/tasks`
- `GET /api/report/daily?date=2026-06-25`
- `POST /api/report/daily/send`
- `GET /api/calendar`
- `GET /api/syllabi`
- `POST /api/syllabi`
- `POST /api/syllabi/upload`
- `DELETE /api/syllabi/:id`
- `GET /api/assignments/:courseId/:assignmentId/instructions`
- `POST /api/assignments/:courseId/:assignmentId/do-it-for-me`

The service never returns Canvas access tokens. The no-admin extension uses the student’s existing Canvas browser session and does not ask for the student’s Canvas password.
