---
title: "Markdown Standard Syntax"
description: "A quick reference of the Markdown syntax used for writing in the content center: headings, text formatting, links, lists, code, blockquotes, and tables."
excerpt: "Headings, text formatting, links, lists, code, blockquotes, and tables."
icon: "carbon:blog"
tags:
  - "Markdown"
  - "Writing"
keywords:
  - "markdown"
  - "syntax"
  - "writing"
author: "NMCPS Team"
createdAt: "2026-10-26"
updatedAt: "2026-10-26"
---

# Markdown Standard Syntax

The content center is built on `@nuxt/content`; bodies use standard Markdown. This post is a quick reference for the most common syntax.

## Headings

Use `#` for headings and `##` / `###` for sub-headings. Each heading generates an anchor and automatically appears in the right-side table of contents.

```markdown
# Heading 1
## Heading 2
### Heading 3
```

## Text formatting

| Style | How to write | Result |
| --- | --- | --- |
| Bold | `**bold**` | **bold** |
| Italic | `*italic*` | *italic* |
| Strikethrough | `~~strikethrough~~` | ~~strikethrough~~ |

Styles can be combined, e.g. `` **_bold italic_** `` or `~~**bold strikethrough**~~`.

## Links

Create links with `[text](url)`; use root-relative paths for internal links.

```markdown
[Quick Start](/content/document/documents/getting-started/quickstart)
```

## Lists

Unordered lists start with `-`, ordered lists start with numbers, and sub-items are nested with a four-space indent.

```markdown
- Unordered item
- Another item

1. First step
2. Second step
```

## Code

Use backticks for inline `` `code` `` and three backticks with a language tag for code blocks, e.g. wrap TypeScript in ` ```ts `.

## Blockquotes

Use `>` for blockquotes, which are good for notes or emphasis.

> Docs before code: any code change must have a corresponding document first.

## Tables

Separate columns with pipes and the header from the body with a `---` row.

| Field | Description |
| --- | --- |
| `title` | Title |
| `icon` | Icon (must not be empty) |

## Writing conventions

- Use lowercase kebab-case for file names.
- Use three-part semantic versions without a `v` prefix (e.g. `0.1.0`).
- frontmatter must carry `title` / `createdAt` / `icon`; assign a directory-appropriate `icon` that is never empty.
