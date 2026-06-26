(function () {
  const api = {
    async get(path) {
      const response = await fetch(path, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`Request failed: ${response.status}`);
      const body = await response.json();
      if (!body.success) throw new Error(body.error || "Request failed");
      return body.data;
    },
    async post(path, payload) {
      const response = await fetch(path, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(payload || {})
      });
      if (!response.ok) throw new Error(`Request failed: ${response.status}`);
      const body = await response.json();
      if (!body.success) throw new Error(body.error || "Request failed");
      return body.data;
    }
  };

  const state = {
    tasks: [],
    selectedTask: null
  };
  const FOCUS_STORAGE_KEY = "canvas-workbench.focusCourseIds";

  document.addEventListener("DOMContentLoaded", () => {
    hydrateAuthStatus();
    hydrateHome();
    hydrateOverview();
    hydrateAssignments();
    hydrateTodo();
    hydrateDoItForMe();
  });

  async function hydrateAuthStatus() {
    const syncCard = document.querySelector(".sync-card");
    const setupCard = ensureSetupCard();

    try {
      const status = await api.get("/api/auth/status");
      const canvasHost = safeHost(status.canvasBaseUrl);
      if (syncCard) {
        const connected = status.connected || status.importConnected;
        syncCard.innerHTML = connected
          ? `<strong>Canvas synced</strong><span>${escapeHtml(canvasHost)} data is feeding assignments and deadlines.</span>`
          : `<strong>No-admin sync</strong><span>Log into Canvas normally, then sync with the companion extension.</span><a class="button" style="display:flex;margin-top:12px;align-items:center;justify-content:center;" href="#firstRunSetup">Setup sync</a>`;
      }
      if (setupCard) renderSetupCard(setupCard, status, canvasHost);
    } catch (error) {
      if (syncCard) syncCard.innerHTML = "<strong>Canvas setup needed</strong><span>Add OAuth credentials in the server environment.</span>";
      if (setupCard) {
        setupCard.innerHTML = `<div class="setup-row"><div><h3>Canvas setup needed</h3><p>The app could not read the setup status. Check the server environment and refresh.</p></div></div>`;
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
    card.classList.toggle("is-connected", connected);
    if (connected) {
      card.innerHTML = `
        <div class="setup-row">
          <div><h3>Canvas is synced</h3><p>The workbench can read courses, syllabi, assignments, due dates, and submissions from ${escapeHtml(canvasHost)}.</p></div>
          <a class="button secondary" href="overview.html">Open report</a>
        </div>
        <div class="setup-meta">Setup complete${status.importedSyncedAt ? ` · last synced ${escapeHtml(new Date(status.importedSyncedAt).toLocaleString())}` : ""}</div>
      `;
      return;
    }

    card.innerHTML = `
      <div class="setup-row">
        <div>
          <h3>First-time setup: no admin required</h3>
          <p>Install the companion extension, log into Canvas normally, then click sync. The app will use that synced snapshot for reports, assignments, todos, and guided help.</p>
        </div>
        <a class="button" href="/extension/README.md">Setup sync</a>
      </div>
      <div class="setup-meta">Canvas host: ${escapeHtml(canvasHost)}${canConnect ? ` · institution OAuth also available at ${escapeHtml(status.connectUrl)}` : " · no school admin needed with extension sync"}${status.prototypeTokenEnabled ? " · prototype token fallback enabled" : ""}</div>
    `;
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
