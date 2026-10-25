---
paths:
  - "**/*.md"
  - "**/*.mdx"
  - "docs/**"
  - "content.config.ts"
  - "shared/constants/docIds.ts"
  - "scripts/check-doc-system.ts"
---
# Documentation Guidelines

- Use sentence case for headings.
- Keep paragraphs short (3-4 sentences max).
- Include code examples where relevant.
- Keep documentation in sync with the code it describes.

## 文档体系（Docs-as-Code，先文档、再落码）

本项目实行「先文档、再落码」：任何代码改动，必须先有对应 Tier 的文档或 ADR，并通过守卫后才允许落码。

- **权威金字塔与规则**：见 `NMCPS-GOV-001`（`layers/content/collections/cn/architecture/0.governance/doc-system-charter.md`）。
- **文档权威清单（SSOT）**：见 `NMCPS-GOV-003`（`layers/content/collections/cn/architecture/0.governance/doc-map.md`）。`.clinerules` **不手写任何文档清单**，一律引用 doc-map。
- **docId 契约**：受治理文档（`architecture/`、`records/`）须在 frontmatter 携带 `docId` / `tier` / `authority` / `scope` / `status`；`docId ↔ 路径` 唯一映射登记于 `shared/constants/docIds.ts`。
- **新增 / 修改受治理文档**：同步更新 doc-map（`NMCPS-GOV-003`）与 `shared/constants/docIds.ts`，并运行 `pnpm check:doc-system` 通过守卫。
- **引用约定**：代码 / 脚本 / 注释互引一律写 `docId（路径）`，禁止硬编码文档路径。

