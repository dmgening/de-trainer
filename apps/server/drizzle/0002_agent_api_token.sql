ALTER TABLE `agents` ADD `api_token_hash` text;--> statement-breakpoint
ALTER TABLE `agents` ADD `api_token_created_at` text;--> statement-breakpoint
CREATE UNIQUE INDEX `agents_api_token_hash_unique` ON `agents` (`api_token_hash`);