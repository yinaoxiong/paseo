import { z } from "zod";
import {
  ScheduleRunSchema,
  ScheduleSummarySchema,
  type ScheduleRun,
  type StoredSchedule,
} from "@getpaseo/protocol/schedule/types";

export const SCHEDULE_LOG_DEFAULT_LIMIT = 20;
export const SCHEDULE_LOG_MAX_LIMIT = 100;
export const SCHEDULE_LOG_LIST_PREVIEW_CHARS = 200;
export const SCHEDULE_LOG_DETAIL_CHARS = 4000;

export const ScheduleInspectPayloadSchema = ScheduleSummarySchema.extend({
  runCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  lastRun: ScheduleRunSchema.nullable(),
});
export type ScheduleInspectPayload = z.infer<typeof ScheduleInspectPayloadSchema>;

export const ScheduleLogsPayloadSchema = z.object({
  runs: z.array(ScheduleRunSchema),
  total: z.number().int().nonnegative(),
  returned: z.number().int().nonnegative(),
  hasMore: z.boolean(),
  nextBefore: z.string().nullable(),
});
export type ScheduleLogsPayload = z.infer<typeof ScheduleLogsPayloadSchema>;

export interface ProjectScheduleLogsInput {
  runs: ScheduleRun[];
  limit?: number;
  before?: string;
  status?: ScheduleRun["status"];
  runId?: string;
}

function compareRunsNewestFirst(left: ScheduleRun, right: ScheduleRun): number {
  const byStarted = right.startedAt.localeCompare(left.startedAt);
  if (byStarted !== 0) {
    return byStarted;
  }
  return right.id.localeCompare(left.id);
}

function resolveLogLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return SCHEDULE_LOG_DEFAULT_LIMIT;
  }
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("limit must be a positive integer");
  }
  if (limit > SCHEDULE_LOG_MAX_LIMIT) {
    throw new Error(`limit must be at most ${SCHEDULE_LOG_MAX_LIMIT}`);
  }
  return limit;
}

function moreHint(run: ScheduleRun, mode: "list" | "detail"): string {
  if (mode === "list") {
    return `call schedule_logs with runId=${run.id} for more`;
  }
  if (run.agentId) {
    return `use get_agent_activity with agentId=${run.agentId} for the full response`;
  }
  return `output exceeds the ${SCHEDULE_LOG_DETAIL_CHARS} character cap`;
}

function truncateScheduleText(value: string | null, limit: number, hint: string): string | null {
  if (value === null) {
    return null;
  }
  if (value.length <= limit) {
    return value;
  }
  const omitted = value.length - limit;
  return `${value.slice(0, limit)}\n[truncated ${omitted} chars; ${hint}]`;
}

function truncateScheduleRun(
  run: ScheduleRun,
  limit: number,
  mode: "list" | "detail",
): ScheduleRun {
  const hint = moreHint(run, mode);
  return {
    ...run,
    output: truncateScheduleText(run.output, limit, hint),
    error: truncateScheduleText(run.error, limit, hint),
  };
}

export function toScheduleInspectPayload(schedule: StoredSchedule): ScheduleInspectPayload {
  const { runs, ...summary } = schedule;
  const newest = [...runs].sort(compareRunsNewestFirst)[0] ?? null;
  return {
    ...summary,
    runCount: runs.length,
    failedCount: runs.filter((run) => run.status === "failed").length,
    lastRun: newest ? truncateScheduleRun(newest, SCHEDULE_LOG_LIST_PREVIEW_CHARS, "list") : null,
  };
}

export function projectScheduleLogs(input: ProjectScheduleLogsInput): ScheduleLogsPayload {
  const sorted = [...input.runs].sort(compareRunsNewestFirst);

  if (input.runId) {
    const match = sorted.find((run) => run.id === input.runId);
    if (!match) {
      throw new Error(`Schedule run not found: ${input.runId}`);
    }
    return {
      runs: [truncateScheduleRun(match, SCHEDULE_LOG_DETAIL_CHARS, "detail")],
      total: 1,
      returned: 1,
      hasMore: false,
      nextBefore: null,
    };
  }

  const filtered = input.status ? sorted.filter((run) => run.status === input.status) : sorted;
  const total = filtered.length;
  let startIndex = 0;
  if (input.before) {
    const beforeIndex = filtered.findIndex((run) => run.id === input.before);
    if (beforeIndex === -1) {
      throw new Error(`Schedule run not found: ${input.before}`);
    }
    startIndex = beforeIndex + 1;
  }

  const limit = resolveLogLimit(input.limit);
  const page = filtered.slice(startIndex, startIndex + limit);
  const last = page[page.length - 1];
  const hasMore = startIndex + page.length < total;
  return {
    runs: page.map((run) => truncateScheduleRun(run, SCHEDULE_LOG_LIST_PREVIEW_CHARS, "list")),
    total,
    returned: page.length,
    hasMore,
    nextBefore: hasMore && last ? last.id : null,
  };
}
