import { BoundedMathCache } from "./render-cache";
import {
  parseMathRuntimeMessage,
  parseMathRuntimeRequest,
  type MathRuntimeMessage,
  type MathRuntimeRequest,
} from "./runtime/messages";
export type MathHostInput = Omit<MathRuntimeRequest, "revision">;
export type MathHostMeasurement = Extract<MathRuntimeMessage, { type: "size" }>;
export const mathMeasurementCache = new BoundedMathCache<MathHostMeasurement>(128, 2 * 1024 * 1024);

export class MathRuntimeRequestDriver {
  private active = true;
  private readyState = false;
  private nextRevision = 0;
  private key = "";
  private latest: MathRuntimeRequest | null = null;
  private transportFailed = false;
  private retryOutstanding = false;
  constructor(
    private readonly runtimeIdentity: string,
    private readonly cache = mathMeasurementCache,
  ) {}
  get isActive(): boolean {
    return this.active;
  }
  get revision(): number {
    return this.latest?.revision ?? 0;
  }
  start(): void {
    this.active = true;
  }
  suspend(): void {
    this.latest = null;
    this.key = "";
  }
  stop(): void {
    this.active = false;
    this.latest = null;
    this.key = "";
  }
  update(input: MathHostInput): {
    request: MathRuntimeRequest | null;
    cached: MathHostMeasurement | null;
    reload: boolean;
  } {
    const request = parseMathRuntimeRequest({ ...input, revision: this.nextRevision + 1 });
    if (!this.active || !request) {
      if (!request) this.suspend();
      return { request: null, cached: null, reload: false };
    }
    const key = JSON.stringify([this.runtimeIdentity, input]);
    const cached = this.cache.get(key) ?? null;
    if (this.latest && key === this.key && !this.transportFailed)
      return { request: null, cached, reload: false };
    this.nextRevision++;
    this.latest = request;
    this.key = key;
    const reload = this.transportFailed && !this.retryOutstanding;
    if (reload) this.retryOutstanding = true;
    this.transportFailed = false;
    return { request: this.readyState ? request : null, cached, reload };
  }
  ready(): MathRuntimeRequest | null {
    if (!this.active) return null;
    this.readyState = true;
    // A late ready from the previous document must not suppress the new
    // document's render. Every ready gets a fresh acknowledgement revision.
    if (this.latest) this.latest = { ...this.latest, revision: ++this.nextRevision };
    return this.latest;
  }
  reload(): void {
    if (!this.active) return;
    this.readyState = false;
    if (this.latest) this.latest = { ...this.latest, revision: ++this.nextRevision };
  }
  failedTransport(): void {
    if (!this.active) return;
    this.reload();
    this.transportFailed = true;
  }
  expire(revision: number): boolean {
    return this.active && this.latest?.revision === revision;
  }
  accept(value: unknown): Exclude<MathRuntimeMessage, { type: "ready" }> | null {
    const message = parseMathRuntimeMessage(value);
    if (
      !this.active ||
      !this.readyState ||
      !this.latest ||
      !message ||
      message.type === "ready" ||
      message.revision !== this.latest.revision
    )
      return null;
    if (message.type === "size") {
      if (Math.abs(message.width - this.latest.width) >= 1) return null;
      this.retryOutstanding = false;
      this.cache.set(this.key, message, this.key.length * 2 + JSON.stringify(message).length * 2);
    }
    return message;
  }
}

export interface MathHostLayout {
  width: number;
  height: number | null;
  failed: boolean;
  painted: boolean;
  measuredWidth: number;
  regions: MathHostMeasurement["horizontalScrollRegions"];
}
export type MathHostLayoutEvent =
  | { type: "width"; width: number }
  | {
      type: "size";
      height: number;
      width: number;
      regions: MathHostMeasurement["horizontalScrollRegions"];
    }
  | { type: "pending"; cached?: MathHostMeasurement | null }
  | { type: "document" }
  | { type: "failed" };
export function reduceMathHostLayout(
  state: MathHostLayout,
  event: MathHostLayoutEvent,
): MathHostLayout {
  if (event.type === "width") {
    if (Math.abs(state.width - event.width) < 0.5) return state;
    return { ...state, width: event.width, height: null, painted: false, regions: [] };
  }
  if (event.type === "failed") return { ...state, failed: true, painted: false, regions: [] };
  if (event.type === "document") return { ...state, painted: false, regions: [] };
  if (event.type === "pending")
    return {
      ...state,
      failed: false,
      regions: [],
      height: event.cached?.height ?? (state.failed ? null : state.height),
      painted: state.painted && !state.failed,
      measuredWidth: event.cached?.width ?? state.measuredWidth,
    };
  return {
    ...state,
    failed: false,
    painted: true,
    height: event.height,
    measuredWidth: event.width,
    regions: event.regions,
  };
}
