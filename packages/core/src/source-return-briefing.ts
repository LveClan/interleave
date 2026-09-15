import type { SourceBlockProcessingState } from "./source";

/** Read-only entry snapshot. Current counts are never historical deltas. */
export interface SourceReturnBriefing {
  readonly sourceId: string;
  readonly asOf: string;
  readonly show: boolean;
  /** Latest recorded reading action, not a claim that every open was tracked. */
  readonly lastVisitAt: string | null;
  readonly visitEvidence: "reading_activity" | "unknown";
  readonly readPct: number;
  /** No existing visit snapshot records the historical denominator. */
  readonly readPctDelta: number | null;
  readonly stateCounts: Readonly<Record<SourceBlockProcessingState, number>>;
  readonly unresolvedBlocks: number;
  readonly needsReverifyOutputs: number;
  readonly cards: {
    readonly count: number;
    readonly mature: number;
    readonly leeches: number;
    readonly retention: number | null;
    readonly reviewCount: number;
    readonly windowDays: number;
  };
  readonly strugglingGroups: {
    readonly count: number;
    readonly windowDays: number;
  };
  readonly lastExtraction: {
    readonly elementId: string;
    readonly at: string;
    readonly label: string | null;
    readonly blockId: string | null;
  } | null;
  readonly nextUnresolvedBlockId: string | null;
  readonly firstDeferredBlockId: string | null;
}

export function shouldShowSourceReturnBriefing(
  lastVisitAt: string | null,
  asOf: string,
  scheduledReturn: boolean,
): boolean {
  if (!lastVisitAt) return false;
  const age = Date.parse(asOf) - Date.parse(lastVisitAt);
  return Number.isFinite(age) && age >= 0 && (scheduledReturn || age > 7 * 86_400_000);
}
