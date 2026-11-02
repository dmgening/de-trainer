CREATE TABLE `agent_grants` (
	`agent_id` text NOT NULL,
	`scope_type` text NOT NULL,
	`scope_id` text NOT NULL,
	`permission` text NOT NULL,
	PRIMARY KEY(`agent_id`, `scope_type`, `scope_id`, `permission`),
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`agent_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `agents` (
	`agent_id` text PRIMARY KEY NOT NULL,
	`access_client_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agents_access_client_id_unique` ON `agents` (`access_client_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `agents_name_unique` ON `agents` (`name`);--> statement-breakpoint
CREATE TABLE `bank_members` (
	`bank_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'learner' NOT NULL,
	PRIMARY KEY(`bank_id`, `user_id`),
	FOREIGN KEY (`bank_id`) REFERENCES `banks`(`bank_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `banks` (
	`bank_id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`audience` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`user_id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);