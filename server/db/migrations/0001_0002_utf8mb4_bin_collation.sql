-- Custom SQL migration file, put your code below! --
-- GATE-00 决策补充 §1 / 设计 §9：唯一规范化值必须按大小写敏感精确语义执行。
-- MySQL 默认 utf8mb4 collation 大小写不敏感，禁止依赖；
-- 以下列显式改为 utf8mb4_bin（S5a 的唯一投影列沿用同一约定）。
ALTER TABLE `users`
  MODIFY COLUMN `email_normalized` varchar(255) COLLATE utf8mb4_bin NOT NULL;--> statement-breakpoint
ALTER TABLE `auth_challenges`
  MODIFY COLUMN `email_normalized` varchar(255) COLLATE utf8mb4_bin NOT NULL;--> statement-breakpoint
ALTER TABLE `invitations`
  MODIFY COLUMN `email_normalized` varchar(255) COLLATE utf8mb4_bin NOT NULL;
