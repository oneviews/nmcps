<template>
	<div class="flex min-h-0 flex-1 flex-col">
		<!--
			`/system/policy` 策略管理（两栏落码，NMCPS-ADR-0017 迁移步骤 6）。
			页面根显式取 `flex-1 min-h-0`（NMCPS-ARCH-006 §3.3）：definite height 链在这里落定。
			身份 / 范围说明在详情栏顶部（见 `#detail`，NMCPS-DESIGN-005 §7.3）。
		-->
		<!-- 内容页工具栏（§4）：全页只有这一层。左区 = 集合域动作，覆盖式详情态换成唯一「返回」 -->
		<Teleport to="#app-toolbar-left">
			<UTooltip v-if="toolbarPane === 'detail'" :text="$t('split.back')">
				<UButton
					size="sm"
					color="neutral"
					variant="ghost"
					icon="carbon:arrow-left"
					:aria-label="$t('split.back')"
					@click="clearSelection()"
				/>
			</UTooltip>
			<template v-else>
				<!-- 上游列表只认 `keyword`（`code` / `policy_type` / `enabled` 被静默忽略，UP-RBAC-06） -->
				<UInput
					v-model="keyword"
					size="sm"
					icon="carbon:search"
					:placeholder="$t('pages.system-policy.keywordPlaceholder')"
					:aria-label="$t('pages.system-policy.keywordPlaceholder')"
					class="w-40 min-w-0 sm:w-56"
				/>

				<UTooltip :text="$t('pages.system-policy.refresh')">
					<UButton
						size="sm"
						color="neutral"
						variant="ghost"
						icon="carbon:renew"
						:loading="loading"
						:aria-label="$t('pages.system-policy.refresh')"
						@click="reload"
					/>
				</UTooltip>
			</template>
		</Teleport>

		<!--
			右区 = 记录域 / 提交域 / 主 CTA（§4.1）；一页至多一个 primary：表单态是「创建 / 保存」，其余时候是「新建」。
			没有「启用 / 停用」开关：`enabled` 写入被上游忽略（UP-RBAC-03），点了没反应的开关比没有入口更糟。
		-->
		<Teleport to="#app-toolbar-right">
			<template v-if="formOpen">
				<UButton
					size="sm"
					color="neutral"
					variant="ghost"
					:label="$t('pages.system-policy.form.cancel')"
					@click="cancelForm"
				/>
				<UButton
					size="sm"
					:label="isCreating ? $t('pages.system-policy.form.create') : $t('pages.system-policy.form.save')"
					:loading="formSubmitting"
					@click="formRef?.submit()"
				/>
			</template>
			<template v-else>
				<template v-if="selected">
					<UButton
						size="sm"
						color="neutral"
						variant="outline"
						icon="carbon:edit"
						:label="$t('pages.system-policy.edit')"
						@click="startEdit"
					/>
					<!-- 危险动作在记录域工具栏（D5）；确认弹窗负责讲清「系统策略也不受保护」（UP-RBAC-02） -->
					<UButton
						size="sm"
						color="error"
						variant="ghost"
						icon="carbon:trash-can"
						:aria-label="$t('pages.system-policy.delete')"
						@click="deleteOpen = true"
					/>
				</template>
				<!-- 覆盖式详情态不再给「新建」：那属于列表面板的动作（§4.4） -->
				<UButton
					v-if="toolbarPane === 'list'"
					size="sm"
					icon="carbon:add"
					:label="$t('pages.system-policy.create')"
					@click="startCreate"
				/>
			</template>
		</Teleport>

		<!-- 两栏骨架（§3 / NMCPS-ADR-0017 D1） -->
		<LayoutSplit
			id="policy"
			:has-selection="hasSelection"
			@update:shape="shape = $event"
		>
			<template #list>
				<!-- 栏内错误：右栏保持可用（§3.4） -->
				<div v-if="errorMessage" class="p-3">
					<UAlert
						color="error"
						variant="subtle"
						icon="carbon:warning-alt"
						:title="$t('pages.system-policy.loadFailed')"
						:description="errorMessage"
					>
						<template #actions>
							<UButton
								size="sm"
								color="neutral"
								variant="subtle"
								:label="$t('pages.system-policy.retry')"
								@click="reload"
							/>
						</template>
					</UAlert>
				</div>

				<!-- 加载：骨架行 × 5，不整块 spinner（§3.4）；刷新时保留旧数据 -->
				<div v-else-if="loading && rows.length === 0" class="space-y-2 p-3">
					<USkeleton v-for="index in 5" :key="index" class="h-10 w-full" />
				</div>

				<!-- 空态在栏内，不塞进表格（§3.4）；「新建」只在工具栏一处入口（§4） -->
				<div v-else-if="rows.length === 0" class="flex flex-col items-center gap-2 p-6 text-center">
					<UIcon name="carbon:rule" class="size-7 text-(--ui-text-muted)" />
					<p class="text-sm">
						{{ appliedKeyword ? $t("pages.system-policy.emptySearch") : $t("pages.system-policy.empty") }}
					</p>
				</div>

				<!--
					列表：自建 listbox（§3.6 / D8）—— 行可聚焦、`Enter` / `Space` 选中、带 `aria-selected`；
					行内动作 0 个：整行点击就是「选中」，写操作一律在右栏工具栏（D2 / D5）。
				-->
				<ul
					v-else
					role="listbox"
					:aria-label="$t('pages.system-policy.listTitle')"
					class="flex flex-col"
					@keydown="onListKeydown"
				>
					<LayoutListRow
						v-for="(policyRow, index) in rows"
						:key="policyRow.id"
						:ref="(element) => setRowRef(policyRow.id, element)"
						:label="policyRow.name"
						:subtitle="`${policyRow.code} · ${policyRow.policy_type}`"
						mono-subtitle
						:selected="policyRow.id === selectedId"
						:tabindex="policyRow.id === selectedId || (!selectedId && index === 0) ? 0 : -1"
						:title="`${policyRow.name} · ${policyRow.code}`"
						@select="selection.select(policyRow)"
					>
						<template #badge>
							<!-- 系统策略只是标签，不是保护（UP-RBAC-02）：列表里也不加锁形图标误导 -->
							<UBadge v-if="policyRow.is_system" color="neutral" variant="subtle" size="sm">
								{{ $t("pages.system-policy.systemBadge") }}
							</UBadge>
						</template>
					</LayoutListRow>
				</ul>
			</template>

			<!-- 列表尾部（滚动区之外）：计数 + 每页条数 + 分页（§3.8 / D2）。新代 `keyword` 在服务端生效，走服务端分页 -->
			<template #list-footer>
				<LayoutListFooter
					v-model:page="page"
					v-model:page-size="pageSize"
					:total="total"
					:disabled="loading"
				>
					{{ $t("pages.system-policy.total", { total }) }}
				</LayoutListFooter>
			</template>

			<template #detail>
				<div class="flex min-h-full flex-col">
					<!--
						身份 / 范围说明（NMCPS-DESIGN-005 §7.3）：放在详情栏顶部 —— 它回答的是
						「这批策略在什么范围内可见」，属于所选记录的上下文而不是页面级横幅。
					-->
					<div v-if="loaded" class="shrink-0 px-4 pt-4">
						<UAlert
							:color="scopeAlert.color"
							variant="subtle"
							icon="carbon:rule"
							:title="$t(scopeAlert.title)"
							:description="$t(scopeAlert.description)"
						/>
					</div>

					<!-- create / edit：右栏内联表单（D3 / 附录 B），提交按钮在右栏工具栏 -->
					<PolicyForm
						v-if="formOpen"
						ref="formRef"
						:key="isCreating ? 'create' : selectedId"
						:policy="isEditing ? selected : null"
						@saved="onSaved"
					/>

					<!-- `?id` 不在当前页结果集：零详情请求 + 一次提示，不清空 URL（D6） -->
					<div v-else-if="isMissing" class="p-4">
						<UAlert
							color="warning"
							variant="subtle"
							icon="carbon:unlink"
							:title="$t('pages.system-policy.selectionMissingTitle')"
							:description="$t('pages.system-policy.selectionMissing', { id: selectedId })"
						>
							<template #actions>
								<UButton
									size="sm"
									color="neutral"
									variant="subtle"
									:label="$t('pages.system-policy.selectionClear')"
									@click="clearSelection()"
								/>
							</template>
						</UAlert>
					</div>

					<!-- view 态：字段 + 文档只读预览（§7.2：只做「格式化预览 + 复制」） -->
					<div v-else-if="selected" class="max-w-[720px] space-y-5 p-4">
						<div class="min-w-0">
							<h2 class="truncate text-base font-semibold">
								{{ selected.name }}
							</h2>
							<p class="truncate font-mono text-xs text-(--ui-text-muted)">
								{{ selected.code }}
							</p>
						</div>

						<dl class="grid grid-cols-[minmax(5rem,auto)_1fr] items-baseline gap-x-4 gap-y-3 text-sm">
							<dt class="text-(--ui-text-muted)">
								{{ $t("pages.system-policy.columns.id") }}
							</dt>
							<dd class="break-all font-mono text-xs">
								{{ selected.id }}
							</dd>

							<dt class="text-(--ui-text-muted)">
								{{ $t("pages.system-policy.columns.policyType") }}
							</dt>
							<!-- openapi 未约束枚举：原样展示，未知值不映射成「其他」（§7.2） -->
							<dd class="break-all font-mono text-xs">
								{{ selected.policy_type }}
							</dd>

							<dt class="text-(--ui-text-muted)">
								{{ $t("pages.system-policy.columns.tenant") }}
							</dt>
							<dd class="break-all font-mono text-xs">
								{{ tenantName(selected.tenant_id) }}
							</dd>

							<dt class="text-(--ui-text-muted)">
								{{ $t("pages.system-policy.columns.enabled") }}
							</dt>
							<!-- `enabled` 上游恒 true 且写入被忽略（UP-RBAC-03）：只读展示，不做开关 -->
							<dd>
								<UBadge :color="selected.enabled ? 'success' : 'neutral'" variant="subtle">
									{{ selected.enabled ? $t("pages.system-policy.enabledOn") : $t("pages.system-policy.enabledOff") }}
								</UBadge>
							</dd>

							<dt class="text-(--ui-text-muted)">
								{{ $t("pages.system-policy.columns.description") }}
							</dt>
							<dd class="break-words">
								{{ selected.description || "—" }}
							</dd>

							<dt class="text-(--ui-text-muted)">
								{{ $t("pages.system-policy.columns.createdAt") }}
							</dt>
							<!-- 上游 RFC3339 带偏移（`2026-11-03T18:59:06+08:00`）：原样展示，不换算也不加 (UTC) -->
							<dd class="font-mono text-xs">
								{{ selected.created_at || "—" }}
							</dd>

							<dt class="text-(--ui-text-muted)">
								{{ $t("pages.system-policy.columns.updatedAt") }}
							</dt>
							<dd class="font-mono text-xs">
								{{ selected.updated_at || "—" }}
							</dd>
						</dl>

						<section class="space-y-2">
							<div class="flex items-center justify-between gap-2">
								<h3 class="text-sm font-semibold">
									{{ $t("pages.system-policy.columns.document") }}
								</h3>
								<UButton
									size="xs"
									color="neutral"
									variant="ghost"
									icon="carbon:copy"
									:label="$t('pages.system-policy.copyDocument')"
									:disabled="!documentPreview.text"
									@click="copyDocument"
								/>
							</div>
							<!-- 合法 JSON 缩进美化，非法 JSON 原样回落（不猜、不修） -->
							<pre class="max-h-80 overflow-auto rounded-md border border-(--ui-border) bg-elevated/40 p-3 font-mono text-xs whitespace-pre-wrap break-words">{{ documentPreview.text || $t("pages.system-policy.documentEmpty") }}</pre>
							<p v-if="!documentPreview.valid && documentPreview.text" class="text-xs text-(--ui-text-muted)">
								{{ $t("pages.system-policy.documentInvalidHint") }}
							</p>
							<p class="text-xs text-(--ui-text-muted)">
								{{ $t("pages.system-policy.documentHint") }}
							</p>
						</section>

						<UAlert
							color="info"
							variant="subtle"
							icon="carbon:document"
							:title="$t('pages.system-policy.documentReadonlyTitle')"
							:description="$t('pages.system-policy.documentReadonly')"
						/>
					</div>

					<!-- 无选中：右栏空态（D3） -->
					<div v-else class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
						<UIcon name="carbon:document-blank" class="size-7 text-(--ui-text-muted)" />
						<p class="text-sm font-medium">
							{{ $t("pages.system-policy.detailEmpty") }}
						</p>
						<p class="max-w-xs text-xs text-(--ui-text-muted)">
							{{ $t("pages.system-policy.detailEmptyHint") }}
						</p>
					</div>
				</div>
			</template>
		</LayoutSplit>

		<!-- 破坏性确认：入口在右栏工具栏，弹窗只确认这一次写操作（D7） -->
		<PolicyDeleteModal
			v-model:open="deleteOpen"
			:policy="selected ?? null"
			@deleted="onDeleted"
		/>
	</div>
</template>

<script setup lang="ts">
	import type { IamPolicy } from "~~/shared/types/policy";
	import { DEFAULT_PAGE_SIZE } from "~~/shared/constants/paging";

	/**
	 * `/system/policy` 策略管理（两栏落码，NMCPS-ADR-0017 迁移步骤 6）。
	 *
	 * 设计基准：NMCPS-ARCH-006 §3（layers/content/collections/cn/architecture/1.architecture/ui-architecture.md）
	 * 领域口径：NMCPS-DESIGN-005 §七（layers/content/collections/cn/architecture/2.domain/system.md）
	 * 契约来源：NMCPS-ADR-0018 §4.3（`/abac/rule` → `iam/policies`）
	 * 上游缺陷：NMCPS-REC-005（layers/content/collections/cn/records/defects/iam-policy-upstream-defects.md）
	 *
	 * ── 能力矩阵（2026-11-04 实测 192.168.1.55:8888）────────────────────────────
	 * | 能力 | 旧代 | 新代 |
	 * | :--- | :--- | :--- |
	 * | 列表 / 搜索 | `/abac/rule`，无 `keyword`（客户端过滤） | `GET /iam/policies`，服务端 `keyword`（服务端分页） |
	 * | 建 | **无端点**（UP-POL-01） | `POST /iam/policies`，主键回在信封顶层 |
	 * | 改 | **无端点** | `PUT /iam/policies/{id}`（只 `name` / `document` / `description` 生效） |
	 * | 删 | **无端点** | `DELETE /iam/policies/{id}`（系统策略也删得掉，UP-RBAC-02） |
	 * | 启停 | 只能改库 | **无有效端点**：`enabled` 写入被忽略（UP-RBAC-03） |
	 * | 授权试算 | `POST /access/dryrun` | **端点缺失**（缺口 G5）：入口与弹窗已随 C4 下线 |
	 *
	 * 新代**没有业务级鉴权**：任何已认证会话（含零角色账号）都能读写这些端点，
	 * 可见范围只由**会话租户**决定（UP-RBAC-01 / UP-RBAC-09）。页面不做任何「客户端先拦一道」的假设，
	 * 收敛只发生在「不引导用户踩上游缺口」这一层：不做启停开关、文档不提供编辑器、
	 * 删除确认如实写明系统策略不受保护。
	 */
	definePageMeta({ sort: 2, icon: "carbon:rule" });

	const { t } = useI18n();
	const toast = useToast();
	const { user, loaded } = useAuth();
	const { list } = usePolicies();

	/** 当前形态（由 `Layout/Split.vue` 判定并外抛）：决定 `?id` 写历史时用 `replace` 还是 `push` */
	const shape = ref<"two" | "overlay">("two");

	const rows = ref<IamPolicy[]>([]);
	const total = ref(0);
	const page = ref(1);
	const pageSize = ref(DEFAULT_PAGE_SIZE);
	const loading = ref(false);
	const errorMessage = ref<string>();

	/**
	 * 记录选择契约（NMCPS-ARCH-006 §5.2 / NMCPS-ADR-0017 D2 / D6）：`?id` 是「当前选中哪条」的唯一事实源。
	 * `?id` 不进 `list()` 的请求参数，因此改选中 / 深链进入都不会重新拉列表；
	 * 不在当前页结果集时只出空态提示，不静默翻页去捞（会让筛选状态与 URL 不一致）。
	 */
	const selection = useRecordSelection<IamPolicy>({
		rows,
		getId: (record) => record.id,
		getLabel: (record) => record.name,
		isLoading: loading,
		isOverlay: () => shape.value === "overlay",
		autoSelect: true,
		defaultRecord: (policyList) => policyList[0],
		createId: "new"
	});

	const { selectedId, selected, isMissing, isCreating, clear: clearSelection } = selection;

	const hasSelection = computed(() => !!selectedId.value);

	/**
	 * 编辑态是本页局部状态，不占 URL：`?id=new` 只表示「新建」（D6），
	 * 编辑永远依附于某条已选记录，多一个 `?mode=edit` 只会让深链有两种含义。
	 */
	const editing = ref(false);
	const isEditing = computed(() => editing.value && !!selected.value);
	/** 右栏是否处于表单态（新建或编辑）：决定工具栏给「创建 / 保存」还是记录域动作 */
	const formOpen = computed(() => isCreating.value || isEditing.value);

	/** 工具栏内容跟随当前面板（§4.4）：覆盖式列表态只给集合域动作，详情态左区换成唯一「返回」 */
	const toolbarPane = computed<"list" | "detail">(() =>
		shape.value === "overlay" && (hasSelection.value || formOpen.value) ? "detail" : "list");

	/** 面包屑记录段（§5.1）：create 态显示「新建策略」，否则显示选中记录名 */
	const recordLabel = computed(() => isCreating.value
		? t("pages.system-policy.create")
		: selection.label.value);

	const { clearRequests } = useRecordContext(recordLabel);

	// 记录段被点击 = 清除选择（工具栏不直接写 URL，URL 只由 useRecordSelection 写）
	watch(clearRequests, () => clearSelection());

	/** 换记录 / 新建时退出编辑态：表单里是旧记录的副本，留着会改错对象 */
	watch(selectedId, () => {
		editing.value = false;
	});

	// ── 键盘：listbox 语义（§3.6 / D8）────────────────────────────────────────
	/** 行实例（`LayoutListRow`，只暴露 `focus()`）：`↑/↓/Home/End` 要能把焦点搬到目标行 —— 行结构在组件里（§3.6） */
	const rowElements = new Map<string, { focus: () => void }>();

	function setRowRef(id: string, row: unknown): void {
		if (row && typeof (row as { focus?: unknown }).focus === "function")
			rowElements.set(id, row as { focus: () => void });
		else
			rowElements.delete(id);
	}

	/** `↑/↓/Home/End` 移动焦点并同步选中（selection follows focus）；`Enter` / `Space` 由行自己处理 */
	function onListKeydown(event: KeyboardEvent): void {
		const ids = rows.value.map((record) => record.id);
		if (ids.length === 0)
			return;

		const current = selectedId.value ? ids.indexOf(selectedId.value) : -1;
		let next: number;

		switch (event.key) {
		case "ArrowDown":
			next = current < 0 ? 0 : Math.min(ids.length - 1, current + 1);
			break;
		case "ArrowUp":
			next = current < 0 ? ids.length - 1 : Math.max(0, current - 1);
			break;
		case "Home":
			next = 0;
			break;
		case "End":
			next = ids.length - 1;
			break;
		default:
			return;
		}

		event.preventDefault();
		const id = ids[next]!;
		selection.set(id);
		// v-for 重渲染可能替换节点，聚焦放到下一拍
		void nextTick(() => rowElements.get(id)?.focus());
	}

	// ── 表单态（新建 `?id=new` / 编辑当前记录）────────────────────────────────
	/** 右栏工具栏的「创建 / 保存」要驱动表单提交：模板 ref 拿子组件暴露的 `submit()` / `submitting` */
	const formRef = ref<{ submit: () => Promise<void>, submitting: boolean }>();
	const formSubmitting = computed(() => formRef.value?.submitting === true);

	function startCreate(): void {
		editing.value = false;
		selection.set("new");
	}

	function startEdit(): void {
		if (!selected.value)
			return;

		editing.value = true;
	}

	/** 取消：编辑只是退回详情；新建则连 `?id=new` 一起清掉 */
	function cancelForm(): void {
		editing.value = false;
		if (isCreating.value)
			clearSelection();
	}

	/**
	 * 表单提交成功后的落定：
	 * - 编辑：列表里那条是旧值，静默刷新校准（不重置滚动、不清空选中）；
	 * - 新建：先就地 patch 进列表，再 `replace` `?id` 为真实主键，最后静默刷新。
	 *
	 * 新代 `POST /iam/policies` 把主键放在信封顶层（`{ code, message, id }`），composable 用
	 * `keyword` 回读刚建好的那一行；拿不到时回落到整表刷新（不做猜测式选中）。
	 */
	function onSaved(created: IamPolicy | undefined): void {
		if (editing.value) {
			editing.value = false;
			reload();
			return;
		}

		if (!created?.id) {
			reload();
			return;
		}

		rows.value = [created, ...rows.value];
		total.value += 1;
		selection.set(created.id);
		reload();
	}

	// ── 删策略（入口在右栏工具栏，弹窗只确认）────────────────────────────────
	const deleteOpen = ref(false);

	/** 删成功后当前记录已不存在：清掉 `?id` 再刷新，避免停在「记录不存在」空态 */
	function onDeleted(): void {
		clearSelection();
		reload();
	}

	// ── 文档预览与复制（§7.2：只做格式化预览 + 复制，不提供编辑器）─────────────
	const documentPreview = computed(() => previewPolicyDocument(selected.value?.document));

	/** 复制文档原文：`navigator.clipboard` 在非安全上下文不可用，失败要说出口而不是静默 */
	async function copyDocument(): Promise<void> {
		const text = selected.value?.document;
		if (!text)
			return;

		try {
			await navigator.clipboard.writeText(text);
			toast.add({ title: t("pages.system-policy.copied"), color: "success" });
		} catch {
			toast.add({ title: t("pages.system-policy.copyFailed"), color: "error" });
		}
	}

	/** 租户展示：本页没有租户目录，原样显示标识（不伪造名称） */
	function tenantName(id: string | null | undefined): string {
		return id || "—";
	}

	/**
	 * 范围说明三态（§7.3）：讲的是**可见范围**，不是权限等级 ——
	 * 新代没有业务级鉴权，可见范围只由会话租户决定（UP-RBAC-01 / UP-RBAC-09）。
	 */
	const scopeAlert = computed(() => {
		if (user.value && user.value.tenantId === null)
			return { color: "neutral" as const, title: "pages.system-policy.scopePlatformTitle", description: "pages.system-policy.scopePlatform" };

		if (user.value)
			return { color: "info" as const, title: "pages.system-policy.scopeTenantTitle", description: "pages.system-policy.scopeTenant" };

		return { color: "warning" as const, title: "pages.system-policy.scopeUnknownTitle", description: "pages.system-policy.scopeUnknown" };
	});

	// ── 取数（服务端分页 + 服务端 keyword）────────────────────────────────────
	function describeError(error: unknown): string {
		const key = policyErrorKey(error, "pages.system-policy");
		if (key)
			return t(key);

		return error instanceof ApiError && error.message
			? error.message
			: t("pages.system-policy.errors.failed");
	}

	// 输入态与生效态分开：搜索防抖 300ms 才落生效（D2），改筛选一律回到第一页
	const keyword = ref("");
	const appliedKeyword = ref("");

	async function load(): Promise<void> {
		if (loading.value)
			return;

		loading.value = true;
		errorMessage.value = undefined;

		try {
			const result = await list({
				page: page.value,
				page_size: pageSize.value,
				keyword: appliedKeyword.value || undefined
			});

			rows.value = result.list ?? [];
			total.value = result.total ?? 0;

			// 命中变少时回退到最后一页，避免停在空白页
			const lastPage = Math.max(1, Math.ceil(total.value / pageSize.value));
			if (page.value > lastPage) {
				page.value = lastPage;
				loading.value = false;
				await load();
			}
		} catch (error) {
			rows.value = [];
			total.value = 0;
			errorMessage.value = describeError(error);
		} finally {
			loading.value = false;
		}
	}

	function reload(): void {
		void load();
	}

	/** 落生效态并重新取第一页（`page` 变了由 `watch(page)` 触发加载，避免重复请求） */
	function applyFilters(): void {
		appliedKeyword.value = keyword.value.trim();

		if (page.value !== 1) {
			page.value = 1;
			return;
		}

		reload();
	}

	// 搜索框防抖 300ms（D2）：输入即生效，不需要再点「筛选」
	watchDebounced(keyword, () => applyFilters(), { debounce: 300 });
	// 单页条数变化同样走 `applyFilters()`：换条数后 `page * pageSize` 的偏移必然错位，必须回第一页
	watch(pageSize, () => applyFilters());

	watch(page, () => {
		void load();
	});

	onMounted(() => {
		void load();
	});
</script>
