-- Custom SQL migration file, put your code below! --
-- 0005 设计系统与 Catalog additive DDL（计划 S2）。
-- 由 server/persistence/additive-migration-verifier.ts 的 step 注册表生成；
-- 每个 step 以 information_schema 判断状态，只执行缺失的已知 additive 子步骤，
-- 并以固定 stepId/definitionDigest 写入 schema_migration_steps 账本（幂等）。
-- step: schema_migration_steps.create
CREATE TABLE IF NOT EXISTS `schema_migration_steps` (
  `migration_id` varchar(64) NOT NULL,
  `step_id` varchar(128) NOT NULL,
  `definition_digest` varchar(71) NOT NULL,
  `applied_at` datetime(3) NOT NULL,
  UNIQUE KEY `schema_migration_steps_key` (`migration_id`, `step_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
--> statement-breakpoint
INSERT INTO `schema_migration_steps` (`migration_id`, `step_id`, `definition_digest`, `applied_at`) VALUES ('0005', 'schema_migration_steps.create', 'sha256:756f421ce9484b0a808b96973c8ab7667f61c56d50772bd0a84265adbb197d5d', UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE `applied_at` = `applied_at`
--> statement-breakpoint
-- step: generation_runs.candidate_bundle
SET @vma_ddl := IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'generation_runs' AND column_name = 'candidate_bundle') = 0, 'ALTER TABLE `generation_runs` ADD COLUMN `candidate_bundle` JSON NULL', 'SELECT 1')
--> statement-breakpoint
PREPARE vma_stmt FROM @vma_ddl
--> statement-breakpoint
EXECUTE vma_stmt
--> statement-breakpoint
DEALLOCATE PREPARE vma_stmt
--> statement-breakpoint
INSERT INTO `schema_migration_steps` (`migration_id`, `step_id`, `definition_digest`, `applied_at`) VALUES ('0005', 'generation_runs.candidate_bundle', 'sha256:2255ebc5fd40ecbc59864f0fbc46569232382ef59b635ed3e304ce4c0ec412ba', UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE `applied_at` = `applied_at`
--> statement-breakpoint
-- step: generation_runs.catalog_version
SET @vma_ddl := IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'generation_runs' AND column_name = 'catalog_version') = 0, 'ALTER TABLE `generation_runs` ADD COLUMN `catalog_version` varchar(16) NULL', 'SELECT 1')
--> statement-breakpoint
PREPARE vma_stmt FROM @vma_ddl
--> statement-breakpoint
EXECUTE vma_stmt
--> statement-breakpoint
DEALLOCATE PREPARE vma_stmt
--> statement-breakpoint
INSERT INTO `schema_migration_steps` (`migration_id`, `step_id`, `definition_digest`, `applied_at`) VALUES ('0005', 'generation_runs.catalog_version', 'sha256:0368658479fd158aed93c8be39031a247d116ba2ba1a1b6278dca65a49268373', UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE `applied_at` = `applied_at`
--> statement-breakpoint
-- step: generation_runs.validation_issues
SET @vma_ddl := IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'generation_runs' AND column_name = 'validation_issues') = 0, 'ALTER TABLE `generation_runs` ADD COLUMN `validation_issues` JSON NULL', 'SELECT 1')
--> statement-breakpoint
PREPARE vma_stmt FROM @vma_ddl
--> statement-breakpoint
EXECUTE vma_stmt
--> statement-breakpoint
DEALLOCATE PREPARE vma_stmt
--> statement-breakpoint
INSERT INTO `schema_migration_steps` (`migration_id`, `step_id`, `definition_digest`, `applied_at`) VALUES ('0005', 'generation_runs.validation_issues', 'sha256:1cd7cf211d9aae54b3d33bb33b03c508eef8334b04e473645cac0215cb592fb8', UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE `applied_at` = `applied_at`
--> statement-breakpoint
-- step: generation_runs.fatal_visual_issues
SET @vma_ddl := IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'generation_runs' AND column_name = 'fatal_visual_issues') = 0, 'ALTER TABLE `generation_runs` ADD COLUMN `fatal_visual_issues` JSON NULL', 'SELECT 1')
--> statement-breakpoint
PREPARE vma_stmt FROM @vma_ddl
--> statement-breakpoint
EXECUTE vma_stmt
--> statement-breakpoint
DEALLOCATE PREPARE vma_stmt
--> statement-breakpoint
INSERT INTO `schema_migration_steps` (`migration_id`, `step_id`, `definition_digest`, `applied_at`) VALUES ('0005', 'generation_runs.fatal_visual_issues', 'sha256:8bbed96f4dc9aa1d1701609197a9d405e2d533e41ffafb89e8ad1de298998600', UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE `applied_at` = `applied_at`
--> statement-breakpoint
-- step: generation_runs.publish_blocked
SET @vma_ddl := IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'generation_runs' AND column_name = 'publish_blocked') = 0, 'ALTER TABLE `generation_runs` ADD COLUMN `publish_blocked` TINYINT NULL', 'SELECT 1')
--> statement-breakpoint
PREPARE vma_stmt FROM @vma_ddl
--> statement-breakpoint
EXECUTE vma_stmt
--> statement-breakpoint
DEALLOCATE PREPARE vma_stmt
--> statement-breakpoint
INSERT INTO `schema_migration_steps` (`migration_id`, `step_id`, `definition_digest`, `applied_at`) VALUES ('0005', 'generation_runs.publish_blocked', 'sha256:12298a5ccfa881a8e59ac5e3430cd157081bc8f5ef62abfa80ff774192add5e9', UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE `applied_at` = `applied_at`
--> statement-breakpoint
-- step: generation_runs.candidate_digest
SET @vma_ddl := IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'generation_runs' AND column_name = 'candidate_digest') = 0, 'ALTER TABLE `generation_runs` ADD COLUMN `candidate_digest` varchar(71) NULL', 'SELECT 1')
--> statement-breakpoint
PREPARE vma_stmt FROM @vma_ddl
--> statement-breakpoint
EXECUTE vma_stmt
--> statement-breakpoint
DEALLOCATE PREPARE vma_stmt
--> statement-breakpoint
INSERT INTO `schema_migration_steps` (`migration_id`, `step_id`, `definition_digest`, `applied_at`) VALUES ('0005', 'generation_runs.candidate_digest', 'sha256:9e2707d154fe7e8f7938b11b66a8f3c58e3e2c0a3ba0d3e83d091143c6e7a0de', UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE `applied_at` = `applied_at`
--> statement-breakpoint
-- step: generation_runs.ui_bundle_digest
SET @vma_ddl := IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'generation_runs' AND column_name = 'ui_bundle_digest') = 0, 'ALTER TABLE `generation_runs` ADD COLUMN `ui_bundle_digest` varchar(71) NULL', 'SELECT 1')
--> statement-breakpoint
PREPARE vma_stmt FROM @vma_ddl
--> statement-breakpoint
EXECUTE vma_stmt
--> statement-breakpoint
DEALLOCATE PREPARE vma_stmt
--> statement-breakpoint
INSERT INTO `schema_migration_steps` (`migration_id`, `step_id`, `definition_digest`, `applied_at`) VALUES ('0005', 'generation_runs.ui_bundle_digest', 'sha256:42a896d8be3a246f86dd94c777d0d028961c5ea0c2b35013f390a83ac8df0201', UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE `applied_at` = `applied_at`
--> statement-breakpoint
-- step: generation_runs.digest_version
SET @vma_ddl := IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'generation_runs' AND column_name = 'digest_version') = 0, 'ALTER TABLE `generation_runs` ADD COLUMN `digest_version` INT NULL', 'SELECT 1')
--> statement-breakpoint
PREPARE vma_stmt FROM @vma_ddl
--> statement-breakpoint
EXECUTE vma_stmt
--> statement-breakpoint
DEALLOCATE PREPARE vma_stmt
--> statement-breakpoint
INSERT INTO `schema_migration_steps` (`migration_id`, `step_id`, `definition_digest`, `applied_at`) VALUES ('0005', 'generation_runs.digest_version', 'sha256:d6e0fe2574a0489a32c54d990a862057ae842874ac2f647e7cab438c63e25ca1', UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE `applied_at` = `applied_at`
--> statement-breakpoint
-- step: generation_runs.validation_profile_version
SET @vma_ddl := IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'generation_runs' AND column_name = 'validation_profile_version') = 0, 'ALTER TABLE `generation_runs` ADD COLUMN `validation_profile_version` varchar(32) NULL', 'SELECT 1')
--> statement-breakpoint
PREPARE vma_stmt FROM @vma_ddl
--> statement-breakpoint
EXECUTE vma_stmt
--> statement-breakpoint
DEALLOCATE PREPARE vma_stmt
--> statement-breakpoint
INSERT INTO `schema_migration_steps` (`migration_id`, `step_id`, `definition_digest`, `applied_at`) VALUES ('0005', 'generation_runs.validation_profile_version', 'sha256:deb0b5dae218c8668bc32568882d15152607e68447472ec305d11a51283c0d8d', UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE `applied_at` = `applied_at`
--> statement-breakpoint
-- step: generation_runs.validation_report
SET @vma_ddl := IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'generation_runs' AND column_name = 'validation_report') = 0, 'ALTER TABLE `generation_runs` ADD COLUMN `validation_report` JSON NULL', 'SELECT 1')
--> statement-breakpoint
PREPARE vma_stmt FROM @vma_ddl
--> statement-breakpoint
EXECUTE vma_stmt
--> statement-breakpoint
DEALLOCATE PREPARE vma_stmt
--> statement-breakpoint
INSERT INTO `schema_migration_steps` (`migration_id`, `step_id`, `definition_digest`, `applied_at`) VALUES ('0005', 'generation_runs.validation_report', 'sha256:456e7f14f8f2dd3174e8c1290e2756bb753e29ff360bbc8cc0c13087bd07167c', UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE `applied_at` = `applied_at`
--> statement-breakpoint
-- step: generation_runs.report_digest
SET @vma_ddl := IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'generation_runs' AND column_name = 'report_digest') = 0, 'ALTER TABLE `generation_runs` ADD COLUMN `report_digest` varchar(71) NULL', 'SELECT 1')
--> statement-breakpoint
PREPARE vma_stmt FROM @vma_ddl
--> statement-breakpoint
EXECUTE vma_stmt
--> statement-breakpoint
DEALLOCATE PREPARE vma_stmt
--> statement-breakpoint
INSERT INTO `schema_migration_steps` (`migration_id`, `step_id`, `definition_digest`, `applied_at`) VALUES ('0005', 'generation_runs.report_digest', 'sha256:0754a221aa97948facf75ada1b64042d28bed2d387ffa46a423e5acb2808788d', UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE `applied_at` = `applied_at`
--> statement-breakpoint
-- step: generation_runs.candidate_migration_plan
SET @vma_ddl := IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'generation_runs' AND column_name = 'candidate_migration_plan') = 0, 'ALTER TABLE `generation_runs` ADD COLUMN `candidate_migration_plan` JSON NULL', 'SELECT 1')
--> statement-breakpoint
PREPARE vma_stmt FROM @vma_ddl
--> statement-breakpoint
EXECUTE vma_stmt
--> statement-breakpoint
DEALLOCATE PREPARE vma_stmt
--> statement-breakpoint
INSERT INTO `schema_migration_steps` (`migration_id`, `step_id`, `definition_digest`, `applied_at`) VALUES ('0005', 'generation_runs.candidate_migration_plan', 'sha256:28b7907d4fb70dd8a30013baa601584591aadd688c580ef1c04bb827c4ed8955', UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE `applied_at` = `applied_at`
--> statement-breakpoint
-- step: generation_runs.candidate_reverse_migration_plan
SET @vma_ddl := IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'generation_runs' AND column_name = 'candidate_reverse_migration_plan') = 0, 'ALTER TABLE `generation_runs` ADD COLUMN `candidate_reverse_migration_plan` JSON NULL', 'SELECT 1')
--> statement-breakpoint
PREPARE vma_stmt FROM @vma_ddl
--> statement-breakpoint
EXECUTE vma_stmt
--> statement-breakpoint
DEALLOCATE PREPARE vma_stmt
--> statement-breakpoint
INSERT INTO `schema_migration_steps` (`migration_id`, `step_id`, `definition_digest`, `applied_at`) VALUES ('0005', 'generation_runs.candidate_reverse_migration_plan', 'sha256:02d3978a2badb94ab5e6b90031f24f0529172df7c3db26474b014124869c0ee0', UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE `applied_at` = `applied_at`
--> statement-breakpoint
-- step: generation_runs.migration_from_published_version_id
SET @vma_ddl := IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'generation_runs' AND column_name = 'migration_from_published_version_id') = 0, 'ALTER TABLE `generation_runs` ADD COLUMN `migration_from_published_version_id` varchar(36) NULL', 'SELECT 1')
--> statement-breakpoint
PREPARE vma_stmt FROM @vma_ddl
--> statement-breakpoint
EXECUTE vma_stmt
--> statement-breakpoint
DEALLOCATE PREPARE vma_stmt
--> statement-breakpoint
INSERT INTO `schema_migration_steps` (`migration_id`, `step_id`, `definition_digest`, `applied_at`) VALUES ('0005', 'generation_runs.migration_from_published_version_id', 'sha256:ba5990581f966c87fb4a705790e7ddcb6eddf9d9e846a42dc686c419a7aa6d6c', UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE `applied_at` = `applied_at`
--> statement-breakpoint
-- step: generation_runs.migration_from_schema_digest
SET @vma_ddl := IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'generation_runs' AND column_name = 'migration_from_schema_digest') = 0, 'ALTER TABLE `generation_runs` ADD COLUMN `migration_from_schema_digest` varchar(71) NULL', 'SELECT 1')
--> statement-breakpoint
PREPARE vma_stmt FROM @vma_ddl
--> statement-breakpoint
EXECUTE vma_stmt
--> statement-breakpoint
DEALLOCATE PREPARE vma_stmt
--> statement-breakpoint
INSERT INTO `schema_migration_steps` (`migration_id`, `step_id`, `definition_digest`, `applied_at`) VALUES ('0005', 'generation_runs.migration_from_schema_digest', 'sha256:33ef8bb834c0ed0d7e59c72b24b3d32d5ec7b2e20f3d45c7d7d2cae8c5cffff0', UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE `applied_at` = `applied_at`
--> statement-breakpoint
-- step: generation_runs.migration_to_schema_digest
SET @vma_ddl := IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'generation_runs' AND column_name = 'migration_to_schema_digest') = 0, 'ALTER TABLE `generation_runs` ADD COLUMN `migration_to_schema_digest` varchar(71) NULL', 'SELECT 1')
--> statement-breakpoint
PREPARE vma_stmt FROM @vma_ddl
--> statement-breakpoint
EXECUTE vma_stmt
--> statement-breakpoint
DEALLOCATE PREPARE vma_stmt
--> statement-breakpoint
INSERT INTO `schema_migration_steps` (`migration_id`, `step_id`, `definition_digest`, `applied_at`) VALUES ('0005', 'generation_runs.migration_to_schema_digest', 'sha256:5537f29ff7c2e048b5466282e354924f50e3779bfa9a02ca1c4738e5093e1527', UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE `applied_at` = `applied_at`
--> statement-breakpoint
-- step: generation_runs.brand_source_snapshot
SET @vma_ddl := IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'generation_runs' AND column_name = 'brand_source_snapshot') = 0, 'ALTER TABLE `generation_runs` ADD COLUMN `brand_source_snapshot` JSON NULL', 'SELECT 1')
--> statement-breakpoint
PREPARE vma_stmt FROM @vma_ddl
--> statement-breakpoint
EXECUTE vma_stmt
--> statement-breakpoint
DEALLOCATE PREPARE vma_stmt
--> statement-breakpoint
INSERT INTO `schema_migration_steps` (`migration_id`, `step_id`, `definition_digest`, `applied_at`) VALUES ('0005', 'generation_runs.brand_source_snapshot', 'sha256:0e1f9ece8d24df554483c6dbdbc9ce29aab4d684ad128f000e8766dfeb08ebfb', UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE `applied_at` = `applied_at`
--> statement-breakpoint
-- step: generation_runs.generation_context_digest
SET @vma_ddl := IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'generation_runs' AND column_name = 'generation_context_digest') = 0, 'ALTER TABLE `generation_runs` ADD COLUMN `generation_context_digest` varchar(71) NULL', 'SELECT 1')
--> statement-breakpoint
PREPARE vma_stmt FROM @vma_ddl
--> statement-breakpoint
EXECUTE vma_stmt
--> statement-breakpoint
DEALLOCATE PREPARE vma_stmt
--> statement-breakpoint
INSERT INTO `schema_migration_steps` (`migration_id`, `step_id`, `definition_digest`, `applied_at`) VALUES ('0005', 'generation_runs.generation_context_digest', 'sha256:13202aa3d043902dff7207e62192d88870feb4297cbae788bcb0cf625b6985a4', UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE `applied_at` = `applied_at`
--> statement-breakpoint
-- step: draft_versions.bundle
SET @vma_ddl := IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'draft_versions' AND column_name = 'bundle') = 0, 'ALTER TABLE `draft_versions` ADD COLUMN `bundle` JSON NULL', 'SELECT 1')
--> statement-breakpoint
PREPARE vma_stmt FROM @vma_ddl
--> statement-breakpoint
EXECUTE vma_stmt
--> statement-breakpoint
DEALLOCATE PREPARE vma_stmt
--> statement-breakpoint
INSERT INTO `schema_migration_steps` (`migration_id`, `step_id`, `definition_digest`, `applied_at`) VALUES ('0005', 'draft_versions.bundle', 'sha256:a61733380c4f2d7d8e387864f83ad1f39bf43e208764f44a1e090836c2b39827', UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE `applied_at` = `applied_at`
--> statement-breakpoint
-- step: draft_versions.catalog_version
SET @vma_ddl := IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'draft_versions' AND column_name = 'catalog_version') = 0, 'ALTER TABLE `draft_versions` ADD COLUMN `catalog_version` varchar(16) NULL', 'SELECT 1')
--> statement-breakpoint
PREPARE vma_stmt FROM @vma_ddl
--> statement-breakpoint
EXECUTE vma_stmt
--> statement-breakpoint
DEALLOCATE PREPARE vma_stmt
--> statement-breakpoint
INSERT INTO `schema_migration_steps` (`migration_id`, `step_id`, `definition_digest`, `applied_at`) VALUES ('0005', 'draft_versions.catalog_version', 'sha256:5e188293954b3d2444201585787045b409cbca7cd15342f08a48d44d926b610a', UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE `applied_at` = `applied_at`
--> statement-breakpoint
-- step: draft_versions.validation_issues
SET @vma_ddl := IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'draft_versions' AND column_name = 'validation_issues') = 0, 'ALTER TABLE `draft_versions` ADD COLUMN `validation_issues` JSON NULL', 'SELECT 1')
--> statement-breakpoint
PREPARE vma_stmt FROM @vma_ddl
--> statement-breakpoint
EXECUTE vma_stmt
--> statement-breakpoint
DEALLOCATE PREPARE vma_stmt
--> statement-breakpoint
INSERT INTO `schema_migration_steps` (`migration_id`, `step_id`, `definition_digest`, `applied_at`) VALUES ('0005', 'draft_versions.validation_issues', 'sha256:d22d5b2d55e99489d5de1700dd2d064ecf26eab32ef18cb9196921c013bd0e07', UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE `applied_at` = `applied_at`
--> statement-breakpoint
-- step: draft_versions.publish_blocked
SET @vma_ddl := IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'draft_versions' AND column_name = 'publish_blocked') = 0, 'ALTER TABLE `draft_versions` ADD COLUMN `publish_blocked` TINYINT NULL', 'SELECT 1')
--> statement-breakpoint
PREPARE vma_stmt FROM @vma_ddl
--> statement-breakpoint
EXECUTE vma_stmt
--> statement-breakpoint
DEALLOCATE PREPARE vma_stmt
--> statement-breakpoint
INSERT INTO `schema_migration_steps` (`migration_id`, `step_id`, `definition_digest`, `applied_at`) VALUES ('0005', 'draft_versions.publish_blocked', 'sha256:7e8ddc1893bd9583e8170a1117e2efc0f13c62d170d75d066043103638c82ea9', UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE `applied_at` = `applied_at`
--> statement-breakpoint
-- step: draft_versions.candidate_digest
SET @vma_ddl := IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'draft_versions' AND column_name = 'candidate_digest') = 0, 'ALTER TABLE `draft_versions` ADD COLUMN `candidate_digest` varchar(71) NULL', 'SELECT 1')
--> statement-breakpoint
PREPARE vma_stmt FROM @vma_ddl
--> statement-breakpoint
EXECUTE vma_stmt
--> statement-breakpoint
DEALLOCATE PREPARE vma_stmt
--> statement-breakpoint
INSERT INTO `schema_migration_steps` (`migration_id`, `step_id`, `definition_digest`, `applied_at`) VALUES ('0005', 'draft_versions.candidate_digest', 'sha256:85f9d9331ac678288658a4b34eec5c2dd44d9398b43397aaca1ad764d7307042', UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE `applied_at` = `applied_at`
--> statement-breakpoint
-- step: draft_versions.ui_bundle_digest
SET @vma_ddl := IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'draft_versions' AND column_name = 'ui_bundle_digest') = 0, 'ALTER TABLE `draft_versions` ADD COLUMN `ui_bundle_digest` varchar(71) NULL', 'SELECT 1')
--> statement-breakpoint
PREPARE vma_stmt FROM @vma_ddl
--> statement-breakpoint
EXECUTE vma_stmt
--> statement-breakpoint
DEALLOCATE PREPARE vma_stmt
--> statement-breakpoint
INSERT INTO `schema_migration_steps` (`migration_id`, `step_id`, `definition_digest`, `applied_at`) VALUES ('0005', 'draft_versions.ui_bundle_digest', 'sha256:d0b8cbba18567dd79f7315c3335b4386a7e8f1a32fb79b1a1210f879988d4a58', UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE `applied_at` = `applied_at`
--> statement-breakpoint
-- step: draft_versions.digest_version
SET @vma_ddl := IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'draft_versions' AND column_name = 'digest_version') = 0, 'ALTER TABLE `draft_versions` ADD COLUMN `digest_version` INT NULL', 'SELECT 1')
--> statement-breakpoint
PREPARE vma_stmt FROM @vma_ddl
--> statement-breakpoint
EXECUTE vma_stmt
--> statement-breakpoint
DEALLOCATE PREPARE vma_stmt
--> statement-breakpoint
INSERT INTO `schema_migration_steps` (`migration_id`, `step_id`, `definition_digest`, `applied_at`) VALUES ('0005', 'draft_versions.digest_version', 'sha256:bb032d6e41afa16e2e4ed6e13ee77e605b3f04c64bd5331177864d2f911d1e49', UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE `applied_at` = `applied_at`
--> statement-breakpoint
-- step: draft_versions.migration_plan
SET @vma_ddl := IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'draft_versions' AND column_name = 'migration_plan') = 0, 'ALTER TABLE `draft_versions` ADD COLUMN `migration_plan` JSON NULL', 'SELECT 1')
--> statement-breakpoint
PREPARE vma_stmt FROM @vma_ddl
--> statement-breakpoint
EXECUTE vma_stmt
--> statement-breakpoint
DEALLOCATE PREPARE vma_stmt
--> statement-breakpoint
INSERT INTO `schema_migration_steps` (`migration_id`, `step_id`, `definition_digest`, `applied_at`) VALUES ('0005', 'draft_versions.migration_plan', 'sha256:2a5616192233085f93775a107450a4310ca4393ddebbd9e4b001ba0fd33ae667', UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE `applied_at` = `applied_at`
--> statement-breakpoint
-- step: draft_versions.reverse_plan
SET @vma_ddl := IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'draft_versions' AND column_name = 'reverse_plan') = 0, 'ALTER TABLE `draft_versions` ADD COLUMN `reverse_plan` JSON NULL', 'SELECT 1')
--> statement-breakpoint
PREPARE vma_stmt FROM @vma_ddl
--> statement-breakpoint
EXECUTE vma_stmt
--> statement-breakpoint
DEALLOCATE PREPARE vma_stmt
--> statement-breakpoint
INSERT INTO `schema_migration_steps` (`migration_id`, `step_id`, `definition_digest`, `applied_at`) VALUES ('0005', 'draft_versions.reverse_plan', 'sha256:1784ec4249998f1043019953ae746d3c823aecae0e9a95b90938837cf55e2c75', UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE `applied_at` = `applied_at`
--> statement-breakpoint
-- step: draft_versions.migration_from_published_version_id
SET @vma_ddl := IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'draft_versions' AND column_name = 'migration_from_published_version_id') = 0, 'ALTER TABLE `draft_versions` ADD COLUMN `migration_from_published_version_id` varchar(36) NULL', 'SELECT 1')
--> statement-breakpoint
PREPARE vma_stmt FROM @vma_ddl
--> statement-breakpoint
EXECUTE vma_stmt
--> statement-breakpoint
DEALLOCATE PREPARE vma_stmt
--> statement-breakpoint
INSERT INTO `schema_migration_steps` (`migration_id`, `step_id`, `definition_digest`, `applied_at`) VALUES ('0005', 'draft_versions.migration_from_published_version_id', 'sha256:a704e7453b13f0dc6d8c05274c35cc01584daae28867e4e4e646157ba3397dc6', UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE `applied_at` = `applied_at`
--> statement-breakpoint
-- step: draft_versions.migration_from_schema_digest
SET @vma_ddl := IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'draft_versions' AND column_name = 'migration_from_schema_digest') = 0, 'ALTER TABLE `draft_versions` ADD COLUMN `migration_from_schema_digest` varchar(71) NULL', 'SELECT 1')
--> statement-breakpoint
PREPARE vma_stmt FROM @vma_ddl
--> statement-breakpoint
EXECUTE vma_stmt
--> statement-breakpoint
DEALLOCATE PREPARE vma_stmt
--> statement-breakpoint
INSERT INTO `schema_migration_steps` (`migration_id`, `step_id`, `definition_digest`, `applied_at`) VALUES ('0005', 'draft_versions.migration_from_schema_digest', 'sha256:d680aa189314dd0bc0fb0abb21127046c11c787502382d66f3fd050e9eb314d0', UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE `applied_at` = `applied_at`
--> statement-breakpoint
-- step: draft_versions.migration_to_schema_digest
SET @vma_ddl := IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'draft_versions' AND column_name = 'migration_to_schema_digest') = 0, 'ALTER TABLE `draft_versions` ADD COLUMN `migration_to_schema_digest` varchar(71) NULL', 'SELECT 1')
--> statement-breakpoint
PREPARE vma_stmt FROM @vma_ddl
--> statement-breakpoint
EXECUTE vma_stmt
--> statement-breakpoint
DEALLOCATE PREPARE vma_stmt
--> statement-breakpoint
INSERT INTO `schema_migration_steps` (`migration_id`, `step_id`, `definition_digest`, `applied_at`) VALUES ('0005', 'draft_versions.migration_to_schema_digest', 'sha256:9d1f30f1a4301764b3d89a4be4a14ab5ef611b728bee78298bebf459243a29c5', UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE `applied_at` = `applied_at`
--> statement-breakpoint
-- step: published_versions.bundle
SET @vma_ddl := IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'published_versions' AND column_name = 'bundle') = 0, 'ALTER TABLE `published_versions` ADD COLUMN `bundle` JSON NULL', 'SELECT 1')
--> statement-breakpoint
PREPARE vma_stmt FROM @vma_ddl
--> statement-breakpoint
EXECUTE vma_stmt
--> statement-breakpoint
DEALLOCATE PREPARE vma_stmt
--> statement-breakpoint
INSERT INTO `schema_migration_steps` (`migration_id`, `step_id`, `definition_digest`, `applied_at`) VALUES ('0005', 'published_versions.bundle', 'sha256:096458a501f624d15dbc2792e8951ca4e5d285ad8d6d5e5dd76271d37c4fad7a', UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE `applied_at` = `applied_at`
--> statement-breakpoint
-- step: published_versions.catalog_version
SET @vma_ddl := IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'published_versions' AND column_name = 'catalog_version') = 0, 'ALTER TABLE `published_versions` ADD COLUMN `catalog_version` varchar(16) NULL', 'SELECT 1')
--> statement-breakpoint
PREPARE vma_stmt FROM @vma_ddl
--> statement-breakpoint
EXECUTE vma_stmt
--> statement-breakpoint
DEALLOCATE PREPARE vma_stmt
--> statement-breakpoint
INSERT INTO `schema_migration_steps` (`migration_id`, `step_id`, `definition_digest`, `applied_at`) VALUES ('0005', 'published_versions.catalog_version', 'sha256:9af035686fdd1b7b793a04ec9fbc3049618dac033cd31c71a42e2aae9d58f7f2', UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE `applied_at` = `applied_at`
--> statement-breakpoint
-- step: published_versions.candidate_digest
SET @vma_ddl := IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'published_versions' AND column_name = 'candidate_digest') = 0, 'ALTER TABLE `published_versions` ADD COLUMN `candidate_digest` varchar(71) NULL', 'SELECT 1')
--> statement-breakpoint
PREPARE vma_stmt FROM @vma_ddl
--> statement-breakpoint
EXECUTE vma_stmt
--> statement-breakpoint
DEALLOCATE PREPARE vma_stmt
--> statement-breakpoint
INSERT INTO `schema_migration_steps` (`migration_id`, `step_id`, `definition_digest`, `applied_at`) VALUES ('0005', 'published_versions.candidate_digest', 'sha256:240ffda4622b89d289dd47eb9603b0a3e2afa929f25ba84336b0e92e3bb08426', UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE `applied_at` = `applied_at`
--> statement-breakpoint
-- step: published_versions.ui_bundle_digest
SET @vma_ddl := IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'published_versions' AND column_name = 'ui_bundle_digest') = 0, 'ALTER TABLE `published_versions` ADD COLUMN `ui_bundle_digest` varchar(71) NULL', 'SELECT 1')
--> statement-breakpoint
PREPARE vma_stmt FROM @vma_ddl
--> statement-breakpoint
EXECUTE vma_stmt
--> statement-breakpoint
DEALLOCATE PREPARE vma_stmt
--> statement-breakpoint
INSERT INTO `schema_migration_steps` (`migration_id`, `step_id`, `definition_digest`, `applied_at`) VALUES ('0005', 'published_versions.ui_bundle_digest', 'sha256:cc790ee3b346a85ad7ae9f51c1c515fb1721b3e80f3dba5e00cbceb8353de235', UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE `applied_at` = `applied_at`
--> statement-breakpoint
-- step: published_versions.digest_version
SET @vma_ddl := IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'published_versions' AND column_name = 'digest_version') = 0, 'ALTER TABLE `published_versions` ADD COLUMN `digest_version` INT NULL', 'SELECT 1')
--> statement-breakpoint
PREPARE vma_stmt FROM @vma_ddl
--> statement-breakpoint
EXECUTE vma_stmt
--> statement-breakpoint
DEALLOCATE PREPARE vma_stmt
--> statement-breakpoint
INSERT INTO `schema_migration_steps` (`migration_id`, `step_id`, `definition_digest`, `applied_at`) VALUES ('0005', 'published_versions.digest_version', 'sha256:f28b01e056ef8eccf303338152244c8faf0438eb36f8b73c65822df8c794f72b', UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE `applied_at` = `applied_at`
--> statement-breakpoint
-- step: published_versions.migration_from_published_version_id
SET @vma_ddl := IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'published_versions' AND column_name = 'migration_from_published_version_id') = 0, 'ALTER TABLE `published_versions` ADD COLUMN `migration_from_published_version_id` varchar(36) NULL', 'SELECT 1')
--> statement-breakpoint
PREPARE vma_stmt FROM @vma_ddl
--> statement-breakpoint
EXECUTE vma_stmt
--> statement-breakpoint
DEALLOCATE PREPARE vma_stmt
--> statement-breakpoint
INSERT INTO `schema_migration_steps` (`migration_id`, `step_id`, `definition_digest`, `applied_at`) VALUES ('0005', 'published_versions.migration_from_published_version_id', 'sha256:1cc3cd9d5edc2d708a8767a7ca4913b58b06799c3a0990d63915771871ee7de2', UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE `applied_at` = `applied_at`
--> statement-breakpoint
-- step: published_versions.migration_from_schema_digest
SET @vma_ddl := IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'published_versions' AND column_name = 'migration_from_schema_digest') = 0, 'ALTER TABLE `published_versions` ADD COLUMN `migration_from_schema_digest` varchar(71) NULL', 'SELECT 1')
--> statement-breakpoint
PREPARE vma_stmt FROM @vma_ddl
--> statement-breakpoint
EXECUTE vma_stmt
--> statement-breakpoint
DEALLOCATE PREPARE vma_stmt
--> statement-breakpoint
INSERT INTO `schema_migration_steps` (`migration_id`, `step_id`, `definition_digest`, `applied_at`) VALUES ('0005', 'published_versions.migration_from_schema_digest', 'sha256:8acd2b7f8ba8a8873e23bc37182c25a179845bc75b7efbab3ec0ee0acabc6ea1', UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE `applied_at` = `applied_at`
--> statement-breakpoint
-- step: published_versions.business_schema_digest
SET @vma_ddl := IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'published_versions' AND column_name = 'business_schema_digest') = 0, 'ALTER TABLE `published_versions` ADD COLUMN `business_schema_digest` varchar(71) NULL', 'SELECT 1')
--> statement-breakpoint
PREPARE vma_stmt FROM @vma_ddl
--> statement-breakpoint
EXECUTE vma_stmt
--> statement-breakpoint
DEALLOCATE PREPARE vma_stmt
--> statement-breakpoint
INSERT INTO `schema_migration_steps` (`migration_id`, `step_id`, `definition_digest`, `applied_at`) VALUES ('0005', 'published_versions.business_schema_digest', 'sha256:186bc8d143a3d92f3bb970b079814d04c72a1352d00102b956eb265a7b954410', UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE `applied_at` = `applied_at`
--> statement-breakpoint
-- step: preview_selections.create
CREATE TABLE IF NOT EXISTS `preview_selections` (
  `app_id` varchar(36) NOT NULL,
  `membership_id` varchar(36) NOT NULL,
  `kind` varchar(16) NOT NULL,
  `version_id` varchar(36) NULL,
  `revision` INT NULL,
  `updated_at` datetime(3) NOT NULL,
  UNIQUE KEY `preview_selections_app_membership` (`app_id`, `membership_id`),
  KEY `preview_selections_membership` (`membership_id`),
  CONSTRAINT `preview_selections_membership` FOREIGN KEY (`membership_id`) REFERENCES `memberships` (`id`),
  CONSTRAINT `preview_selections_kind_version` CHECK ((`kind` = 'draft' AND `version_id` IS NOT NULL AND `revision` IS NOT NULL) OR (`kind` IN ('empty','published') AND `version_id` IS NULL AND `revision` IS NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
--> statement-breakpoint
INSERT INTO `schema_migration_steps` (`migration_id`, `step_id`, `definition_digest`, `applied_at`) VALUES ('0005', 'preview_selections.create', 'sha256:3b96d69b67bbd1b02007822f8692eadc68ab9bb8d6595b4e73bddcf91c686f4e', UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE `applied_at` = `applied_at`
--> statement-breakpoint
-- step: generation_recovery_records.create
CREATE TABLE IF NOT EXISTS `generation_recovery_records` (
  `id` varchar(36) NOT NULL,
  `app_id` varchar(36) NOT NULL,
  `failed_generation_id` varchar(36) NOT NULL,
  `failed_candidate_digest` varchar(71) NOT NULL,
  `status` varchar(16) NOT NULL,
  `decision` varchar(16) NULL,
  `decided_by` varchar(36) NULL,
  `decided_at` datetime(3) NULL,
  `decision_expires_at` datetime(3) NOT NULL,
  `expired_at` datetime(3) NULL,
  `successor_generation_id` varchar(36) NULL,
  `stable_result_code` varchar(64) NULL,
  `created_at` datetime(3) NOT NULL,
  `revision` INT NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `generation_recovery_records_key` (`app_id`, `failed_generation_id`, `failed_candidate_digest`),
  KEY `generation_recovery_records_expiry` (`status`, `decision_expires_at`),
  KEY `generation_recovery_records_app_expiry` (`app_id`, `status`, `decision_expires_at`),
  KEY `generation_recovery_records_successor` (`successor_generation_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
--> statement-breakpoint
INSERT INTO `schema_migration_steps` (`migration_id`, `step_id`, `definition_digest`, `applied_at`) VALUES ('0005', 'generation_recovery_records.create', 'sha256:9fcf633d2fbe6826ba8a9958627c547820ed1004fb17bac71f1eb4500079b08d', UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE `applied_at` = `applied_at`
--> statement-breakpoint
-- step: design_asset_blobs.create
CREATE TABLE IF NOT EXISTS `design_asset_blobs` (
  `content_hash` varchar(71) NOT NULL,
  `mime_type` varchar(128) NOT NULL,
  `byte_length` BIGINT NOT NULL,
  `kind` varchar(16) NOT NULL,
  `status` varchar(16) NOT NULL,
  `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`content_hash`),
  KEY `design_asset_blobs_kind` (`kind`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
--> statement-breakpoint
INSERT INTO `schema_migration_steps` (`migration_id`, `step_id`, `definition_digest`, `applied_at`) VALUES ('0005', 'design_asset_blobs.create', 'sha256:c61867cba8b2fc629f441f65beec4076942fae9195e00defc700931d8e1f94d8', UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE `applied_at` = `applied_at`
--> statement-breakpoint
-- step: design_asset_sources.create
CREATE TABLE IF NOT EXISTS `design_asset_sources` (
  `id` varchar(36) NOT NULL,
  `app_id` varchar(36) NOT NULL,
  `created_by_membership_id` varchar(36) NOT NULL,
  `blob_content_hash` varchar(71) NOT NULL,
  `purpose` varchar(32) NOT NULL,
  `display_name` varchar(255) NOT NULL,
  `status` varchar(16) NOT NULL,
  `ready_extraction_id` varchar(36) NULL,
  `created_at` datetime(3) NOT NULL,
  `retention_until` datetime(3) NULL,
  `deleted_at` datetime(3) NULL,
  `revision` INT NOT NULL,
  PRIMARY KEY (`id`),
  KEY `design_asset_sources_app_status` (`app_id`, `status`),
  KEY `design_asset_sources_blob` (`blob_content_hash`),
  KEY `design_asset_sources_ready_extraction` (`ready_extraction_id`),
  CONSTRAINT `design_asset_sources_blob_fk` FOREIGN KEY (`blob_content_hash`) REFERENCES `design_asset_blobs` (`content_hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
--> statement-breakpoint
INSERT INTO `schema_migration_steps` (`migration_id`, `step_id`, `definition_digest`, `applied_at`) VALUES ('0005', 'design_asset_sources.create', 'sha256:776cac8288cd7fdad6a860fdd343442a3bce45dddf38aa754d0b9e26af65ee58', UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE `applied_at` = `applied_at`
--> statement-breakpoint
-- step: design_asset_extractions.create
CREATE TABLE IF NOT EXISTS `design_asset_extractions` (
  `id` varchar(36) NOT NULL,
  `source_id` varchar(36) NOT NULL,
  `source_content_hash` varchar(71) NOT NULL,
  `extractor_profile_version` varchar(64) NOT NULL,
  `schema_version` INT NOT NULL,
  `structured_summary` JSON NOT NULL,
  `summary_digest` varchar(71) NOT NULL,
  `byte_length` INT NOT NULL,
  `status` varchar(16) NOT NULL,
  `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `design_asset_extractions_source` (`source_id`),
  KEY `design_asset_extractions_blob` (`source_content_hash`),
  CONSTRAINT `design_asset_extractions_source_fk` FOREIGN KEY (`source_id`) REFERENCES `design_asset_sources` (`id`),
  CONSTRAINT `design_asset_extractions_blob_fk` FOREIGN KEY (`source_content_hash`) REFERENCES `design_asset_blobs` (`content_hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
--> statement-breakpoint
INSERT INTO `schema_migration_steps` (`migration_id`, `step_id`, `definition_digest`, `applied_at`) VALUES ('0005', 'design_asset_extractions.create', 'sha256:9f2508f0d334d8aa8dff5bcabe4403229d2d2d21ff27645aacb05c9f76bc0eff', UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE `applied_at` = `applied_at`
--> statement-breakpoint
-- step: design_asset_extraction_jobs.create
CREATE TABLE IF NOT EXISTS `design_asset_extraction_jobs` (
  `id` varchar(36) NOT NULL,
  `app_id` varchar(36) NOT NULL,
  `source_id` varchar(36) NOT NULL,
  `source_content_hash` varchar(71) NOT NULL,
  `extractor_profile_version` varchar(64) NOT NULL,
  `status` varchar(16) NOT NULL,
  `lease_owner` varchar(128) NULL,
  `lease_expires_at` datetime(3) NULL,
  `result_extraction_id` varchar(36) NULL,
  `stable_error_code` varchar(64) NULL,
  `created_at` datetime(3) NOT NULL,
  `started_at` datetime(3) NULL,
  `completed_at` datetime(3) NULL,
  `revision` INT NOT NULL,
  PRIMARY KEY (`id`),
  KEY `design_asset_extraction_jobs_source` (`source_id`, `status`),
  KEY `design_asset_extraction_jobs_lease` (`status`, `lease_expires_at`),
  CONSTRAINT `design_asset_extraction_jobs_source_fk` FOREIGN KEY (`source_id`) REFERENCES `design_asset_sources` (`id`),
  CONSTRAINT `extraction_jobs_status_result` CHECK ((`status` IN ('queued','running') AND `result_extraction_id` IS NULL) OR (`status` = 'succeeded' AND `result_extraction_id` IS NOT NULL) OR (`status` = 'failed' AND `result_extraction_id` IS NULL AND `stable_error_code` IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
--> statement-breakpoint
INSERT INTO `schema_migration_steps` (`migration_id`, `step_id`, `definition_digest`, `applied_at`) VALUES ('0005', 'design_asset_extraction_jobs.create', 'sha256:a564a3f359c8d0afcbc365b13e478cec353892143dcdee1dd25c75365deb5925', UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE `applied_at` = `applied_at`
--> statement-breakpoint
-- step: business_action_idempotency.create
CREATE TABLE IF NOT EXISTS `business_action_idempotency` (
  `id` varchar(36) NOT NULL,
  `app_id` varchar(36) NOT NULL,
  `membership_id` varchar(36) NOT NULL,
  `canonical_action_name` varchar(64) NOT NULL,
  `idempotency_key` varchar(128) NOT NULL,
  `protocol_version` INT NOT NULL,
  `published_version_id` varchar(36) NULL,
  `request_hash` varchar(71) NOT NULL,
  `status` varchar(16) NOT NULL,
  `result_ref` varchar(255) NULL,
  `result_digest` varchar(71) NULL,
  `stable_result_code` varchar(64) NULL,
  `created_at` datetime(3) NOT NULL,
  `completed_at` datetime(3) NULL,
  `expires_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `business_action_idempotency_key` (`app_id`, `membership_id`, `canonical_action_name`, `idempotency_key`),
  KEY `business_action_idempotency_expiry` (`status`, `expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
--> statement-breakpoint
INSERT INTO `schema_migration_steps` (`migration_id`, `step_id`, `definition_digest`, `applied_at`) VALUES ('0005', 'business_action_idempotency.create', 'sha256:2a4e8523e16d79e0143c97be12bc50e25494b3681eebc27cee7a3a9fdf3f84dd', UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE `applied_at` = `applied_at`
