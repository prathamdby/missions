CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`path` text NOT NULL,
	`created_at` text NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_path_unique` ON `projects` (`path`);
--> statement-breakpoint
CREATE TABLE `clone_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `missions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`status` text NOT NULL,
	`updated_at` text NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `missions_project_idx` ON `missions` (`project_id`,`updated_at`);
--> statement-breakpoint
CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`mission_id` text NOT NULL,
	`status` text NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `agents_mission_idx` ON `agents` (`mission_id`,`status`);
--> statement-breakpoint
CREATE TABLE `plans` (
	`id` text PRIMARY KEY NOT NULL,
	`mission_id` text NOT NULL,
	`status` text NOT NULL,
	`updated_at` text NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `plans_mission_idx` ON `plans` (`mission_id`,`status`);
--> statement-breakpoint
CREATE TABLE `todos` (
	`id` text PRIMARY KEY NOT NULL,
	`mission_id` text NOT NULL,
	`status` text NOT NULL,
	`updated_at` text NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `todos_mission_idx` ON `todos` (`mission_id`,`status`);
--> statement-breakpoint
CREATE TABLE `assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`mission_id` text NOT NULL,
	`status` text NOT NULL,
	`updated_at` text NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `assignments_mission_idx` ON `assignments` (`mission_id`,`status`);
--> statement-breakpoint
CREATE TABLE `questions` (
	`id` text PRIMARY KEY NOT NULL,
	`mission_id` text NOT NULL,
	`status` text NOT NULL,
	`updated_at` text NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `questions_mission_idx` ON `questions` (`mission_id`,`status`);
--> statement-breakpoint
CREATE TABLE `permissions` (
	`id` text PRIMARY KEY NOT NULL,
	`mission_id` text NOT NULL,
	`status` text NOT NULL,
	`updated_at` text NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `permissions_mission_idx` ON `permissions` (`mission_id`,`status`);
--> statement-breakpoint
CREATE TABLE `queue_items` (
	`id` text PRIMARY KEY NOT NULL,
	`mission_id` text NOT NULL,
	`status` text NOT NULL,
	`updated_at` text NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `queue_items_mission_idx` ON `queue_items` (`mission_id`,`status`);
--> statement-breakpoint
CREATE TABLE `artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`mission_id` text NOT NULL,
	`status` text NOT NULL,
	`updated_at` text NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `artifacts_mission_idx` ON `artifacts` (`mission_id`,`status`);
--> statement-breakpoint
CREATE TABLE `grants` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `operations` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`mission_id` text,
	`status` text NOT NULL,
	`result` text,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `operations_status_idx` ON `operations` (`status`);
--> statement-breakpoint
CREATE TABLE `transcript` (
	`id` text PRIMARY KEY NOT NULL,
	`mission_id` text NOT NULL,
	`seq` integer NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `transcript_mission_seq_idx` ON `transcript` (`mission_id`,`seq`);
--> statement-breakpoint
CREATE TABLE `events` (
	`stream` text NOT NULL,
	`seq` integer NOT NULL,
	`type` text NOT NULL,
	`at` text NOT NULL,
	`data` text NOT NULL,
	PRIMARY KEY(`stream`, `seq`)
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL
);
