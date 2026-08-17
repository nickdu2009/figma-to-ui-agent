CREATE TABLE `app_plans` (
	`id` varchar(36) NOT NULL,
	`app_id` varchar(36) NOT NULL,
	`generation_run_id` varchar(36),
	`payload` json NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`revision` int NOT NULL DEFAULT 1,
	CONSTRAINT `app_plans_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `apps` (
	`id` varchar(36) NOT NULL,
	`name` varchar(255) NOT NULL,
	`created_by_user_id` varchar(36) NOT NULL,
	`status` varchar(16) NOT NULL,
	`deleted_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	`revision` int NOT NULL DEFAULT 1,
	CONSTRAINT `apps_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `auth_challenges` (
	`id` varchar(36) NOT NULL,
	`email_normalized` varchar(255) NOT NULL,
	`method` varchar(16) NOT NULL,
	`token_digest` varchar(64) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`consumed_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `auth_challenges_id` PRIMARY KEY(`id`),
	CONSTRAINT `auth_challenges_token_digest` UNIQUE(`token_digest`)
);
--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` varchar(36) NOT NULL,
	`thread_id` varchar(36) NOT NULL,
	`role` varchar(16) NOT NULL,
	`content` text NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `chat_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `chat_threads` (
	`id` varchar(36) NOT NULL,
	`app_id` varchar(36) NOT NULL,
	`title` varchar(255),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	`revision` int NOT NULL DEFAULT 1,
	CONSTRAINT `chat_threads_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `creator_grants` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`granted_by_user_id` varchar(36) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`revoked_at` datetime(3),
	`active_marker` varchar(8),
	`revision` int NOT NULL DEFAULT 1,
	CONSTRAINT `creator_grants_id` PRIMARY KEY(`id`),
	CONSTRAINT `creator_grants_user_active` UNIQUE(`user_id`,`active_marker`)
);
--> statement-breakpoint
CREATE TABLE `dev_mail_inbox` (
	`id` varchar(36) NOT NULL,
	`to_email` varchar(255) NOT NULL,
	`subject` varchar(255) NOT NULL,
	`body` text NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `dev_mail_inbox_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `draft_versions` (
	`id` varchar(36) NOT NULL,
	`app_id` varchar(36) NOT NULL,
	`generation_run_id` varchar(36) NOT NULL,
	`spec` json NOT NULL,
	`business_schema` json,
	`status` varchar(16) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`revision` int NOT NULL DEFAULT 1,
	CONSTRAINT `draft_versions_id` PRIMARY KEY(`id`),
	CONSTRAINT `draft_versions_run` UNIQUE(`generation_run_id`)
);
--> statement-breakpoint
CREATE TABLE `generation_logs` (
	`id` varchar(36) NOT NULL,
	`app_id` varchar(36) NOT NULL,
	`generation_run_id` varchar(36),
	`level` varchar(16) NOT NULL,
	`message` varchar(2048) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `generation_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `generation_runs` (
	`id` varchar(36) NOT NULL,
	`app_id` varchar(36) NOT NULL,
	`status` varchar(24) NOT NULL,
	`candidate_spec` json,
	`candidate_business_schema` json,
	`diagnostics` json,
	`last_heartbeat_at` datetime(3),
	`created_by_membership_id` varchar(36),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	`revision` int NOT NULL DEFAULT 1,
	CONSTRAINT `generation_runs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `invitations` (
	`id` varchar(36) NOT NULL,
	`app_id` varchar(36) NOT NULL,
	`email_normalized` varchar(255) NOT NULL,
	`role` varchar(16) NOT NULL,
	`created_by_user_id` varchar(36) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`revoked_at` datetime(3),
	`accepted_at` datetime(3),
	`accepted_membership_id` varchar(36),
	`created_at` datetime(3) NOT NULL,
	`revision` int NOT NULL DEFAULT 1,
	CONSTRAINT `invitations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `memberships` (
	`id` varchar(36) NOT NULL,
	`app_id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`role` varchar(16) NOT NULL,
	`status` varchar(16) NOT NULL,
	`active_marker` varchar(8),
	`created_at` datetime(3) NOT NULL,
	`removed_at` datetime(3),
	`revision` int NOT NULL DEFAULT 1,
	CONSTRAINT `memberships_id` PRIMARY KEY(`id`),
	CONSTRAINT `memberships_app_user_active` UNIQUE(`app_id`,`user_id`,`active_marker`)
);
--> statement-breakpoint
CREATE TABLE `published_versions` (
	`id` varchar(36) NOT NULL,
	`app_id` varchar(36) NOT NULL,
	`draft_version_id` varchar(36),
	`spec` json NOT NULL,
	`business_schema` json,
	`business_schema_version_id` varchar(36),
	`data_access_policy_version_id` varchar(36),
	`published_by_membership_id` varchar(36) NOT NULL,
	`published_at` datetime(3) NOT NULL,
	CONSTRAINT `published_versions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `question_answers` (
	`id` varchar(36) NOT NULL,
	`question_set_id` varchar(36) NOT NULL,
	`payload` json NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `question_answers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `question_sets` (
	`id` varchar(36) NOT NULL,
	`app_id` varchar(36) NOT NULL,
	`generation_run_id` varchar(36),
	`payload` json NOT NULL,
	`status` varchar(16) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`revision` int NOT NULL DEFAULT 1,
	CONSTRAINT `question_sets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `release_pointers` (
	`app_id` varchar(36) NOT NULL,
	`published_version_id` varchar(36) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	`revision` int NOT NULL DEFAULT 1,
	CONSTRAINT `release_pointers_app_id` PRIMARY KEY(`app_id`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` varchar(36) NOT NULL,
	`token_digest` varchar(64) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`last_seen_at` datetime(3) NOT NULL,
	CONSTRAINT `sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `sessions_token_digest` UNIQUE(`token_digest`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` varchar(36) NOT NULL,
	`email_normalized` varchar(255) NOT NULL,
	`email_display` varchar(255) NOT NULL,
	`is_admin` boolean NOT NULL DEFAULT false,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	`revision` int NOT NULL DEFAULT 1,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_normalized` UNIQUE(`email_normalized`)
);
--> statement-breakpoint
CREATE INDEX `app_plans_app` ON `app_plans` (`app_id`);--> statement-breakpoint
CREATE INDEX `auth_challenges_email` ON `auth_challenges` (`email_normalized`);--> statement-breakpoint
CREATE INDEX `chat_messages_thread` ON `chat_messages` (`thread_id`);--> statement-breakpoint
CREATE INDEX `chat_threads_app` ON `chat_threads` (`app_id`);--> statement-breakpoint
CREATE INDEX `dev_mail_inbox_to` ON `dev_mail_inbox` (`to_email`);--> statement-breakpoint
CREATE INDEX `draft_versions_app` ON `draft_versions` (`app_id`);--> statement-breakpoint
CREATE INDEX `generation_logs_app` ON `generation_logs` (`app_id`);--> statement-breakpoint
CREATE INDEX `generation_logs_run` ON `generation_logs` (`generation_run_id`);--> statement-breakpoint
CREATE INDEX `generation_runs_app` ON `generation_runs` (`app_id`);--> statement-breakpoint
CREATE INDEX `invitations_app` ON `invitations` (`app_id`);--> statement-breakpoint
CREATE INDEX `memberships_user` ON `memberships` (`user_id`);--> statement-breakpoint
CREATE INDEX `memberships_app` ON `memberships` (`app_id`);--> statement-breakpoint
CREATE INDEX `published_versions_app` ON `published_versions` (`app_id`,`published_at`);--> statement-breakpoint
CREATE INDEX `question_answers_set` ON `question_answers` (`question_set_id`);--> statement-breakpoint
CREATE INDEX `question_sets_app` ON `question_sets` (`app_id`);--> statement-breakpoint
CREATE INDEX `sessions_user` ON `sessions` (`user_id`);