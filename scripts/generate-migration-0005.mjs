/**
 * 从 additive-migration-verifier 生成 0005 历史 SQL 与 0006 约束 SQL。
 * 集成测试（design-system-migration.test.ts）断言磁盘文件与本输出一致（无漂移）。
 * 用法：node scripts/generate-migration-0005.mjs
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const {
  generate0005Sql,
  generate0006Sql,
  MIGRATION_0005_TAG,
  MIGRATION_0006_TAG,
} = await import(
  "../server/persistence/additive-migration-verifier.ts"
);

const out0005Path = fileURLToPath(
  new URL(`../server/db/migrations/${MIGRATION_0005_TAG}.sql`, import.meta.url),
);
const out0006Path = fileURLToPath(
  new URL(`../server/db/migrations/${MIGRATION_0006_TAG}.sql`, import.meta.url),
);
writeFileSync(out0005Path, generate0005Sql(), "utf8");
writeFileSync(out0006Path, generate0006Sql(), "utf8");
console.log(`[generate-0005-0006] wrote ${out0005Path} and ${out0006Path}`);
