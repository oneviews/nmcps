// content.config.ts
// @nuxt/content v3 集合定义（唯一来源，SSOT）。
// 内容文件位于内容图层：layers/content/collections/{cn,en}/**，
// source.cwd 指向图层内容目录（保持根级 SSOT，不采用图层原生 content.config 合并）。
// 设计基准：NMCPS-GOV-001（layers/content/collections/cn/architecture/0.governance/doc-system-charter.md）
import { resolve } from "node:path";
import { defineCollection, defineContentConfig } from "@nuxt/content";
import { z } from "zod";

// Frontmatter 元数据 schema（cn / en 集合共享）
const metaSchema = z.object({
	title: z.string(),
	description: z.string().optional(),
	excerpt: z.string().optional(),
	icon: z.string().optional(),
	tags: z.array(z.string()).default([]),
	keywords: z.array(z.string()).optional(),
	author: z.string().optional(),
	createdAt: z.string().optional(),
	updatedAt: z.string().optional(),
	version: z.string().optional(),

	// ── 文档体系字段（docId / tier / authority / scope / status / …）──
	docId: z.string().optional(),
	tier: z.number().int().min(0).max(5).optional(),
	authority: z.enum(["normative", "informative"]).optional(),
	scope: z.array(z.string()).optional(),
	status: z.enum(["draft", "review", "baseline", "deprecated", "superseded"]).optional(),
	owner: z.string().optional(),
	reviewBy: z.string().optional(),
	dependsOn: z.array(z.string()).optional(),
	supersedes: z.array(z.string()).optional(),
	supersededBy: z.string().optional()
});

export default defineContentConfig({
	collections: {
		// 简体中文内容集合：cn/**/*.md → 前缀移除（cn/architecture/… → /architecture/…）
		content_cn: defineCollection({
			type: "page",
			source: {
				cwd: resolve("layers/content/collections"),
				include: "cn/**/*.md",
				prefix: "/"
			},
			schema: metaSchema
		}),
		// English 内容集合：en/**/*.md → 路径与 cn 对齐
		content_en: defineCollection({
			type: "page",
			source: {
				cwd: resolve("layers/content/collections"),
				include: "en/**/*.md",
				prefix: "/"
			},
			schema: metaSchema
		})
	}
});
