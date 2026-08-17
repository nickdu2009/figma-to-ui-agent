ALTER TABLE `chat_messages` ADD `correlation_ref` varchar(128);--> statement-breakpoint
ALTER TABLE `chat_threads` ADD `correlation_ref` varchar(128);--> statement-breakpoint
ALTER TABLE `generation_runs` ADD `correlation_ref` varchar(128);--> statement-breakpoint
ALTER TABLE `question_sets` ADD `correlation_ref` varchar(128);--> statement-breakpoint
ALTER TABLE `chat_messages` ADD CONSTRAINT `chat_messages_correlation` UNIQUE(`thread_id`,`correlation_ref`);--> statement-breakpoint
ALTER TABLE `chat_threads` ADD CONSTRAINT `chat_threads_correlation` UNIQUE(`correlation_ref`);--> statement-breakpoint
ALTER TABLE `generation_runs` ADD CONSTRAINT `generation_runs_correlation` UNIQUE(`correlation_ref`);--> statement-breakpoint
ALTER TABLE `question_sets` ADD CONSTRAINT `question_sets_correlation` UNIQUE(`correlation_ref`);