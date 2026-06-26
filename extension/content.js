chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "CANVAS_WORKBENCH_SYNC") return false;

  syncCanvas()
    .then(sendResponse)
    .catch((error) => sendResponse({ success: false, error: error.message }));

  return true;
});

async function syncCanvas() {
  const canvasBaseUrl = location.origin;
  const courses = (await canvasGet("/api/v1/courses", {
    enrollment_state: "active",
    include: ["syllabus_body", "term"],
    per_page: "100"
  })).map(normalizeCourse);

  const assignmentsByCourse = {};
  for (const course of courses) {
    const assignments = await canvasGet(`/api/v1/courses/${course.id}/assignments`, {
      include: ["submission", "all_dates"],
      order_by: "due_at",
      per_page: "100"
    });
    assignmentsByCourse[String(course.id)] = assignments.map((assignment) =>
      normalizeAssignment(assignment, course.id)
    );
  }

  const response = await fetch("http://localhost:3000/api/import/canvas-snapshot", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      source: "canvas-extension",
      syncedAt: new Date().toISOString(),
      canvasBaseUrl,
      courses,
      assignmentsByCourse
    })
  });

  const body = await response.json();
  if (!response.ok || !body.success) {
    throw new Error(body.error || `Workbench import failed with ${response.status}`);
  }

  return {
    success: true,
    courses: body.data.courses,
    assignments: body.data.assignments
  };
}

async function canvasGet(path, params) {
  const url = new URL(path, location.origin);
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(`${key}[]`, item);
    } else {
      url.searchParams.set(key, value);
    }
  }

  const results = [];
  let nextUrl = url.toString();

  while (nextUrl) {
    const response = await fetch(nextUrl, {
      credentials: "include",
      headers: { Accept: "application/json" }
    });

    if (!response.ok) throw new Error(`Canvas request failed with ${response.status}`);
    results.push(...(await response.json()));
    nextUrl = nextLink(response.headers.get("link"));
  }

  return results;
}

function nextLink(linkHeader) {
  if (!linkHeader) return undefined;
  const next = linkHeader.split(",").find((part) => part.includes('rel="next"'));
  return next?.match(/<([^>]+)>/)?.[1];
}

function normalizeCourse(course) {
  return {
    id: course.id,
    name: course.name || course.course_code || `Course ${course.id}`,
    course_code: course.course_code,
    workflow_state: course.workflow_state,
    syllabus_body: course.syllabus_body || null,
    html_url: course.html_url
  };
}

function normalizeAssignment(assignment, courseId) {
  return {
    id: assignment.id,
    course_id: assignment.course_id || courseId,
    name: assignment.name || `Assignment ${assignment.id}`,
    description: assignment.description || "",
    due_at: assignment.due_at || null,
    lock_at: assignment.lock_at || null,
    unlock_at: assignment.unlock_at || null,
    points_possible: assignment.points_possible ?? null,
    html_url: assignment.html_url,
    submission_types: Array.isArray(assignment.submission_types)
      ? assignment.submission_types
      : [],
    has_submitted_submissions: Boolean(assignment.has_submitted_submissions),
    submission: normalizeSubmission(assignment.submission)
  };
}

function normalizeSubmission(submission) {
  if (!submission) return null;

  return {
    submitted_at: submission.submitted_at || null,
    workflow_state: submission.workflow_state,
    missing: Boolean(submission.missing),
    late: Boolean(submission.late),
    score: submission.score ?? null,
    attempt: submission.attempt ?? null
  };
}
