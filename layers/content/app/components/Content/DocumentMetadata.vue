<template>
	<div v-if="hasMetadata" class="border-t border-(--ui-border) pt-4">
		<p class="text-sm font-semibold">
			{{ t("pages.content-document.metadata.title") }}
		</p>

		<!-- 基本信息（所有文档类型通用） -->
		<dl v-if="baseItems.length" class="mt-3 space-y-2.5">
			<div v-for="item in baseItems" :key="item.label">
				<dt class="text-xs text-(--ui-text-muted)">
					{{ item.label }}
				</dt>
				<dd class="mt-0.5 text-xs break-words">
					{{ item.value }}
				</dd>
			</div>
		</dl>

		<!-- 治理信息（仅受治理文档 architecture / records） -->
		<template v-if="governanceItems.length">
			<p class="mt-4 text-xs font-semibold text-(--ui-text-muted)">
				{{ t("pages.content-document.metadata.governance") }}
			</p>
			<dl class="mt-2 space-y-2.5">
				<div v-for="item in governanceItems" :key="item.label">
					<dt class="text-xs text-(--ui-text-muted)">
						{{ item.label }}
					</dt>
					<dd class="mt-0.5 text-xs break-words">
						{{ item.value }}
					</dd>
				</div>
			</dl>
		</template>
	</div>
</template>

<script setup lang="ts">
// 文档元数据面板：挂在右侧「本页目录」的 #bottom 插槽下方，按「基本信息 / 治理信息」两组展示。
// 基本信息 = 所有文档类型通用（摘要 / 摘录 / 作者 / 版本 / 时间 / 标签 / 关键词）；
// 治理信息 = 受治理文档（architecture / records）专属（docId / tier / authority / scope /
// status / owner / reviewBy / dependsOn / supersedes / supersededBy）。
// 仅显示实际存在的字段（缺失 / 空值 / 空数组自动跳过），枚举值本地化。
// 供 document / article / release 三个详情页复用。

// 元数据来源：content.config.ts frontmatter schema 的字段子集（与 @nuxt/content 生成类型对齐）
	interface MetadataSource {
		description?: string
		excerpt?: string
		author?: string
		version?: string
		createdAt?: string
		updatedAt?: string
		tags?: string[]
		keywords?: string[]
		docId?: string
		tier?: number
		authority?: "normative" | "informative"
		scope?: string[]
		status?: "draft" | "review" | "baseline" | "deprecated" | "superseded"
		owner?: string
		reviewBy?: string
		dependsOn?: string[]
		supersedes?: string[]
		supersededBy?: string
	}

	const props = defineProps<{ page: MetadataSource | null | undefined }>();

	const { t } = useI18n();

	interface MetadataItem {
		label: string
		value: string
	}

	// 生成「字段 → 键值项」写入器：跳过空值，数组值用「 · 」连接
	const makePush = (items: MetadataItem[]) => (key: string, value: unknown) => {
		if (value === undefined || value === null || value === "")
			return;
		if (Array.isArray(value) && value.length === 0)
			return;
		items.push({
			label: t(`pages.content-document.metadata.${key}`),
			value: Array.isArray(value) ? value.join(" · ") : String(value)
		});
	};

	// 基本信息：所有文档类型通用
	const baseItems = computed<MetadataItem[]>(() => {
		const p = props.page;
		if (!p)
			return [];
		const items: MetadataItem[] = [];
		const push = makePush(items);
		push("description", p.description);
		push("excerpt", p.excerpt);
		push("author", p.author);
		push("version", p.version);
		push("createdAt", p.createdAt);
		push("updatedAt", p.updatedAt);
		push("tags", p.tags);
		push("keywords", p.keywords);
		return items;
	});

	// 治理信息：仅受治理文档（architecture / records）；tier / authority / status 枚举值本地化
	const governanceItems = computed<MetadataItem[]>(() => {
		const p = props.page;
		if (!p)
			return [];
		const items: MetadataItem[] = [];
		const push = makePush(items);
		push("docId", p.docId);
		push("tier", p.tier !== undefined ? t(`pages.content-document.metadata.values.tier.${p.tier}`) : undefined);
		push("authority", p.authority ? t(`pages.content-document.metadata.values.authority.${p.authority}`) : undefined);
		push("status", p.status ? t(`pages.content-document.metadata.values.status.${p.status}`) : undefined);
		push("scope", p.scope);
		push("owner", p.owner);
		push("reviewBy", p.reviewBy);
		push("dependsOn", p.dependsOn);
		push("supersedes", p.supersedes);
		push("supersededBy", p.supersededBy);
		return items;
	});

	const hasMetadata = computed(() => baseItems.value.length > 0 || governanceItems.value.length > 0);
</script>
