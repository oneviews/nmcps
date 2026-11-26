<template>
	<!--
		SNMP 采集面与 v2c 凭据（`NMCPS-ADR-0028` §7）：本页唯一入口在「文件」菜单。

		分工与既有弹窗一致：组件只呈现读模型与收集「点了哪个动作」，请求全部由页面发
		（页面是唯一写入方）。密文只从开通 / 轮换的响应里出现一次，因此这里**没有**
		从 `state.community` 展示密文的路径 —— 那是上游在未开通时回的部署默认串，
		不是编排出来的凭据。
	-->
	<UModal
		v-model:open="open"
		:title="t('pages.scenario-simulator.snmp.title')"
		:description="t('pages.scenario-simulator.snmp.hint')"
		:dismissible="!busy"
		:ui="{ footer: 'justify-end' }"
	>
		<template #body>
			<div data-testid="mininet-snmp-panel" class="space-y-3">
				<div v-if="loading" data-testid="mininet-snmp-loading" class="text-xs text-(--ui-text-muted)">
					{{ t("pages.scenario-simulator.snmp.loading") }}
				</div>

				<UAlert
					v-else-if="state === null"
					data-testid="mininet-snmp-unknown"
					color="warning"
					variant="subtle"
					icon="carbon:information"
					:title="t('pages.scenario-simulator.snmp.unknown')"
					:description="t('pages.scenario-simulator.snmp.unknownHint')"
				/>

				<template v-else>
					<div class="flex flex-wrap items-center justify-between gap-2">
						<span class="text-xs text-(--ui-text-muted)">
							{{ t("pages.scenario-simulator.snmp.collection") }}
						</span>
						<div class="flex items-center gap-2">
							<UBadge
								data-testid="mininet-snmp-enabled"
								:color="state.enabled ? 'success' : 'neutral'"
								variant="subtle"
								size="sm"
							>
								{{ state.enabled ? t("pages.scenario-simulator.snmp.enabledOn") : t("pages.scenario-simulator.snmp.enabledOff") }}
							</UBadge>
							<UBadge
								data-testid="mininet-snmp-agent"
								:color="state.running ? 'success' : 'neutral'"
								variant="subtle"
								size="sm"
							>
								{{ state.running ? t("pages.scenario-simulator.snmp.agentRunning") : t("pages.scenario-simulator.snmp.agentStopped") }}
							</UBadge>
						</div>
					</div>

					<dl class="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
						<dt class="text-(--ui-text-muted)">
							{{ t("pages.scenario-simulator.snmp.port") }}
						</dt>
						<dd class="font-mono">
							{{ state.port ?? "—" }}
						</dd>

						<dt class="text-(--ui-text-muted)">
							{{ t("pages.scenario-simulator.snmp.communitySource") }}
						</dt>
						<dd data-testid="mininet-snmp-community-source">
							{{ communitySourceLabel }}
						</dd>

						<dt class="text-(--ui-text-muted)">
							{{ t("pages.scenario-simulator.snmp.credential") }}
						</dt>
						<dd data-testid="mininet-snmp-credential">
							{{ credentialLabel }}
						</dd>

						<template v-if="state.onboarded">
							<dt class="text-(--ui-text-muted)">
								{{ t("pages.scenario-simulator.snmp.createdAt") }}
							</dt>
							<dd class="font-mono break-all">
								{{ state.credentialCreatedAt ?? "—" }}
							</dd>
							<dt class="text-(--ui-text-muted)">
								{{ t("pages.scenario-simulator.snmp.rotatedAt") }}
							</dt>
							<dd class="font-mono break-all">
								{{ state.credentialRotatedAt ?? "—" }}
							</dd>
						</template>

						<dt class="text-(--ui-text-muted)">
							{{ t("pages.scenario-simulator.snmp.nodes") }}
						</dt>
						<dd data-testid="mininet-snmp-nodes">
							{{ nodesLabel }}
						</dd>
					</dl>

					<UAlert
						v-if="!state.enabled"
						color="warning"
						variant="subtle"
						icon="carbon:warning-alt"
						:title="t('pages.scenario-simulator.snmp.disabledTitle')"
						:description="t('pages.scenario-simulator.snmp.disabledBody')"
					/>

					<UAlert
						v-if="state.credentialError"
						data-testid="mininet-snmp-credential-error"
						color="error"
						variant="subtle"
						icon="carbon:warning-alt"
						:title="t('pages.scenario-simulator.snmp.credentialError')"
						:description="state.credentialError"
					/>

					<!-- 密文只在这里出现一次：复制走页面的剪贴板动作，组件不自己写 -->
					<div
						v-if="secret"
						data-testid="mininet-snmp-secret"
						class="space-y-2 rounded-md border border-(--ui-border) p-2"
					>
						<p class="text-xs font-medium">
							{{ t("pages.scenario-simulator.snmp.secretTitle") }}
						</p>
						<div class="flex items-center gap-2">
							<UInput
								:model-value="secret.community"
								data-testid="mininet-snmp-secret-value"
								readonly
								size="xs"
								class="w-full font-mono"
							/>
							<UButton
								data-testid="mininet-snmp-copy"
								color="neutral"
								variant="subtle"
								icon="carbon:copy"
								size="xs"
								:label="t('pages.scenario-simulator.snmp.copy')"
								@click="emit('copy', secret.community)"
							/>
						</div>
						<p class="text-[11px] text-(--ui-text-muted)">
							{{ t("pages.scenario-simulator.snmp.secretHint") }}
						</p>
					</div>

					<UAlert
						v-if="revokeArmed"
						data-testid="mininet-snmp-revoke-warning"
						color="error"
						variant="subtle"
						icon="carbon:warning-alt"
						:title="t('pages.scenario-simulator.snmp.revokeTitle')"
						:description="t('pages.scenario-simulator.snmp.revokeBody')"
					/>

					<UAlert
						v-if="!canManage"
						data-testid="mininet-snmp-readonly"
						color="neutral"
						variant="subtle"
						icon="carbon:information"
						:title="t('pages.scenario-simulator.snmp.readonlyTitle')"
						:description="t('pages.scenario-simulator.snmp.readonlyBody')"
					/>
				</template>

				<UAlert
					v-if="error"
					data-testid="mininet-snmp-error"
					color="error"
					variant="subtle"
					icon="carbon:warning-alt"
					:title="t('pages.scenario-simulator.snmp.failed')"
					:description="error"
				/>
			</div>
		</template>

		<template #footer>
			<template v-if="revokeArmed">
				<UButton
					color="neutral"
					variant="ghost"
					:label="t('pages.scenario-simulator.snmp.cancelRevoke')"
					:disabled="busy"
					@click="revokeArmed = false"
				/>
				<UButton
					data-testid="mininet-snmp-revoke-confirm"
					color="error"
					icon="carbon:trash-can"
					:label="t('pages.scenario-simulator.snmp.revokeConfirm')"
					:loading="busy"
					@click="emit('revoke')"
				/>
			</template>
			<template v-else>
				<UButton
					color="neutral"
					variant="ghost"
					:label="t('pages.scenario-simulator.snmp.close')"
					:disabled="busy"
					@click="open = false"
				/>
				<UButton
					v-if="canManage && state && !state.onboarded"
					data-testid="mininet-snmp-onboard"
					color="primary"
					icon="carbon:add"
					:label="t('pages.scenario-simulator.snmp.onboard')"
					:loading="busy"
					@click="emit('onboard')"
				/>
				<UButton
					v-if="canManage && state?.onboarded"
					data-testid="mininet-snmp-rotate"
					color="primary"
					variant="subtle"
					icon="carbon:renew"
					:label="t('pages.scenario-simulator.snmp.rotate')"
					:loading="busy"
					@click="emit('rotate')"
				/>
				<UButton
					v-if="canManage && state?.onboarded"
					data-testid="mininet-snmp-revoke"
					color="error"
					variant="subtle"
					icon="carbon:trash-can"
					:label="t('pages.scenario-simulator.snmp.revoke')"
					:disabled="busy"
					@click="revokeArmed = true"
				/>
			</template>
		</template>
	</UModal>
</template>

<script setup lang="ts">
	import type { LabSnmpCredentialReveal, LabSnmpState } from "#layers/scenario/shared/types/labSnmp";

	/**
	 * SNMP 凭据弹窗（`NMCPS-ADR-0028` §7）。
	 *
	 * 吊销是破坏性的，因此点第一下只把「确认 / 取消」摆出来；BFF 的 `lab:snmp`
	 * 守卫才是真正的边界，这里只是不让误点把采集面推回部署默认串。
	 */
	const props = defineProps<{
		/** `null` = 读不到（未知），不是「未开通」 */
		state: LabSnmpState | null
		/** 开通 / 轮换响应里那一次密文；关掉弹窗或再次动作时由页面清空 */
		secret?: LabSnmpCredentialReveal | null
		loading?: boolean
		busy?: boolean
		/** 上游失败原话（`snmp_collection_disabled` / 409 / 404…），逐字展示 */
		error?: string
		/** `lab:snmp` 能力位：不渲染任何写按钮，但读数照常可见 */
		canManage: boolean
	}>();

	const emit = defineEmits<{
		onboard: []
		rotate: []
		revoke: []
		copy: [community: string]
	}>();

	const open = defineModel<boolean>("open", { required: true });

	const { t } = useI18n();

	/** 吊销的第二步确认；每次重新打开都复位，上一次没确认完不该替下一次背书 */
	const revokeArmed = ref(false);

	watch(open, (value) => {
		if (!value)
			revokeArmed.value = false;
	});

	watch(() => props.busy, (value) => {
		if (value)
			revokeArmed.value = false;
	});

	const communitySourceLabel = computed(() => {
		const source = props.state?.communitySource;
		if (source === "credential")
			return t("pages.scenario-simulator.snmp.sourceCredential");
		if (source === "deployment")
			return t("pages.scenario-simulator.snmp.sourceDeployment");
		return t("pages.scenario-simulator.snmp.unknownValue");
	});

	const credentialLabel = computed(() => {
		const state = props.state;
		if (!state)
			return t("pages.scenario-simulator.snmp.unknownValue");
		if (!state.onboarded)
			return t("pages.scenario-simulator.snmp.notOnboarded");
		return t("pages.scenario-simulator.snmp.onboardedVersion", { version: state.credentialVersion ?? "—" });
	});

	/** 节点只报「几台在跑 / 共几条」；台账 id 列表对凭据排障没有帮助 */
	const nodesLabel = computed(() => {
		const nodes = props.state?.nodes ?? [];
		if (!nodes.length)
			return t("pages.scenario-simulator.snmp.noNodes");
		const running = nodes.filter((node) => node.status === "running").length;
		return t("pages.scenario-simulator.snmp.nodesSummary", { running, total: nodes.length });
	});
</script>
