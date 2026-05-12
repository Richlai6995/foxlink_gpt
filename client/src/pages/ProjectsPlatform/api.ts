/**
 * Projects-Platform API helper
 *
 * 統一處理 /api/projects/* 的 fetch + auth + JSON parse + error。
 */

const BASE = '/api/projects'

export class ApiError extends Error {
  status: number
  body: any
  constructor(status: number, body: any, message: string) {
    super(message)
    this.status = status
    this.body = body
  }
}

async function request<T = any>(
  token: string | null | undefined,
  method: string,
  path: string,
  body?: any,
): Promise<T> {
  if (!token) throw new ApiError(401, null, 'no token')
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
  }
  if (body !== undefined) init.body = JSON.stringify(body)

  const res = await fetch(`${BASE}${path}`, init)
  const text = await res.text()
  let data: any = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }

  if (!res.ok) {
    const msg = (data && (data.error || data.message)) || `HTTP ${res.status}`
    throw new ApiError(res.status, data, msg)
  }
  return data as T
}

export const api = {
  get:    <T = any>(t: string | null | undefined, p: string)              => request<T>(t, 'GET',    p),
  post:   <T = any>(t: string | null | undefined, p: string, body?: any)  => request<T>(t, 'POST',   p, body ?? {}),
  delete: <T = any>(t: string | null | undefined, p: string, body?: any)  => request<T>(t, 'DELETE', p, body),
  put:    <T = any>(t: string | null | undefined, p: string, body?: any)  => request<T>(t, 'PUT',    p, body ?? {}),
}

// ─── Types ────────────────────────────────────────────────────────────
export type ProjectType = {
  id: number
  type_code: string
  name_i18n: Record<string, string>
  description_i18n?: Record<string, string>
  icon?: string
  sort_order: number
  default_workflow_template_id: number | null
  default_is_confidential: boolean
  plugin_loaded: boolean
}

export type Project = {
  id: number
  project_code: string
  type_code: string
  bu_id: number
  pm_user_id: number
  sales_user_id?: number
  lifecycle_status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'CLOSED' | 'REOPENED'
  status: string
  importance: 'HIGH' | 'NORMAL' | 'LOW'
  urgency: 'HIGH' | 'NORMAL' | 'LOW'
  priority_score?: number
  current_stage_id?: number | null
  sla_due_at?: string | null
  data_payload: { title?: string; [k: string]: any }
  created_at: string
  updated_at: string
}

export type Channel = {
  id: number
  project_id: number
  name: string
  channel_type: 'announcement' | 'general' | 'group' | 'topic' | 'dm'
  is_default: number
  visibility: string
  topic_summary?: string | null
  is_archived: number
  archived_at?: string | null
  created_by: number
  created_at: string
}

export type Stage = {
  id: number
  stage_code: string
  stage_order: number
  status: 'PENDING' | 'ACTIVE' | 'READY_FOR_GATE' | 'DONE' | 'SKIPPED'
  sla_hours?: number
  sla_due_at?: string | null
  entered_at?: string | null
  completed_at?: string | null
  gate_required: number
  gate_confirmed_at?: string | null
}

export type Member = {
  id: number
  user_id: number
  role: string
  sub_role?: string | null
  invited_by: number
  invited_by_pm_user_id?: number | null
  invited_at: string
}

export type ProjectDetail = Project & {
  channels: Channel[]
  stages: Stage[]
  members: Member[]
}

export type MessageType = 'NORMAL' | 'PROGRESS' | 'BLOCKER' | 'DECISION' | 'AI_INSIGHT' | 'SYSTEM'

export type Message = {
  id: number
  channel_id: number
  project_id: number
  user_id: number
  content: string
  message_type: MessageType
  reply_to_message_id?: number | null
  is_pinned: number
  pinned_by?: number | null
  pinned_at?: string | null
  pin_note?: string | null
  requires_read_receipt: number
  synced_to_announcement: number
  announcement_msg_id?: number | null
  deleted_at?: string | null
  deleted_by?: number | null
  deletion_mode?: 'standard' | 'emergency_purge' | null
  deletion_reason?: string | null
  attachment_ids: number[]
  edited_at?: string | null
  edit_count: number
  created_at: string
}

export type TaskStatus = 'PENDING' | 'IN_PROGRESS' | 'BLOCKED' | 'READY_FOR_REVIEW' | 'DONE' | 'CANCELLED'

export type Task = {
  id: number
  project_id: number
  parent_task_id?: number | null
  stage_id?: number | null
  title: string
  description?: string | null
  task_type?: string
  accountable_role?: string | null
  primary_owner_user_id?: number | null
  collaborator_user_ids: number[]
  status: TaskStatus
  progress_percent: number
  depends_on_task_id?: number | null
  relative_deadline_days?: number | null
  absolute_due_at?: string | null
  computed_due_at?: string | null
  started_at?: string | null
  completed_at?: string | null
  cancelled_at?: string | null
  blocker_reason?: string | null
  is_confidential?: number
  attachment_ids: number[]
  created_by_user_id: number
  created_at: string
  updated_at: string
}

export type Participant = {
  id: number
  channel_id: number
  user_id: number
  role: 'owner' | 'admin' | 'member' | 'guest'
  muted: number
  last_read_at?: string | null
  joined_at: string
  username?: string | null
  name?: string | null
}
