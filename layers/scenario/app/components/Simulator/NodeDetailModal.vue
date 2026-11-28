<template>
	<!--
		节点详情 / 编辑（NMCPS-ADR-0022 W13，复刻旧 `NodeStats.vue` 的双击入口）。

		「事实」来自页面手里的台账原样字段（`GET /api/mininet/nodes` 的统一投影），不为了看一眼再发一遍读请求；
		只有主机 / 路由器的默认路由、接口与 ARP 额外读 `GET /api/mininet/stats/{id}`，读不到只降级那一块。
		编辑按能力位，统一走会话节点 PATCH 的 `attributes`（`NMCPS-ADR-0029` D1 / M1.2），校验与请求体在
		`labDetails.ts` 的纯函数里 —— 组件只渲染与显示报错。
	-->
	<UModal
		v-model:open="open"
		data-testid="lab-node-detail"
		:title="node ? t('pages.scenario-simulator.nodeDetail.title', { label: node.label }) : ''"
		:description="node ? t('pages.scenario-simulator.nodeDetail.hint', { id: node.id, kind: kindLabel }) : ''"
		:dismissible="!submitting"
		:ui="{ content: 'max-w-2xl', footer: 'justify-end' }"
	>
		<template #body>
			<div v-if="node" data-testid="lab-node-detail-body" class="space-y-4">
				<dl class="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-xs">
					<template v-for="row in factRows" :key="row.key">
						<dt class="text-(--ui-text-muted)">
							{{ row.label }}
						</dt>
						<dd class="break-all">
							{{ row.value }}
						</dd>
					</template>
				</dl>

				<!--
					只读原因（NMCPS-ADR-0022 W13 收尾）：没有保存按钮时不能只留一片空白 ——
					用户会以为自己点错了。三类原因各一句：交换机（入口在右栏）、控制器 / NAT
					（上游改台账不重启，改了也不生效）、会话本身没有 `lab:operate`。
				-->
				<UAlert
					v-if="readOnlyNote"
					data-testid="lab-node-detail-readonly"
					color="neutral"
					variant="subtle"
					icon="carbon:information"
					:title="t('pages.scenario-simulator.nodeDetail.readOnly')"
					:description="readOnlyNote"
				/>

				<!-- 运行态读数（可选）：读不到是常态（网络没起 / 交换机要 dpctl），只降级成一行说明 -->
				<div v-if="liveWanted" data-testid="lab-node-detail-live" class="space-y-2 rounded border border-(--ui-border) p-2">
					<h3 class="text-xs font-medium">
						{{ t("pages.scenario-simulator.nodeDetail.live") }}
					</h3>
					<p v-if="liveLoading" class="text-[11px] text-(--ui-text-muted)">
						{{ t("pages.scenario-simulator.nodeDetail.liveLoading") }}
					</p>
					<p v-else-if="liveError" class="text-[11px] text-(--ui-text-warning)">
						{{ t("pages.scenario-simulator.nodeDetail.liveUnavailable", { message: liveError }) }}
					</p>
					<template v-else-if="live">
						<p class="text-[11px]">
							<span class="text-(--ui-text-muted)">{{ t("pages.scenario-simulator.nodeDetail.defaultRoute") }}</span>
							<span class="font-mono">{{ live.defaultRoute || "—" }}</span>
						</p>
						<p class="text-[11px]">
							<span class="text-(--ui-text-muted)">{{ t("pages.scenario-simulator.nodeDetail.interfaces") }}</span>
							<span class="font-mono">{{ live.interfaces.join(", ") || "—" }}</span>
						</p>
						<table v-if="live.arpRows.length" data-testid="lab-node-detail-arp" class="w-full text-left text-[11px]">
							<thead class="text-(--ui-text-muted)">
								<tr>
									<th class="font-normal">
										{{ t("pages.scenario-simulator.nodeDetail.arpIp") }}
									</th>
									<th class="font-normal">
										{{ t("pages.scenario-simulator.nodeDetail.arpMac") }}
									</th>
									<th class="font-normal">
										{{ t("pages.scenario-simulator.nodeDetail.arpIntf") }}
									</th>
								</tr>
							</thead>
							<tbody>
								<tr v-for="row in live.arpRows" :key="`${row.ip}-${row.intf}`">
									<td class="font-mono">
										{{ row.ip }}
									</td>
									<td class="font-mono">
										{{ row.mac }}
									</td>
									<td class="font-mono">
										{{ row.intf }}
									</td>
								</tr>
							</tbody>
						</table>
						<p v-else class="text-[11px] text-(--ui-text-muted)">
							{{ t("pages.scenario-simulator.nodeDetail.arpEmpty") }}
						</p>
					</template>
				</div>

				<!-- 主机编辑：IP + 默认路由（dev / 走网关两型，留空 = 不改） -->
				<div v-if="editable && node.kind === 'host'" class="space-y-2 border-t border-(--ui-border) pt-3">
					<UFormField
						:label="t('pages.scenario-simulator.nodeDetail.ip')"
						:error="fieldError === 'ipInvalid' ? t('pages.scenario-simulator.nodeDetail.errors.ipInvalid') : undefined"
					>
						<UInput v-model="hostDraft.ip" data-testid="lab-node-detail-ip" size="sm" class="w-full" />
					</UFormField>
					<div class="grid grid-cols-[10rem_1fr] gap-2">
						<UFormField :label="t('pages.scenario-simulator.nodeDetail.routeType')">
							<USelect
								v-model="hostDraft.routeType"
								data-testid="lab-node-detail-route-type"
								size="sm"
								class="w-full"
								:items="routeTypeItems"
							/>
						</UFormField>
						<UFormField
							:label="hostDraft.routeType === 'dev'
								? t('pages.scenario-simulator.nodeDetail.routeDev')
								: t('pages.scenario-simulator.nodeDetail.routeIp')"
							:error="fieldError === 'routeInvalid' ? t('pages.scenario-simulator.nodeDetail.errors.routeInvalid') : undefined"
						>
							<UInput
								v-model="hostDraft.routeValue"
								data-testid="lab-node-detail-route-value"
								size="sm"
								class="w-full"
								:placeholder="t('pages.scenario-simulator.nodeDetail.routePlaceholder')"
							/>
						</UFormField>
					</div>
				</div>

				<!-- 路由器编辑：IP / 接口 IP / 静态路由 / 两个转发开关 -->
				<div v-if="editable && node.kind === 'router'" class="space-y-2 border-t border-(--ui-border) pt-3">
					<UFormField
						:label="t('pages.scenario-simulator.nodeDetail.ip')"
						:error="fieldError === 'ipInvalid' ? t('pages.scenario-simulator.nodeDetail.errors.ipInvalid') : undefined"
					>
						<UInput v-model="routerDraft.ip" data-testid="lab-node-detail-ip" size="sm" class="w-full" />
					</UFormField>
					<UFormField
						:label="t('pages.scenario-simulator.nodeDetail.interfaceIps')"
						:help="t('pages.scenario-simulator.nodeDetail.interfaceIpsHint')"
						:error="fieldError === 'interfaceInvalid' ? t('pages.scenario-simulator.nodeDetail.errors.interfaceInvalid') : undefined"
					>
						<UTextarea
							v-model="routerDraft.interfaceIps"
							data-testid="lab-node-detail-interface-ips"
							size="sm"
							class="w-full font-mono"
							:rows="3"
						/>
					</UFormField>
					<UFormField
						:label="t('pages.scenario-simulator.nodeDetail.routes')"
						:help="t('pages.scenario-simulator.nodeDetail.routesHint')"
						:error="fieldError === 'routeLineInvalid' ? t('pages.scenario-simulator.nodeDetail.errors.routeLineInvalid') : undefined"
					>
						<UTextarea
							v-model="routerDraft.routes"
							data-testid="lab-node-detail-routes"
							size="sm"
							class="w-full font-mono"
							:rows="3"
						/>
					</UFormField>
					<div class="flex flex-wrap gap-6">
						<USwitch v-model="routerDraft.proxyArp" :label="t('pages.scenario-simulator.nodeDetail.proxyArp')" />
						<USwitch v-model="routerDraft.ipForward" :label="t('pages.scenario-simulator.nodeDetail.ipForward')" />
					</div>
				</div>

				<UAlert
					v-if="error"
					data-testid="lab-node-detail-error"
					color="error"
					variant="subtle"
					icon="carbon:warning-alt"
					:title="t('pages.scenario-simulator.nodeDetail.failed')"
					:description="error"
				/>
			</div>
		</template>

		<template #footer>
			<UButton
				color="neutral"
				variant="ghost"
				:label="t('pages.scenario-simulator.nodeDetail.close')"
				:disabled="submitting"
				@click="open = false"
			/>
			<UButton
				v-if="editable"
				data-testid="lab-node-detail-submit"
				color="primary"
				icon="carbon:save"
				:label="t('pages.scenario-simulator.nodeDetail.save')"
				:loading="submitting"
				@click="submit"
			/>
		</template>
	</UModal>
</template>

<script setup lang="ts">
	import type {
		LabDetailFieldError,
		LabHostDraft,
		LabNodeLiveStats,
		LabRouterDraft
	} from "#layers/scenario/shared/types/labDetails";
	import {
		labHostAttributesOf,
		labHostDraftOf,
		labHostUpdateError,
		labNodeStatsOf,
		labRouterAttributesOf,
		labRouterDraftOf,
		labRouterUpdateError
	} from "#layers/scenario/shared/types/labDetails";

	/**
	 * 节点详情弹窗（`NMCPS-ADR-0022` W13 / `NMCPS-ADR-0029` M1.2）。
	 *
	 * 只做「主机 / 路由器」两类编辑：交换机那边的 OpenFlow 与流表入口在右栏，
	 * 控制器与 NAT 没有可验证的生效路径（上游 `PUT /controllers/{id}` 不重启控制器），
	 * 一律只读 —— 见 ADR 的 W13 段。保存发的是会话 PATCH 的 `attributes`
	 * （`labHostAttributesOf()` / `labRouterAttributesOf()`），不是 1.x 的分表字段名。
	 */
	const props = defineProps<{
		node: { id: string, kind: string, label: string, raw: Record<string, unknown> } | null
		/** `lab:operate`：没有它就只有「看」 */
		operate: boolean
		submitting?: boolean
		error?: string
	}>();

	const emit = defineEmits<{ submit: [attributes: Record<string, unknown>] }>();

	const open = defineModel<boolean>("open", { required: true });
	const api = useApi();
	const { t } = useI18n();

	const hostDraft = ref<LabHostDraft>(labHostDraftOf(null));
	const routerDraft = ref<LabRouterDraft>(labRouterDraftOf(null));
	const fieldError = ref<LabDetailFieldError>();
	const live = ref<LabNodeLiveStats | null>(null);
	const liveError = ref<string>();
	const liveLoading = ref(false);

	const kindLabel = computed(() => t(`pages.scenario-simulator.kinds.${props.node?.kind ?? "host"}`));
	/** 只有这两类有编辑面，且要 `lab:operate` */
	const editable = computed(() => props.operate && (props.node?.kind === "host" || props.node?.kind === "router"));

	/**
	 * 「为什么这里没有编辑入口」（`NMCPS-ADR-0022` W13 收尾）。
	 *
	 * 三类原因分别对应三处事实，不能合成一句「只读」：
	 * - 交换机：OpenFlow 与流表入口在右栏，这里重复一份就是两个状态（一个动作只有一个入口）。
	 * - 控制器 / NAT：上游只改台账、不重启控制器，给按钮等于承诺一个不会发生的生效。
	 * - 主机 / 路由器但会话没有 `lab:operate`：能看不能改，要的是权限而不是别的入口。
	 */
	const readOnlyNote = computed(() => {
		const kind = props.node?.kind;
		if (!kind)
			return undefined;
		if (kind === "switch")
			return t("pages.scenario-simulator.nodeDetail.readOnlySwitch");
		if (kind === "controller" || kind === "nat")
			return t("pages.scenario-simulator.nodeDetail.readOnlyUnwired");
		return props.operate ? undefined : t("pages.scenario-simulator.nodeDetail.readOnlySession");
	});
	/** 只有主机 / 路由器有「默认路由 + 接口 + ARP」这类运行态读数 */
	const liveWanted = computed(() => props.node?.kind === "host" || props.node?.kind === "router");

	const routeTypeItems = computed(() => [
		{ label: t("pages.scenario-simulator.nodeDetail.routeTypeDev"), value: "dev" as const },
		{ label: t("pages.scenario-simulator.nodeDetail.routeTypeIp"), value: "ip" as const }
	]);

	/** 台账原样字段 → 展示行：只列有值的，不补默认值（没写就是没有） */
	const FACT_FIELDS: Array<{ key: string, label: string }> = [
		{ key: "name", label: "name" },
		{ key: "type", label: "type" },
		{ key: "ip", label: "ip" },
		{ key: "mac", label: "mac" },
		{ key: "controller", label: "controller" },
		{ key: "ports", label: "ports" },
		{ key: "switch_type", label: "switchType" },
		{ key: "of_version", label: "ofVersion" },
		{ key: "controller_type", label: "controllerType" },
		{ key: "remote", label: "remote" },
		{ key: "port", label: "port" },
		{ key: "ryu_app", label: "ryuApp" },
		{ key: "proxy_arp", label: "proxyArp" },
		{ key: "ip_forward", label: "ipForward" }
	];

	const factRows = computed(() => {
		const raw = props.node?.raw ?? {};
		return FACT_FIELDS.flatMap((field) => {
			const value = raw[field.key];
			const text = typeof value === "boolean"
				? (value ? "true" : "false")
				: typeof value === "number"
					? String(value)
					: typeof value === "string" ? value.trim() : "";
			if (!text)
				return [];
			return [{ key: field.key, label: t(`pages.scenario-simulator.nodeDetail.fields.${field.label}`), value: text }];
		});
	});

	/** 每次打开（或换了节点）都重新起草稿：上一次的编辑不该跟着串到另一个节点 */
	watch([open, () => props.node?.id], ([value]) => {
		if (!value)
			return;
		hostDraft.value = labHostDraftOf(props.node?.raw);
		routerDraft.value = labRouterDraftOf(props.node?.raw);
		fieldError.value = undefined;
		void loadLive();
	}, { immediate: true });

	/** 用户一动草稿就撤掉上一次的就地报错 —— 留着会指向已经改过的字段 */
	watch([hostDraft, routerDraft], () => {
		fieldError.value = undefined;
	}, { deep: true });

	async function loadLive(): Promise<void> {
		live.value = null;
		liveError.value = undefined;
		if (!props.node || !liveWanted.value)
			return;
		liveLoading.value = true;
		try {
			live.value = labNodeStatsOf(await api.get<unknown>(`/api/mininet/stats/${encodeURIComponent(props.node.id)}`));
		} catch (caught) {
			// 读不到是常态（网络没起 / 节点没有 pid）：降级成一行说明，不挡台账事实
			liveError.value = caught instanceof Error ? caught.message : String(caught);
		} finally {
			liveLoading.value = false;
		}
	}

	function submit(): void {
		const node = props.node;
		if (!node || !editable.value)
			return;
		if (node.kind === "host") {
			const failure = labHostUpdateError(hostDraft.value);
			fieldError.value = failure;
			if (failure)
				return;
			emit("submit", labHostAttributesOf(hostDraft.value));
			return;
		}
		const failure = labRouterUpdateError(routerDraft.value);
		fieldError.value = failure;
		if (failure)
			return;
		emit("submit", labRouterAttributesOf(routerDraft.value));
	}
</script>
