export interface CanvasCourse {
  id: number;
  name: string;
  course_code?: string;
  workflow_state?: string;
  syllabus_body?: string | null;
  html_url?: string;
  term?: {
    id?: number;
    name?: string;
    start_at?: string | null;
    end_at?: string | null;
  };
}

export interface CanvasSubmission {
  submitted_at?: string | null;
  workflow_state?: string;
  missing?: boolean;
  late?: boolean;
  score?: number | null;
  attempt?: number | null;
}

export interface CanvasAssignment {
  id: number;
  course_id?: number;
  name: string;
  description?: string | null;
  due_at?: string | null;
  lock_at?: string | null;
  unlock_at?: string | null;
  points_possible?: number | null;
  html_url?: string;
  submission_types?: string[];
  allowed_attempts?: number;
  has_submitted_submissions?: boolean;
  submission?: CanvasSubmission | null;
  all_dates?: Array<{
    title?: string;
    due_at?: string | null;
    unlock_at?: string | null;
    lock_at?: string | null;
  }>;
}
