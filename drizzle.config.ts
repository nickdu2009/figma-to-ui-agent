/** @type {import("drizzle-kit").Config} */
const config = {
    dialect: "mysql",
    schema: "./server/db/schema.ts",
    out: "./server/db/migrations",
    dbCredentials: {
        url:
            process.env.VMA_DATABASE_URL ??
            "mysql://vma:vma-local-dev-only@127.0.0.1:3317/vite_multipage_agent",
    },
};

export default config;
