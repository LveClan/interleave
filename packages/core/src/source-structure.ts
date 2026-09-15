import type { SourceBlockProcessingSummary, SourceBlockProcessingView } from "./source";

export type SkimVerdict = "extract_worthy" | "later" | "ignore";
export interface StructureRange {
  readonly key: string;
  readonly title: string;
  readonly depth: number;
  readonly documentId: string;
  readonly unitIds: readonly string[];
  readonly fingerprint: string;
  readonly topicId: string | null;
  readonly verdict: SkimVerdict | null;
  readonly priority: number;
  readonly valid: boolean;
}
export interface SourceStructure {
  readonly sourceId: string;
  readonly format: "pdf" | "document" | "epub";
  readonly ranges: readonly StructureRange[];
  readonly units: readonly { id: string; label: string; documentId: string }[];
}
export interface ApplySkimRequest {
  readonly sourceId: string;
  readonly decisions: readonly { range: StructureRange; verdict: SkimVerdict; priority: number }[];
}
export interface SkimReceipt {
  readonly sourceId: string;
  readonly token: string;
}
export interface SectionReaderData {
  readonly topicId: string;
  readonly sourceId: string;
  readonly sourceTitle: string;
  readonly title: string;
  readonly contentDocumentId: string;
  readonly format: "pdf" | "document";
  readonly valid: boolean;
  readonly document: unknown;
  readonly blockPages: Readonly<Record<string, number>>;
  readonly blocks: readonly SourceBlockProcessingView[];
  readonly summary: SourceBlockProcessingSummary;
}
