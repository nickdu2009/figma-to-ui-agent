-- Custom SQL migration file, put your code below! --
-- 0006 recovery/source constraint additive DDL（0005 历史账本保持不变）。
-- 每个约束按 information_schema 幂等添加；postflight0006 以定义 introspection 收口。
-- constraint: generation_recovery_records.generation_recovery_records_status
SET @vma_ddl := IF((SELECT COUNT(*) FROM information_schema.table_constraints WHERE table_schema = DATABASE() AND table_name = 'generation_recovery_records' AND constraint_name = 'generation_recovery_records_status' AND constraint_type = 'CHECK') = 0, 'ALTER TABLE `generation_recovery_records` ADD CONSTRAINT `generation_recovery_records_status` CHECK ((`status` = ''pending'' AND `decision` IS NULL AND `decided_by` IS NULL AND `decided_at` IS NULL AND `successor_generation_id` IS NULL AND `expired_at` IS NULL) OR (`status` = ''consumed'' AND `decision` IN (''repair'',''regenerate'',''keep_current'') AND `decided_by` IS NOT NULL AND `decided_at` IS NOT NULL AND `expired_at` IS NULL) OR (`status` = ''expired'' AND `decision` IS NULL AND `expired_at` IS NOT NULL))', 'SELECT 1')
--> statement-breakpoint
PREPARE vma_stmt FROM @vma_ddl
--> statement-breakpoint
EXECUTE vma_stmt
--> statement-breakpoint
DEALLOCATE PREPARE vma_stmt
--> statement-breakpoint
-- constraint: design_asset_sources.design_asset_sources_ready_extraction
SET @vma_ddl := IF((SELECT COUNT(*) FROM information_schema.table_constraints WHERE table_schema = DATABASE() AND table_name = 'design_asset_sources' AND constraint_name = 'design_asset_sources_ready_extraction' AND constraint_type = 'CHECK') = 0, 'ALTER TABLE `design_asset_sources` ADD CONSTRAINT `design_asset_sources_ready_extraction` CHECK ((`status` = ''ready'' AND `ready_extraction_id` IS NOT NULL) OR (`status` IN (''uploaded'',''extracting'',''failed'',''deleted'') AND `ready_extraction_id` IS NULL))', 'SELECT 1')
--> statement-breakpoint
PREPARE vma_stmt FROM @vma_ddl
--> statement-breakpoint
EXECUTE vma_stmt
--> statement-breakpoint
DEALLOCATE PREPARE vma_stmt
--> statement-breakpoint
-- constraint: design_asset_sources.design_asset_sources_ready_extraction_fk
SET @vma_ddl := IF((SELECT COUNT(*) FROM information_schema.table_constraints WHERE table_schema = DATABASE() AND table_name = 'design_asset_sources' AND constraint_name = 'design_asset_sources_ready_extraction_fk' AND constraint_type = 'FOREIGN KEY') = 0, 'ALTER TABLE `design_asset_sources` ADD CONSTRAINT `design_asset_sources_ready_extraction_fk` FOREIGN KEY (`ready_extraction_id`) REFERENCES `design_asset_extractions` (`id`)', 'SELECT 1')
--> statement-breakpoint
PREPARE vma_stmt FROM @vma_ddl
--> statement-breakpoint
EXECUTE vma_stmt
--> statement-breakpoint
DEALLOCATE PREPARE vma_stmt
