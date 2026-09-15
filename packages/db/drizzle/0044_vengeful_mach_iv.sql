CREATE TABLE `source_media_playback` (
	`source_element_id` text PRIMARY KEY NOT NULL,
	`content_hash` text NOT NULL,
	`duration_ms` integer,
	`coverage` text DEFAULT '[]' NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`source_element_id`) REFERENCES `elements`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "source_media_playback_duration_check" CHECK("source_media_playback"."duration_ms" IS NULL OR "source_media_playback"."duration_ms" > 0),
	CONSTRAINT "source_media_playback_coverage_check" CHECK(json_valid("source_media_playback"."coverage") AND json_type("source_media_playback"."coverage") = 'array')
);
