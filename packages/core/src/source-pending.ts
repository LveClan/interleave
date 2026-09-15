import type { SourceBlockProcessingSummary } from "./source";

export interface SourcePendingBlock {
  readonly blockId: string;
  readonly order: number | null;
  readonly state: "needs_later" | "stale_after_edit";
  readonly preview: string;
  readonly contentHash: string | null;
  readonly locatable: boolean;
  readonly canResume: boolean;
}

export interface SourcePendingBlocks {
  readonly sourceId: string;
  readonly entries: readonly SourcePendingBlock[];
  readonly summary: SourceBlockProcessingSummary;
}

export interface ResumeSourceBlockRequest {
  readonly sourceId: string;
  readonly blockId: string;
  readonly expectedState: SourcePendingBlock["state"];
  readonly contentHash: string;
  readonly state: "unread" | "read";
}

export interface ResumeSourceBlockReceipt {
  readonly sourceId: string;
  readonly blockId: string;
  readonly token: string;
}
