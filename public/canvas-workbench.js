(function () {
  const api = {
    async get(path) {
      const response = await fetch(path, { headers: { Accept: "application/json" } });
      return parseApiResponse(response);
    },
    async post(path, payload) {
      const response = await fetch(path, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(payload || {})
      });
      return parseApiResponse(response);
    },
    async upload(path, formData) {
      const response = await fetch(path, {
        method: "POST",
        headers: { Accept: "application/json" },
        body: formData
      });
      return parseApiResponse(response);
    },
    async delete(path) {
      const response = await fetch(path, { method: "DELETE", headers: { Accept: "application/json" } });
      return parseApiResponse(response);
    }
  };

  const state = {
    tasks: [],
    selectedTask: null,
    calendarEvents: [],
    calendarCursor: new Date(),
    selectedCalendarDate: toDateKey(new Date())
  };
  const FOCUS_STORAGE_KEY = "canvas-workbench.focusCourseIds";

  document.addEventListener("DOMContentLoaded", () => {
    hydrateAuthStatus();
    hydrateHome();
    hydrateOverview();
    hydrateOverviewTabs();
    hydrateCalendar();
    hydrateSyllabi();
    hydrateAssignments();
    hydrateTodo();
    hydrateDoItForMe();
  });

  async function hydrateAuthStatus() {
    const syncCard = document.querySelector(".sync-card");
    const setupCard = ensureSetupCard();

    try {
      const status = await api.get("/api/setup/health");
      const canvasHost = safeHost(status.canvasBaseUrl);
      if (syncCard) {
        const connected = status.connected || status.importConnected;
        syncCard.innerHTML = connected
          ? `<strong>Canvas synced</strong><span>${escapeHtml(status.snapshot.openAssignments)} open assignments from ${escapeHtml(canvasHost)}.</span>`
          : `<strong>No-admin sync</strong><span>Log into Canvas normally, then sync with the companion extension.</span><a class="button" href="#firstRunSetup">Setup sync</a>`;
      }
      if (setupCard) renderSetupCard(setupCard, status, canvasHost);
    } catch (error) {
      if (syncCard) syncCard.innerHTML = "<strong>Canvas setup needed</strong><span>Open the desktop app, then refresh setup status.</span>";
      if (setupCard) {
        setupCard.innerHTML = `<div class="setup-row"><div><h3>Canvas setup needed</h3><p>The app could not read setup status. Restart Bonehawk Canvas, then refresh this page.</p></div></div>`;
      }
    }
  }

  function ensureSetupCard() {
    const topbar = document.querySelector(".topbar");
    if (!topbar || document.querySelector("#firstRunSetup")) return document.querySelector("#firstRunSetup");

    const card = document.createElement("section");
    card.id = "firstRunSetup";
    card.className = "setup-card";
    card.setAttribute("aria-live", "polite");
    topbar.insertAdjacentElement("afterend", card);
    return card;
  }

  function renderSetupCard(card, status, canvasHost) {
    const canConnect = status.oauthConfigured;
    const connected = Boolean(status.connected || status.importConnected);
    const lastSynced = status.importedSyncedAt ? new Date(status.importedSyncedAt).toLocaleString() : "Not synced yet";
    card.classList.toggle("is-connected", connected);
    if (connected) {
      card.innerHTML = `
        <div class="setup-row">
          <div>
            <h3>Canvas is synced</h3>
            <p>The workbench can read open assignments, due dates, course names, submission state, and syllabus text from ${escapeHtml(canvasHost)}.</p>
          </div>
          <div class="setup-actions">
            <a class="button secondary" href="overview.html">Open report</a>
            <button class="button secondary" type="button" data-refresh-setup>Refresh</button>
          </div>
        </div>
        <div class="setup-checklist">
          ${setupCheck("Desktop app ready", true)}
          ${setupCheck("Canvas snapshot synced", status.importConnected, lastSynced)}
          ${setupCheck("Open assignments found", status.snapshot.openAssignments > 0, `${status.snapshot.openAssignments} open / ${status.snapshot.assignments} total`)}
          ${setupCheck("Uploaded syllabi indexed", status.syllabi.uploaded > 0, `${status.syllabi.uploaded} saved`)}
        </div>
        <div class="setup-meta">Setup complete · ${escapeHtml(status.snapshot.courses)} classes · ${escapeHtml(status.extension.syncUrl)}</div>
        <button class="link-button danger-link" type="button" data-reset-local-data>Reset local Canvas data</button>
      `;
      wireSetupActions(card);
      return;
    }

    card.innerHTML = `
      <div class="setup-row">
        <div>
          <h3>First-time setup: no admin required</h3>
          <p>Install the companion extension, log into Canvas normally, then click sync. The app will use that synced snapshot for reports, assignments, todos, and guided help.</p>
        </div>
        <div class="setup-actions">
          <a class="button" href="${escapeAttr(status.extension.guideUrl)}">Open sync guide</a>
          <button class="button secondary" type="button" data-refresh-setup>Refresh</button>
        </div>
      </div>
      <div class="setup-checklist">
        ${setupCheck("Desktop app ready", true)}
        ${setupCheck("Extension endpoint", true, status.extension.syncUrl)}
        ${setupCheck("Canvas snapshot synced", false, "Use the browser extension after logging into Canvas")}
        ${setupCheck("Reports unlocked", false, "Sync once to fill the homepage")}
      </div>
      <div class="setup-meta">Canvas host: ${escapeHtml(canvasHost)}${canConnect ? ` · optional school OAuth available at ${escapeHtml(status.connectUrl)}` : " · no school admin needed"}${status.prototypeTokenEnabled ? " · prototype token fallback enabled" : ""}</div>
    `;
    wireSetupActions(card);
  }

  function setupCheck(label, ready, detail) {
    return `
      <div class="setup-check ${ready ? "ready" : "pending"}">
        <span aria-hidden="true">${ready ? "OK" : "--"}</span>
        <div><strong>${escapeHtml(label)}</strong>${detail ? `<em>${escapeHtml(detail)}</em>` : ""}</div>
      </div>
    `;
  }

  function wireSetupActions(card) {
    card.querySelectorAll("[data-refresh-setup]").forEach((button) => {
      button.addEventListener("click", () => hydrateAuthStatus(), { once: true });
    });
    card.querySelectorAll("[data-reset-local-data]").forEach((button) => {
      button.addEventListener("click", async () => {
        if (!confirm("Reset synced Canvas data and uploaded syllabi on this computer?")) return;
        button.disabled = true;
        try {
          await api.delete("/api/local-data");
          localStorage.removeItem(FOCUS_STORAGE_KEY);
          await hydrateAuthStatus();
          await hydrateHome();
        } catch (error) {
          button.disabled = false;
          button.textContent = "Reset failed";
        }
      }, { once: true });
    });
  }

  async function hydrateHome() {
    const root = document.querySelector("[data-home-dashboard]");
    if (!root) return;

    try {
      const dashboard = await api.get(withFocus("/api/dashboard"));
      renderHomeDashboard(dashboard);
      wireHomeReportButton();
    } catch (error) {
      setText(document.querySelector("#homeReportTitle"), "Sync Canvas to build today's report");
      setText(document.querySelector("#reportState"), "The homepage will fill in after the extension sync completes.");
      renderEmptyReportItems("No Canvas data yet. Sync from Canvas, then refresh this page.");
    }
  }

  function renderHomeDashboard(dashboard) {
    const report = dashboard.report;
    const metrics = document.querySelectorAll(".metric-row .metric b");
    setText(metrics[0], report.summary.totalOpen);
    setText(metrics[1], report.summary.dueToday);
    setText(metrics[2], report.summary.overdue);
    setText(metrics[3], report.summary.upcoming);
    setText(document.querySelector(".topbar .eyebrow"), `Today - ${formatDate(report.reportDate)}`);
    setText(document.querySelector(".date-chip"), `Focused classes: ${dashboard.courseSummaries.length || dashboard.availableCourses.length}`);
    setText(document.querySelector(".status-pill"), dashboard.availableCourses.length ? "Live Canvas data" : "Setup needed");
    setText(document.querySelector("#homeReportTitle"), `Morning report for ${formatDate(report.reportDate)}`);
    renderHomeReportItems(report);
    renderCourseFocus(dashboard);
  }

  function renderHomeReportItems(report) {
    const tasks = [
      ...report.sections.overdue,
      ...report.sections.dueToday,
      ...report.sections.upcoming,
      ...report.sections.undated
    ].slice(0, 5);

    if (tasks.length === 0) {
      renderEmptyReportItems("No urgent open work found in the selected classes.");
      return;
    }

    const root = document.querySelector("#homeReportItems");
    if (!root) return;
    root.innerHTML = tasks.map((task) => {
      const dot = task.status === "overdue" || task.status === "missing" ? "danger" : task.status === "upcoming" ? "info" : "";
      return `<div class="report-item"><span class="dot ${dot}"></span><div><strong>${escapeHtml(task.title)}</strong><span>${escapeHtml(task.courseName)} - ${escapeHtml(task.action)}</span></div></div>`;
    }).join("");
  }

  function renderEmptyReportItems(message) {
    const root = document.querySelector("#homeReportItems");
    if (!root) return;
    root.innerHTML = `<div class="report-item"><span class="dot info"></span><div><strong>Report ready when Canvas is synced</strong><span>${escapeHtml(message)}</span></div></div>`;
  }

  function renderCourseFocus(dashboard) {
    const root = document.querySelector("#courseFocusList");
    if (!root) return;

    const selected = getFocusedCourseIds();
    const selectedSet = new Set(selected);
    const summaryByCourse = new Map(dashboard.courseSummaries.map((course) => [course.id, course]));
    const allSelected = selected.length === 0;

    root.innerHTML = dashboard.availableCourses.map((course) => {
      const summary = summaryByCourse.get(course.id);
      const checked = allSelected || selectedSet.has(course.id);
      const meta = summary
        ? `${summary.openTasks} open, ${summary.dueToday} due today, ${summary.overdue} overdue`
        : "Hidden from the current report";
      return `
        <label class="course focus-course">
          <input type="checkbox" value="${course.id}" ${checked ? "checked" : ""} />
          <b>${escapeHtml(course.name)}</b>
          <span>${escapeHtml(meta)}</span>
        </label>
      `;
    }).join("");

    root.querySelectorAll("input[type='checkbox']").forEach((input) => {
      input.addEventListener("change", () => {
        const checkedIds = Array.from(root.querySelectorAll("input[type='checkbox']:checked"))
          .map((entry) => Number.parseInt(entry.value, 10))
          .filter((id) => Number.isSafeInteger(id));
        saveFocusedCourseIds(checkedIds.length === dashboard.availableCourses.length ? [] : checkedIds);
        hydrateHome();
      });
    });
  }

  function wireHomeReportButton() {
    const button = document.querySelector("[data-home-dashboard] #sendReport");
    if (!button || button.dataset.wired === "true") return;
    button.dataset.wired = "true";
    button.addEventListener("click", async () => {
      button.disabled = true;
      button.textContent = "Sending report...";
      try {
        await api.post("/api/report/daily/send", focusPayload());
        setText(document.querySelector("#reportState"), "Daily report sent for the selected classes.");
        button.textContent = "Report sent";
      } catch (error) {
        setText(document.querySelector("#reportState"), "Could not send yet. Check Canvas sync and report settings.");
        button.textContent = "Send daily report";
        button.disabled = false;
      }
    });
  }

  async function hydrateOverview() {
    if (!document.querySelector("#sendReport") || !document.querySelector(".metric-grid")) return;

    try {
      const report = await api.get(withFocus("/api/report/daily"));
      const metrics = document.querySelectorAll(".metric b");
      setText(metrics[0], report.summary.totalOpen);
      setText(metrics[1], report.summary.dueToday);
      setText(metrics[2], report.summary.overdue);
      setText(metrics[3], report.summary.upcoming);
      setText(document.querySelector(".page-head .eyebrow"), `Generated at ${formatTime(report.generatedAt)}`);
      setText(document.querySelector(".page-head .lead"), `A real Canvas report for ${formatDate(report.reportDate)}, filtered to the classes selected on the homepage.`);
      renderOverviewTasks(report);
      renderSyllabus(report.sections.syllabusMentions || []);
      renderReportPreview(report);
    } catch (error) {
      setText(document.querySelector("#toast"), "Using preview data until Canvas is configured.");
    }

    document.querySelector("#sendReport")?.addEventListener("click", async () => {
      try {
        await api.post("/api/report/daily/send", focusPayload());
        setText(document.querySelector("#toast"), "Daily report sent through the configured channel.");
      } catch (error) {
        setText(document.querySelector("#toast"), "Report preview is active. Configure Canvas and email to send.");
      }
    });
  }

  function hydrateOverviewTabs() {
    const tabs = Array.from(document.querySelectorAll("[data-overview-tab]"));
    const panels = Array.from(document.querySelectorAll("[data-overview-panel]"));
    if (tabs.length === 0 || panels.length === 0) return;

    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        const view = tab.dataset.overviewTab;
        tabs.forEach((entry) => {
          const active = entry === tab;
          entry.classList.toggle("active", active);
          entry.setAttribute("aria-selected", String(active));
        });
        panels.forEach((panel) => {
          const active = panel.dataset.overviewPanel === view;
          panel.classList.toggle("active", active);
          panel.hidden = !active;
        });
      });
    });
  }

  async function hydrateCalendar() {
    const grid = document.querySelector("#calendarGrid");
    if (!grid) return;

    try {
      const calendar = await api.get(withFocus("/api/calendar"));
      state.calendarEvents = calendar.events || [];
      state.calendarCursor = state.calendarCursor || new Date();
      state.selectedCalendarDate = toDateKey(new Date());
      renderCalendar();
      wireCalendarControls();
    } catch (error) {
      grid.innerHTML = `<button class="calendar-day empty" type="button"><span>--</span><strong>Sync Canvas first</strong><em>Calendar dates will appear after the app can read Canvas.</em></button>`;
    }
  }

  async function hydrateSyllabi() {
    const form = document.querySelector("#syllabusUpload");
    const list = document.querySelector("#syllabusList");
    if (!form || !list) return;

    await renderUploadedSyllabi();

    const fileInput = document.querySelector("#syllabusFile");
    if (fileInput && fileInput.dataset.wired !== "true") {
      fileInput.dataset.wired = "true";
      fileInput.addEventListener("change", async () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        const title = document.querySelector("#syllabusTitle");
        if (title && !title.value) title.value = file.name.replace(/\.[^.]+$/, "");
        setText(document.querySelector("#syllabusState"), `${file.name} selected. Save to extract syllabus text.`);
      });
    }

    if (form.dataset.wired !== "true") {
      form.dataset.wired = "true";
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const title = document.querySelector("#syllabusTitle")?.value?.trim() || "";
        const courseName = document.querySelector("#syllabusCourse")?.value?.trim() || undefined;
        const text = document.querySelector("#syllabusText")?.value?.trim() || "";
        const file = document.querySelector("#syllabusFile")?.files?.[0];
        setText(document.querySelector("#syllabusState"), "Saving syllabus...");

        try {
          if (file) {
            const formData = new FormData();
            formData.append("file", file);
            if (title) formData.append("title", title);
            if (courseName) formData.append("courseName", courseName);
            await api.upload("/api/syllabi/upload", formData);
          } else {
            await api.post("/api/syllabi", { title: title || "Pasted syllabus", courseName, text });
          }
          form.reset();
          setText(document.querySelector("#syllabusState"), "Syllabus saved and available to reports.");
          await renderUploadedSyllabi();
          await hydrateOverview();
          await hydrateCalendar();
        } catch (error) {
          setText(document.querySelector("#syllabusState"), error.message || "Choose a syllabus file or paste syllabus text before saving.");
        }
      });
    }
  }

  async function hydrateAssignments() {
    const table = document.querySelector("#assignmentTable");
    if (!table) return;

    try {
      state.tasks = await api.get(withFocus("/api/tasks"));
      const courseSelect = document.querySelector("#course");
      if (courseSelect) {
        const courses = ["all", ...new Set(state.tasks.map((task) => task.courseName).filter(Boolean))];
        courseSelect.innerHTML = courses
          .map((course) => `<option value="${escapeAttr(course)}">${course === "all" ? "All courses" : escapeHtml(course)}</option>`)
          .join("");
      }
      renderAssignments();
      const search = document.querySelector("#search");
      const priority = document.querySelector("#priority");
      [search, courseSelect, priority].forEach((element) => element?.addEventListener("input", renderAssignments));
    } catch (error) {
      setText(document.querySelector("#selectedDetails"), "Preview assignments are showing until Canvas is configured.");
    }
  }

  async function hydrateTodo() {
    const tasksRoot = document.querySelector("#tasks");
    if (!tasksRoot) return;

    try {
      const report = await api.get(withFocus("/api/report/daily"));
      const tasks = [
        ...report.sections.overdue,
        ...report.sections.dueToday,
        ...report.sections.upcoming,
        ...report.sections.undated
      ].slice(0, 8);

      tasksRoot.innerHTML = tasks.map(renderTodoTask).join("");
      wireTodoProgress();
      renderTimeline(tasks);
      wireRebuildPlan(tasks);
    } catch (error) {
      wireTodoProgress();
      wireRebuildPlan([]);
    }
  }

  async function hydrateDoItForMe() {
    const form = document.querySelector("#helperForm");
    const assignmentSelect = document.querySelector("#assignment");
    if (!form || !assignmentSelect) return;

    try {
      state.tasks = state.tasks.length ? state.tasks : await api.get(withFocus("/api/tasks"));
      assignmentSelect.innerHTML = state.tasks
        .map((task) => `<option value="${task.courseId}:${task.assignmentId}">${escapeHtml(task.title)} - ${escapeHtml(task.courseName)}</option>`)
        .join("");

      const params = new URLSearchParams(location.search);
      const selected = `${params.get("courseId")}:${params.get("assignmentId")}`;
      if (/^\d+:\d+$/.test(selected)) assignmentSelect.value = selected;
    } catch (error) {
      return;
    }

    form.addEventListener("submit", async (event) => {
      const value = assignmentSelect.value;
      if (!/^\d+:\d+$/.test(value)) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      const [courseId, assignmentId] = value.split(":");
      const result = document.querySelector("#result");
      setText(document.querySelector("#copyState"), "Generating guided support...");

      try {
        const support = await api.post(`/api/assignments/${courseId}/${assignmentId}/do-it-for-me`);
        if (result) result.innerHTML = renderSupport(support);
        setText(document.querySelector("#copyState"), "Guided support generated from Canvas details.");
      } catch (error) {
        setText(document.querySelector("#copyState"), "Could not reach the assignment support endpoint.");
      }
    }, true);

    document.querySelector("#copy")?.addEventListener("click", async () => {
      const result = document.querySelector("#result");
      const text = result?.innerText?.trim() || "";
      try {
        await navigator.clipboard.writeText(text);
        setText(document.querySelector("#copyState"), "Generated help copied.");
      } catch (error) {
        setText(document.querySelector("#copyState"), "Copy is unavailable here. Select the result text manually.");
      }
    });
  }

  function renderOverviewTasks(report) {
    const list = document.querySelector(".report-list");
    if (!list) return;
    const tasks = [...report.sections.overdue, ...report.sections.dueToday, ...report.sections.upcoming].slice(0, 5);
    list.innerHTML = tasks.map((task) => {
      const flag = task.status === "overdue" || task.status === "missing" ? "danger" : task.status === "upcoming" ? "info" : "";
      return `<div class="task"><span class="flag ${flag}"></span><div><strong>${escapeHtml(task.title)}</strong><span>${escapeHtml(task.courseName)} - ${escapeHtml(task.action)}</span></div><span class="time">${task.estimatedMinutes} min</span></div>`;
    }).join("");
  }

  function renderCalendar() {
    const grid = document.querySelector("#calendarGrid");
    const title = document.querySelector("#calendarMonth");
    if (!grid) return;

    const cursor = state.calendarCursor;
    const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const eventsByDate = groupEventsByDate(state.calendarEvents);
    const selectedDate = state.selectedCalendarDate;
    setText(title, monthStart.toLocaleDateString([], { month: "long", year: "numeric" }));

    const cells = [];
    for (let index = 0; index < monthStart.getDay(); index += 1) {
      cells.push(`<span class="calendar-day empty" aria-hidden="true"></span>`);
    }

    for (let day = 1; day <= monthEnd.getDate(); day += 1) {
      const date = new Date(cursor.getFullYear(), cursor.getMonth(), day);
      const key = toDateKey(date);
      const events = eventsByDate.get(key) || [];
      const isToday = key === toDateKey(new Date());
      const selected = key === selectedDate;
      cells.push(`
        <button class="calendar-day${isToday ? " today" : ""}${selected ? " selected" : ""}" type="button" data-calendar-date="${escapeAttr(key)}" aria-pressed="${selected}">
          <span>${day}</span>
          ${events.slice(0, 3).map((event) => `<strong class="${calendarEventTone(event)}">${escapeHtml(event.title)}</strong>`).join("")}
          ${events.length > 3 ? `<em>+${events.length - 3} more</em>` : ""}
        </button>
      `);
    }

    grid.innerHTML = cells.join("");
    grid.querySelectorAll("[data-calendar-date]").forEach((button) => {
      button.addEventListener("click", () => {
        state.selectedCalendarDate = button.dataset.calendarDate;
        renderCalendar();
      });
    });
    renderSelectedCalendarDay(eventsByDate.get(selectedDate) || []);
  }

  function wireCalendarControls() {
    document.querySelectorAll("[data-calendar-nav]").forEach((button) => {
      if (button.dataset.wired === "true") return;
      button.dataset.wired = "true";
      button.addEventListener("click", () => {
        const action = button.dataset.calendarNav;
        if (action === "prev" || action === "next") {
          state.calendarCursor = addCalendarMonths(state.calendarCursor, action === "prev" ? -1 : 1);
          state.selectedCalendarDate = toDateKey(state.calendarCursor);
        }
        if (action === "today") {
          const today = new Date();
          state.calendarCursor = today;
          state.selectedCalendarDate = toDateKey(today);
        }
        renderCalendar();
      });
    });
  }

  function renderSelectedCalendarDay(events) {
    const root = document.querySelector("#calendarList");
    const title = document.querySelector("#calendarDayTitle");
    if (!root) return;

    const selectedDate = dateFromKey(state.selectedCalendarDate);
    setText(title, selectedDate ? selectedDate.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" }) : "Selected day");

    if (events.length === 0) {
      root.innerHTML = `<div class="calendar-event"><time>Clear</time><div><strong>No open work due</strong><span>Select another date or change the focused classes on the homepage.</span></div></div>`;
      return;
    }

    root.innerHTML = events.map((event) => {
      const time = event.startsAt ? formatTime(event.startsAt) : "";
      const urgent = calendarEventTone(event);
      return `
        <div class="calendar-event ${urgent}">
          <time>${time || "Due"}<span>${escapeHtml(event.priority)}</span></time>
          <div>
            <strong>${escapeHtml(event.title)}</strong>
            <span>${escapeHtml(event.courseName)} - ${escapeHtml(event.action)}</span>
          </div>
        </div>
      `;
    }).join("");
  }

  function groupEventsByDate(events) {
    return events.reduce((map, event) => {
      if (!event.startsAt) return map;
      const key = toDateKey(new Date(event.startsAt));
      const nextEvents = [...(map.get(key) || []), event].sort((left, right) =>
        new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime()
      );
      map.set(key, nextEvents);
      return map;
    }, new Map());
  }

  function calendarEventTone(event) {
    if (event.status === "overdue" || event.status === "missing") return "danger";
    if (event.status === "upcoming") return "info";
    return "";
  }

  function addCalendarMonths(date, delta) {
    return new Date(date.getFullYear(), date.getMonth() + delta, 1);
  }

  async function renderUploadedSyllabi() {
    const root = document.querySelector("#syllabusList");
    if (!root) return;

    try {
      const syllabi = await api.get("/api/syllabi");
      if (syllabi.length === 0) {
        root.innerHTML = `<div class="mention"><b>No uploaded syllabi</b><p>Add one to let the report catch dates and tasks that are not in Canvas assignments yet.</p></div>`;
        return;
      }

      root.innerHTML = syllabi.map((syllabus) => `
        <div class="mention uploaded-syllabus">
          <b>${escapeHtml(syllabus.title)}</b>
          <p>${escapeHtml(syllabus.courseName || "No class label")} - uploaded ${escapeHtml(formatDate(syllabus.uploadedAt))}</p>
          <button class="button secondary" type="button" data-delete-syllabus="${escapeAttr(syllabus.id)}">Remove</button>
        </div>
      `).join("");

      root.querySelectorAll("[data-delete-syllabus]").forEach((button) => {
        button.addEventListener("click", async () => {
          button.disabled = true;
          try {
            await api.delete(`/api/syllabi/${encodeURIComponent(button.dataset.deleteSyllabus)}`);
            setText(document.querySelector("#syllabusState"), "Syllabus removed.");
            await renderUploadedSyllabi();
            await hydrateOverview();
          } catch (error) {
            button.disabled = false;
            setText(document.querySelector("#syllabusState"), "Could not remove that syllabus.");
          }
        });
      });
    } catch (error) {
      root.innerHTML = `<div class="mention"><b>Syllabus library unavailable</b><p>Restart the app and try again.</p></div>`;
    }
  }

  function renderSyllabus(mentions) {
    const root = document.querySelector(".syllabus");
    if (!root || mentions.length === 0) return;
    root.innerHTML = mentions.slice(0, 4).map((mention) =>
      `<div class="mention"><b>${escapeHtml(mention.courseName)}</b><p>${escapeHtml(mention.text)}</p></div>`
    ).join("");
  }

  function renderReportPreview(report) {
    const preview = document.querySelector("#previewText");
    const button = document.querySelector("#preview");
    if (!preview) return;

    const text = formatReportText(report);
    preview.textContent = text;
    if (button && button.dataset.wired !== "true") {
      button.dataset.wired = "true";
      button.addEventListener("click", () => {
        preview.textContent = text;
      });
    }
  }

  function formatReportText(report) {
    const lines = [
      `Canvas Daily Report - ${formatDate(report.reportDate)}`,
      `Open: ${report.summary.totalOpen} | Overdue: ${report.summary.overdue} | Due today: ${report.summary.dueToday} | Upcoming: ${report.summary.upcoming} | Undated: ${report.summary.undated}`,
      "",
      ...formatReportSection("Overdue / Missing", report.sections.overdue),
      "",
      ...formatReportSection("Due Today", report.sections.dueToday),
      "",
      ...formatReportSection("Upcoming", report.sections.upcoming),
      "",
      ...formatReportSection("Undated", report.sections.undated)
    ];

    if (report.sections.syllabusMentions.length > 0) {
      lines.push("", "Syllabus Mentions");
      report.sections.syllabusMentions.slice(0, 8).forEach((mention) => {
        lines.push(`- ${mention.courseName}: ${mention.text}`);
      });
    }

    return lines.join("\n");
  }

  function formatReportSection(title, tasks) {
    if (!tasks.length) return [title, "- Nothing here."];
    return [
      title,
      ...tasks.slice(0, 8).map((task) => `- ${task.title} (${task.courseName}) - ${task.action}`)
    ];
  }

  function renderAssignments() {
    const table = document.querySelector("#assignmentTable");
    if (!table) return;

    const query = document.querySelector("#search")?.value?.toLowerCase() || "";
    const course = document.querySelector("#course")?.value || "all";
    const priority = document.querySelector("#priority")?.value || "all";

    table.querySelectorAll(".data-row").forEach((row) => row.remove());
    state.tasks
      .filter((task) => course === "all" || task.courseName === course)
      .filter((task) => priority === "all" || task.priority === priority)
      .filter((task) => `${task.title} ${task.courseName}`.toLowerCase().includes(query))
      .forEach((task) => {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "row data-row";
        row.style.width = "100%";
        row.style.borderLeft = "0";
        row.style.borderRight = "0";
        row.style.borderTop = "0";
        row.style.background = "transparent";
        row.style.textAlign = "left";
        row.innerHTML = `<span class="assignment"><strong>${escapeHtml(task.title)}</strong><span>${task.estimatedMinutes} min estimate</span></span><span>${escapeHtml(task.courseName)}</span><span class="muted">${escapeHtml(task.status)}</span><span class="muted">${task.pointsPossible || "-"}</span><span class="pill ${escapeAttr(task.priority)}">${escapeHtml(task.priority)}</span>`;
        row.addEventListener("click", () => selectAssignment(task, row));
        table.appendChild(row);
      });
  }

  function selectAssignment(task, row) {
    state.selectedTask = task;
    document.querySelectorAll(".data-row").forEach((entry) => entry.classList.remove("selected"));
    row.classList.add("selected");
    setText(document.querySelector("#selectedTitle"), task.title);
    setText(document.querySelector("#selectedMeta"), `${task.courseName} - ${task.status} - ${task.pointsPossible || "unscored"} points`);
    setText(document.querySelector("#selectedDetails"), task.details || task.action);

    const openAi = document.querySelector("#openAi");
    if (openAi) openAi.onclick = () => {
      location.href = `ai-do-it.html?courseId=${task.courseId}&assignmentId=${task.assignmentId}`;
    };
  }

  function renderTodoTask(task) {
    return `<label class="task"><input type="checkbox" /><span><strong>${escapeHtml(task.title)}</strong><span>${escapeHtml(task.courseName)} - ${escapeHtml(task.action)}</span></span><em class="minutes">${task.estimatedMinutes} min</em></label>`;
  }

  function wireTodoProgress() {
    const tasks = Array.from(document.querySelectorAll(".task"));
    const progress = document.querySelector("#progress");
    const summary = document.querySelector("#summary");
    const update = () => {
      const done = tasks.filter((task) => task.querySelector("input")?.checked).length;
      tasks.forEach((task) => task.classList.toggle("done", Boolean(task.querySelector("input")?.checked)));
      if (progress) progress.style.width = tasks.length ? `${Math.round((done / tasks.length) * 100)}%` : "0%";
      setText(summary, `${done} of ${tasks.length} tasks complete.`);
    };
    tasks.forEach((task) => task.querySelector("input")?.addEventListener("change", update));
    update();
  }

  function wireRebuildPlan(tasks) {
    const button = document.querySelector("#rebuild");
    if (!button || button.dataset.wired === "true") return;
    button.dataset.wired = "true";
    button.addEventListener("click", () => {
      const highPriority = tasks.filter((task) => task.priority === "high").length;
      const detail = highPriority > 0
        ? `Plan rebuilt around ${highPriority} high-priority item${highPriority === 1 ? "" : "s"}.`
        : "Plan rebuilt around the selected classes.";
      setText(document.querySelector("#planState"), detail);
    });
  }

  function renderTimeline(tasks) {
    const root = document.querySelector("#timeline");
    if (!root || tasks.length === 0) return;
    const starts = ["09:00", "10:45", "13:30", "15:15", "16:30"];
    root.innerHTML = tasks.slice(0, 5).map((task, index) =>
      `<div class="slot"><time>${starts[index]}</time><div><b>${escapeHtml(task.title)}</b><span>${escapeHtml(task.courseName)} - ${task.estimatedMinutes} min</span></div></div>`
    ).join("");
  }

  function renderSupport(support) {
    const list = (items) => `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
    return `
      <div class="block guard"><h3>${escapeHtml(support.instructions.title)}</h3><p>${escapeHtml(support.academicIntegrityNotice)}</p></div>
      <div class="block"><h3>Next action</h3><p>${escapeHtml(support.nextBestAction)}</p></div>
      <div class="block"><h3>Requirements</h3>${list(support.instructions.requirements)}</div>
      <div class="block"><h3>Outline</h3>${list(support.outline)}</div>
      <div class="block"><h3>Starter template</h3><p>${escapeHtml(support.starterTemplate).replace(/\n/g, "<br>")}</p></div>
    `;
  }

  function withFocus(path) {
    const ids = getFocusedCourseIds();
    if (ids.length === 0) return path;
    const separator = path.includes("?") ? "&" : "?";
    return `${path}${separator}courseIds=${encodeURIComponent(ids.join(","))}`;
  }

  function focusPayload(payload) {
    const ids = getFocusedCourseIds();
    return {
      ...(payload || {}),
      ...(ids.length > 0 ? { courseIds: ids } : {})
    };
  }

  function getFocusedCourseIds() {
    try {
      const parsed = JSON.parse(localStorage.getItem(FOCUS_STORAGE_KEY) || "[]");
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((value) => Number.parseInt(value, 10))
        .filter((value) => Number.isSafeInteger(value) && value > 0);
    } catch (error) {
      return [];
    }
  }

  function saveFocusedCourseIds(ids) {
    localStorage.setItem(FOCUS_STORAGE_KEY, JSON.stringify([...new Set(ids)]));
  }

  async function parseApiResponse(response) {
    const body = await response.json().catch(() => undefined);
    if (!response.ok || !body?.success) {
      throw new Error(body?.error || `Request failed: ${response.status}`);
    }
    return body.data;
  }

  function setText(element, value) {
    if (element) element.textContent = String(value);
  }

  function formatTime(value) {
    return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  function formatDate(value) {
    return new Date(value).toLocaleDateString([], {
      weekday: "long",
      month: "short",
      day: "numeric",
      year: "numeric"
    });
  }

  function toDateKey(value) {
    const date = value instanceof Date ? value : new Date(value);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function dateFromKey(key) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(key))) return undefined;
    const [year, month, day] = key.split("-").map((part) => Number.parseInt(part, 10));
    return new Date(year, month - 1, day);
  }

  function safeHost(value) {
    try {
      return new URL(value).host;
    } catch (error) {
      return value || "Canvas";
    }
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, "&#96;");
  }
})();
