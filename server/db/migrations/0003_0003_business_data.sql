CREATE TABLE `business_index_values` (
	`id` varchar(36) NOT NULL,
	`app_id` varchar(36) NOT NULL,
	`collection_key` varchar(64) NOT NULL,
	`record_id` varchar(36) NOT NULL,
	`field_key` varchar(64) NOT NULL,
	`value_text` varchar(255) COLLATE utf8mb4_bin,
	`value_number` double,
	`value_bool` boolean,
	`value_date` datetime(3),
	CONSTRAINT `business_index_values_id` PRIMARY KEY(`id`),
	CONSTRAINT `business_index_values_record_field` UNIQUE(`app_id`,`collection_key`,`record_id`,`field_key`)
);
--> statement-breakpoint
CREATE TABLE `business_record_revisions` (
	`id` varchar(36) NOT NULL,
	`app_id` varchar(36) NOT NULL,
	`record_id` varchar(36) NOT NULL,
	`revision` int NOT NULL,
	`data` json NOT NULL,
	`changed_by_user_id` varchar(36) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `business_record_revisions_id` PRIMARY KEY(`id`),
	CONSTRAINT `business_record_revisions_record_rev` UNIQUE(`record_id`,`revision`)
);
--> statement-breakpoint
CREATE TABLE `business_records` (
	`id` varchar(36) NOT NULL,
	`app_id` varchar(36) NOT NULL,
	`collection_key` varchar(64) NOT NULL,
	`data` json NOT NULL,
	`revision` int NOT NULL DEFAULT 1,
	`created_by_user_id` varchar(36) NOT NULL,
	`updated_by_user_id` varchar(36) NOT NULL,
	`subject_membership_id` varchar(36),
	`deleted_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `business_records_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `business_unique_values` (
	`id` varchar(36) NOT NULL,
	`app_id` varchar(36) NOT NULL,
	`collection_key` varchar(64) NOT NULL,
	`field_key` varchar(64) NOT NULL,
	`value_normalized` varchar(255) COLLATE utf8mb4_bin NOT NULL,
	`record_id` varchar(36) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `business_unique_values_id` PRIMARY KEY(`id`),
	CONSTRAINT `business_unique_values_key` UNIQUE(`app_id`,`collection_key`,`field_key`,`value_normalized`)
);
--> statement-breakpoint
CREATE TABLE `deleted_items` (
	`id` varchar(36) NOT NULL,
	`app_id` varchar(36) NOT NULL,
	`item_type` varchar(16) NOT NULL,
	`item_ref` varchar(64) NOT NULL,
	`collection_key` varchar(64),
	`deleted_by_user_id` varchar(36) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	CONSTRAINT `deleted_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `record_principals` (
	`id` varchar(36) NOT NULL,
	`app_id` varchar(36) NOT NULL,
	`collection_key` varchar(64) NOT NULL,
	`record_id` varchar(36) NOT NULL,
	`principal_membership_id` varchar(36) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `record_principals_id` PRIMARY KEY(`id`),
	CONSTRAINT `record_principals_key` UNIQUE(`app_id`,`collection_key`,`record_id`,`principal_membership_id`)
);
--> statement-breakpoint
CREATE INDEX `business_index_values_query` ON `business_index_values` (`app_id`,`collection_key`,`field_key`);--> statement-breakpoint
CREATE INDEX `business_record_revisions_app` ON `business_record_revisions` (`app_id`);--> statement-breakpoint
CREATE INDEX `business_records_collection` ON `business_records` (`app_id`,`collection_key`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `business_unique_values_record` ON `business_unique_values` (`record_id`);--> statement-breakpoint
CREATE INDEX `deleted_items_app` ON `deleted_items` (`app_id`,`item_type`);--> statement-breakpoint
CREATE INDEX `deleted_items_expiry` ON `deleted_items` (`expires_at`);--> statement-breakpoint
CREATE INDEX `record_principals_principal` ON `record_principals` (`principal_membership_id`);