ALTER TABLE `agents` ADD `prompt_version` text;
--> statement-breakpoint
ALTER TABLE `agents` ADD `session_generation` integer DEFAULT 0 NOT NULL;
