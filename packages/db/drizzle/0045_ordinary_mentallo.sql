CREATE TABLE `source_sections` (
	`topic_id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`document_id` text NOT NULL,
	`range_key` text NOT NULL,
	`unit_ids` text NOT NULL,
	`range_hash` text NOT NULL,
	`verdict` text NOT NULL,
	FOREIGN KEY (`topic_id`) REFERENCES `elements`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `elements`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_id`) REFERENCES `elements`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "source_sections_verdict_check" CHECK("source_sections"."verdict" IN ('extract_worthy','later','ignore')),
	CONSTRAINT "source_sections_units_check" CHECK(json_valid("source_sections"."unit_ids") AND json_type("source_sections"."unit_ids") = 'array')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_sections_range_idx` ON `source_sections` (`source_id`,`range_key`);--> statement-breakpoint
CREATE INDEX `source_sections_document_idx` ON `source_sections` (`document_id`);