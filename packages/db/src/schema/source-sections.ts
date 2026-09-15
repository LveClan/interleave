import { sql } from "drizzle-orm";
import { check, index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { elements } from "./elements";

/** A T067 chapter topic's owned range in canonical source content. */
export const sourceSections = sqliteTable(
  "source_sections",
  {
    topicId: text("topic_id")
      .primaryKey()
      .references(() => elements.id, { onDelete: "cascade" }),
    sourceId: text("source_id")
      .notNull()
      .references(() => elements.id, { onDelete: "cascade" }),
    documentId: text("document_id")
      .notNull()
      .references(() => elements.id, { onDelete: "cascade" }),
    rangeKey: text("range_key").notNull(),
    unitIds: text("unit_ids").notNull(),
    rangeHash: text("range_hash").notNull(),
    verdict: text("verdict").notNull(),
  },
  (table) => [
    uniqueIndex("source_sections_range_idx").on(table.sourceId, table.rangeKey),
    index("source_sections_document_idx").on(table.documentId),
    check(
      "source_sections_verdict_check",
      sql`${table.verdict} IN ('extract_worthy','later','ignore')`,
    ),
    check(
      "source_sections_units_check",
      sql`json_valid(${table.unitIds}) AND json_type(${table.unitIds}) = 'array'`,
    ),
  ],
);
