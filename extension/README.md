# Canvas Workbench Sync Extension

This is the no-admin sync path.

Students do not need a Canvas Developer Key or personal API token. They:

1. Start Canvas Workbench locally at `http://localhost:3000`.
2. Open Chrome or Edge.
3. Go to `chrome://extensions`.
4. Enable **Developer mode**.
5. Click **Load unpacked**.
6. Select this `extension/` folder.
7. Open their Canvas dashboard and log in normally.
8. Click the Canvas Workbench Sync extension button.
9. Click **Sync Canvas to Workbench**.

The extension reads Canvas through the student’s existing browser session and sends courses, syllabi, assignments, due dates, and submission metadata to the local Workbench API.

It does not ask for, store, or transmit the student’s Canvas password.
