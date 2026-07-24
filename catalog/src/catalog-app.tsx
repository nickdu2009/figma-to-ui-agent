import { useMemo, useState } from "react";

import { ComponentCard } from "./component-card.tsx";
import { generateComponentFixtures } from "./fixtures.ts";

export function CatalogApp() {
  const fixtures = useMemo(() => generateComponentFixtures(), []);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return fixtures;
    }
    return fixtures.filter(
      (fixture) =>
        fixture.title.toLowerCase().includes(normalized) ||
        fixture.description.toLowerCase().includes(normalized) ||
        fixture.kind.toLowerCase().includes(normalized),
    );
  }, [fixtures, query]);

  return (
    <div className="catalog-page">
      <header className="catalog-header">
        <div className="catalog-header-title">
          <h1>组件库预览</h1>
          <p>当前 renderer 支持的组件与对外文档入口</p>
        </div>
        <input
          type="search"
          className="catalog-search"
          placeholder="搜索组件..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="搜索组件"
        />
      </header>
      <main className="catalog-grid">
        {filtered.map((fixture) => (
          <ComponentCard key={fixture.kind} fixture={fixture} />
        ))}
      </main>
      {filtered.length === 0 && (
        <p className="catalog-empty">未找到匹配组件</p>
      )}
    </div>
  );
}
