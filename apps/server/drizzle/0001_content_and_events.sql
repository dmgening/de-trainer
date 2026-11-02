CREATE TABLE `bank_heads` (
	`bank_id` text PRIMARY KEY NOT NULL,
	`version` integer NOT NULL,
	FOREIGN KEY (`bank_id`) REFERENCES `banks`(`bank_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `bank_versions` (
	`bank_id` text NOT NULL,
	`version` integer NOT NULL,
	`kind` text NOT NULL,
	`package_id` text,
	`package_version` integer,
	`rollback_to` integer,
	`content_hash` text,
	`changelog` text NOT NULL,
	`manifest` text NOT NULL,
	`diff` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`bank_id`, `version`),
	FOREIGN KEY (`bank_id`) REFERENCES `banks`(`bank_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bank_versions_package` ON `bank_versions` (`bank_id`,`package_id`,`package_version`);--> statement-breakpoint
CREATE TABLE `content_objects` (
	`bank_id` text NOT NULL,
	`kind` text NOT NULL,
	`object_id` text NOT NULL,
	`revision` integer NOT NULL,
	`body` text NOT NULL,
	`content_hash` text NOT NULL,
	`created_version` integer NOT NULL,
	PRIMARY KEY(`bank_id`, `kind`, `object_id`, `revision`),
	FOREIGN KEY (`bank_id`) REFERENCES `banks`(`bank_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `events` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` text NOT NULL,
	`user_id` text NOT NULL,
	`device_id` text NOT NULL,
	`type` text NOT NULL,
	`actor` text NOT NULL,
	`client_ts` text NOT NULL,
	`server_received_at` text NOT NULL,
	`clock_suspect` integer NOT NULL,
	`payload` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `events_event_id_unique` ON `events` (`event_id`);--> statement-breakpoint
CREATE INDEX `events_user_seq` ON `events` (`user_id`,`seq`);--> statement-breakpoint
CREATE TABLE `media` (
	`bank_id` text NOT NULL,
	`sha256` text NOT NULL,
	`mime` text NOT NULL,
	`bytes` integer NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`bank_id`, `sha256`),
	FOREIGN KEY (`bank_id`) REFERENCES `banks`(`bank_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `recommendation_sets` (
	`user_id` text NOT NULL,
	`version` integer NOT NULL,
	`body` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `version`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `scheduler_configs` (
	`user_id` text NOT NULL,
	`version` integer NOT NULL,
	`body` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `version`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON UPDATE no action ON DELETE no action
);
