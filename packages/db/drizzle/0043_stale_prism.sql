PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_operation_log` (
	`id` text PRIMARY KEY NOT NULL,
	`op_type` text NOT NULL,
	`payload` text NOT NULL,
	`element_id` text,
	`created_at` text NOT NULL,
	`batch_id` text,
	FOREIGN KEY (`element_id`) REFERENCES `elements`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "operation_log_op_type_check" CHECK("__new_operation_log"."op_type" IN ('create_element', 'update_element', 'soft_delete_element', 'restore_element', 'create_source', 'update_document', 'set_read_point', 'create_extract', 'create_card', 'add_review_log', 'reschedule_element', 'add_relation', 'remove_relation', 'add_tag', 'remove_tag', 'set_language'))
);
--> statement-breakpoint
INSERT INTO `__new_operation_log`("id", "op_type", "payload", "element_id", "created_at", "batch_id") SELECT "id", "op_type", "payload", "element_id", "created_at", "batch_id" FROM `operation_log`;--> statement-breakpoint
DROP TABLE `operation_log`;--> statement-breakpoint
ALTER TABLE `__new_operation_log` RENAME TO `operation_log`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `operation_log_element_idx` ON `operation_log` (`element_id`);--> statement-breakpoint
CREATE INDEX `operation_log_created_idx` ON `operation_log` (`created_at`);--> statement-breakpoint
CREATE INDEX `operation_log_batch_idx` ON `operation_log` (`batch_id`) WHERE "batch_id" IS NOT NULL;