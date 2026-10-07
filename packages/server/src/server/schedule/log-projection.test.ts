import { describe, expect, test } from "vitest";
import type { ScheduleRun, StoredSchedule } from "@getpaseo/protocol/schedule/types";
import {
  SCHEDULE_LOG_DEFAULT_LIMIT,
  SCHEDULE_LOG_DETAIL_CHARS,
  SCHEDULE_LOG_LIST_PREVIEW_CHARS,
  SCHEDULE_LOG_MAX_LIMIT,
  projectScheduleLogs,
  toScheduleInspectPayload,
} from "./log-projection.js";

function makeRun(overrides: Partial<ScheduleRun> & Pick<ScheduleRun, "id">): ScheduleRun {
  return {
    scheduledFor: "2026-04-11T00:00:00.000Z",
    startedAt: "2026-04-11T00:00:00.000Z",
    endedAt: "2026-04-11T00:00:05.000Z",
    status: "succeeded",
    agentId: null,
    output: `output-${overrides.id}`,
    error: null,
    ...overrides,
  };
}

function makeSchedule(runs: ScheduleRun[]): StoredSchedule {
  return {
    id: "schedule-1",
    name: "nightly",
    prompt: "say hello",
    cadence: { type: "cron", expression: "0 9 * * *" },
    target: { type: "new-agent", config: { provider: "claude", cwd: "/tmp" } },
    status: "active",
    createdAt: "2026-04-11T00:00:00.000Z",
    updatedAt: "2026-04-11T00:00:00.000Z",
    nextRunAt: "2026-04-12T00:00:00.000Z",
    lastRunAt: "2026-04-11T00:00:00.000Z",
    pausedAt: null,
    expiresAt: null,
    maxRuns: null,
    runs,
  };
}

function numberedRuns(count: number): ScheduleRun[] {
  return Array.from({ length: count }, (_, index) => {
    const n = index + 1;
    return makeRun({
      id: `run-${String(n).padStart(2, "0")}`,
      startedAt: `2026-04-11T00:${String(n).padStart(2, "0")}:00.000Z`,
    });
  });
}

describe("toScheduleInspectPayload", () => {
  test("omits run history and reports counts plus the newest preview", () => {
    const runs = [
      makeRun({
        id: "run-old",
        startedAt: "2026-04-11T00:01:00.000Z",
        status: "failed",
        error: "boom",
        output: "failed output",
      }),
      makeRun({
        id: "run-new",
        startedAt: "2026-04-11T00:02:00.000Z",
        output: `${"x".repeat(SCHEDULE_LOG_LIST_PREVIEW_CHARS + 40)}-tail`,
      }),
    ];

    expect(toScheduleInspectPayload(makeSchedule(runs))).toEqual({
      id: "schedule-1",
      name: "nightly",
      prompt: "say hello",
      cadence: { type: "cron", expression: "0 9 * * *" },
      target: { type: "new-agent", config: { provider: "claude", cwd: "/tmp" } },
      status: "active",
      createdAt: "2026-04-11T00:00:00.000Z",
      updatedAt: "2026-04-11T00:00:00.000Z",
      nextRunAt: "2026-04-12T00:00:00.000Z",
      lastRunAt: "2026-04-11T00:00:00.000Z",
      pausedAt: null,
      expiresAt: null,
      maxRuns: null,
      runCount: 2,
      failedCount: 1,
      lastRun: {
        id: "run-new",
        scheduledFor: "2026-04-11T00:00:00.000Z",
        startedAt: "2026-04-11T00:02:00.000Z",
        endedAt: "2026-04-11T00:00:05.000Z",
        status: "succeeded",
        agentId: null,
        output: `${"x".repeat(SCHEDULE_LOG_LIST_PREVIEW_CHARS)}\n[truncated 45 chars; call schedule_logs with runId=run-new for more]`,
        error: null,
      },
    });
  });

  test("returns a null last run when the schedule has never fired", () => {
    expect(toScheduleInspectPayload(makeSchedule([]))).toMatchObject({
      runCount: 0,
      failedCount: 0,
      lastRun: null,
    });
  });
});

describe("projectScheduleLogs", () => {
  test("returns the newest default page and a cursor for older runs", () => {
    const page = projectScheduleLogs({ runs: numberedRuns(30) });

    expect(page.total).toBe(30);
    expect(page.returned).toBe(SCHEDULE_LOG_DEFAULT_LIMIT);
    expect(page.hasMore).toBe(true);
    expect(page.runs.map((run) => run.id)).toEqual([
      "run-30",
      "run-29",
      "run-28",
      "run-27",
      "run-26",
      "run-25",
      "run-24",
      "run-23",
      "run-22",
      "run-21",
      "run-20",
      "run-19",
      "run-18",
      "run-17",
      "run-16",
      "run-15",
      "run-14",
      "run-13",
      "run-12",
      "run-11",
    ]);
    expect(page.nextBefore).toBe("run-11");
  });

  test("pages older runs from nextBefore without repeating the previous page", () => {
    const first = projectScheduleLogs({ runs: numberedRuns(30), limit: 5 });
    const second = projectScheduleLogs({
      runs: numberedRuns(30),
      limit: 5,
      before: first.nextBefore ?? undefined,
    });

    expect(first.runs.map((run) => run.id)).toEqual([
      "run-30",
      "run-29",
      "run-28",
      "run-27",
      "run-26",
    ]);
    expect(second.runs.map((run) => run.id)).toEqual([
      "run-25",
      "run-24",
      "run-23",
      "run-22",
      "run-21",
    ]);
    expect(second.nextBefore).toBe("run-21");
  });

  test("filters by status before paging", () => {
    const runs = [
      makeRun({ id: "ok-1", startedAt: "2026-04-11T00:01:00.000Z" }),
      makeRun({
        id: "fail-1",
        startedAt: "2026-04-11T00:02:00.000Z",
        status: "failed",
        error: "first",
      }),
      makeRun({ id: "ok-2", startedAt: "2026-04-11T00:03:00.000Z" }),
      makeRun({
        id: "fail-2",
        startedAt: "2026-04-11T00:04:00.000Z",
        status: "failed",
        error: "second",
      }),
    ];

    expect(projectScheduleLogs({ runs, status: "failed" })).toEqual({
      runs: [
        {
          ...runs[3],
          output: "output-fail-2",
        },
        {
          ...runs[1],
          output: "output-fail-1",
        },
      ],
      total: 2,
      returned: 2,
      hasMore: false,
      nextBefore: null,
    });
  });

  test("returns one truncated detail run when runId is set", () => {
    const agentId = "11111111-1111-4111-8111-111111111111";
    const longOutput = `${"y".repeat(SCHEDULE_LOG_DETAIL_CHARS + 12)}-tail`;
    const match = makeRun({
      id: "run-target",
      startedAt: "2026-04-11T00:09:00.000Z",
      agentId,
      output: longOutput,
    });

    expect(
      projectScheduleLogs({
        runs: [makeRun({ id: "run-other", startedAt: "2026-04-11T00:10:00.000Z" }), match],
        runId: "run-target",
        limit: 1,
        status: "failed",
        before: "run-other",
      }),
    ).toEqual({
      runs: [
        {
          ...match,
          output: `${"y".repeat(SCHEDULE_LOG_DETAIL_CHARS)}\n[truncated 17 chars; use get_agent_activity with agentId=${agentId} for the full response]`,
        },
      ],
      total: 1,
      returned: 1,
      hasMore: false,
      nextBefore: null,
    });
  });

  test("truncates list output and points at schedule_logs", () => {
    const output = `${"z".repeat(SCHEDULE_LOG_LIST_PREVIEW_CHARS + 9)}-tail`;
    const run = makeRun({ id: "run-long", output });

    expect(projectScheduleLogs({ runs: [run] }).runs[0]?.output).toBe(
      `${"z".repeat(SCHEDULE_LOG_LIST_PREVIEW_CHARS)}\n[truncated 14 chars; call schedule_logs with runId=run-long for more]`,
    );
  });

  test("rejects an oversize limit", () => {
    expect(() =>
      projectScheduleLogs({ runs: numberedRuns(1), limit: SCHEDULE_LOG_MAX_LIMIT + 1 }),
    ).toThrow(`limit must be at most ${SCHEDULE_LOG_MAX_LIMIT}`);
  });

  test("throws when runId is missing", () => {
    expect(() => projectScheduleLogs({ runs: numberedRuns(1), runId: "missing" })).toThrow(
      "Schedule run not found: missing",
    );
  });

  test("throws when before is missing", () => {
    expect(() => projectScheduleLogs({ runs: numberedRuns(1), before: "missing" })).toThrow(
      "Schedule run not found: missing",
    );
  });
});
