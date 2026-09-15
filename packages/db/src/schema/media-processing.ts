import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { elements } from "./elements";

/** Playback union belongs to the source asset version, independent of transcript segmentation. */
export const sourceMediaPlayback = sqliteTable(
  "source_media_playback",
  {
    sourceElementId: text("source_element_id")
      .primaryKey()
      .references(() => elements.id, { onDelete: "cascade" }),
    contentHash: text("content_hash").notNull(),
    durationMs: integer("duration_ms"),
    coverage: text("coverage").notNull().default("[]"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check(
      "source_media_playback_duration_check",
      sql`${table.durationMs} IS NULL OR ${table.durationMs} > 0`,
    ),
    check(
      "source_media_playback_coverage_check",
      sql`json_valid(${table.coverage}) AND json_type(${table.coverage}) = 'array'`,
    ),
  ],
);
