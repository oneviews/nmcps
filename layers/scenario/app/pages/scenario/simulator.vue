<template>
	<div class="flex min-h-0 flex-1 flex-col gap-3 p-3">
		<Teleport to="#app-toolbar-left">
			<div class="flex items-center gap-1">
				<UButton
					data-testid="mininet-refresh"
					size="xs"
					color="neutral"
					variant="subtle"
					icon="carbon:renew"
					:loading="loading"
					:label="$t('pages.scenario-simulator.toolbar.refresh')"
					@click="load()"
				/>
				<USwitch
					v-model="showLabels"
					data-testid="mininet-labels-toggle"
					size="sm"
					:label="$t('pages.scenario-simulator.toolbar.labels')"
				/>
			</div>
		</Teleport>

		<Teleport to="#app-toolbar-right">
			<div class="flex items-center gap-1">
				<LayoutToolbarBadge
					v-for="stat in statBadges"
					:key="stat.key"
					:data-testid="`mininet-stat-${stat.key}`"
					variant="subtle"
					color="neutral"
					:icon="stat.icon"
					:label="`${stat.label} ${stat.text}`"
				/>
			</div>
		</Teleport>

		<UAlert
			v-if="error"
			data-testid="mininet-error"
			color="error"
			variant="subtle"
			icon="carbon:warning-alt"
			:title="$t('pages.scenario-simulator.error.title')"
			:description="error"
		>
			<template #actions>
				<UButton
					size="sm"
					color="neutral"
					variant="subtle"
					:label="$t('pages.scenario-simulator.toolbar.refresh')"
					@click="load()"
				/>
			</template>
		</UAlert>

		<div v-else-if="loading && !positioned.length" class="flex min-h-0 flex-1 items-center justify-center">
			<USkeleton class="h-full min-h-96 w-full rounded-lg" />
		</div>

		<div
			v-else-if="!network"
			data-testid="mininet-empty"
			class="flex min-h-0 flex-1 items-center justify-center"
		>
			<div class="flex max-w-md flex-col items-center gap-3 text-center">
				<UIcon name="carbon:network-4" class="size-12 text-(--ui-text-muted)" />
				<h2 class="text-lg font-semibold">
					{{ $t("pages.scenario-simulator.empty.title") }}
				</h2>
				<p class="text-sm text-(--ui-text-muted)">
					{{ $t("pages.scenario-simulator.empty.body") }}
				</p>
			</div>
		</div>

		<div v-else class="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
			<div class="relative min-h-[420px] flex-1 overflow-hidden rounded-lg border border-(--ui-border)">
				<GraphTopologyCanvas
					v-if="positioned.length"
					:nodes="positioned"
					:links="graphLinks"
					:width="canvasWidth"
					:height="canvasHeight"
					:selected-id="selectedId"
					:selected-link-key="selectedLinkKey"
					:link-title="linkTitle"
					:show-labels="showLabels"
					:label="$t('pages.scenario-simulator.canvasLabel')"
					@select="selectNode"
					@select-link="selectLink"
				/>
				<div v-else class="flex h-full min-h-96 items-center justify-center">
					<p class="text-sm text-(--ui-text-muted)">
						{{ $t("pages.scenario-simulator.empty.topology") }}
					</p>
				</div>
			</div>

			<aside data-testid="mininet-detail" class="flex w-full shrink-0 flex-col gap-3 lg:w-72">
				<div class="rounded-lg border border-(--ui-border) p-3">
					<h2 class="mb-2 text-sm font-semibold">
						{{ $t("pages.scenario-simulator.network.title") }}
					</h2>
					<dl class="grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
						<template v-for="row in networkRows" :key="row.key">
							<dt class="text-(--ui-text-muted)">
								{{ row.label }}
							</dt>
							<dd class="truncate">
								{{ row.value }}
							</dd>
						</template>
					</dl>
				</div>

				<div class="rounded-lg border border-(--ui-border) p-3">
					<h2 class="mb-2 text-sm font-semibold">
						{{ $t("pages.scenario-simulator.detail.title") }}
					</h2>

					<template v-if="selectedLink">
						<div class="flex items-center justify-between gap-2">
							<span class="truncate font-medium">{{ selectedLink.source }} ↔ {{ selectedLink.target }}</span>
							<UBadge size="sm" variant="subtle" color="success">
								{{ $t("pages.scenario-simulator.detail.link") }}
							</UBadge>
						</div>
						<dl class="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
							<dt class="text-(--ui-text-muted)">
								{{ $t("pages.scenario-simulator.detail.from") }}
							</dt>
							<dd class="truncate">
								{{ selectedLink.source }}
							</dd>
							<dt class="text-(--ui-text-muted)">
								{{ $t("pages.scenario-simulator.detail.to") }}
							</dt>
							<dd class="truncate">
								{{ selectedLink.target }}
							</dd>
						</dl>
					</template>

					<template v-else-if="selectedNode">
						<div class="flex items-center justify-between gap-2">
							<span class="truncate font-medium">{{ selectedNode.positioned.label }}</span>
							<UBadge size="sm" variant="subtle" color="neutral">
								{{ selectedNode.kind }}
							</UBadge>
						</div>
						<dl class="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
							<template v-for="row in nodeRows" :key="row.key">
								<dt class="text-(--ui-text-muted)">
									{{ row.label }}
								</dt>
								<dd class="truncate">
									{{ row.value }}
								</dd>
							</template>
						</dl>
					</template>

					<p v-else class="text-xs text-(--ui-text-muted)">
						{{ $t("pages.scenario-simulator.detail.hint") }}
					</p>
				</div>
			</aside>
		</div>
	</div>
</template>

<script setup lang="ts">
	import type { PositionedTopologyNode } from "~~/app/utils/graph/topologyLayout";
	import type { TopologyNodeRole } from "~~/app/utils/graph/topologyRoleStyle";
	import type { LabNetworkSummary } from "~~/shared/types/lab";
	import type { TopologyGraphLink, TopologyGraphNode } from "~~/shared/types/topology";
	import { topologyLinkKey } from "~~/app/utils/graph/topologyNormalize";

	definePageMeta({ sort: 1, icon: "carbon:flash" });

	interface RawMininetNode {
		id?: string
		name?: string
		label?: string
		type?: string
		x?: unknown
		y?: unknown
		ip?: string
		mac?: string
		controller?: string
		ports?: number
		switch_type?: string
	}

	type NodeKind = "host" | "switch" | "router" | "nat" | "controller";

	interface GraphNode {
		key: string
		kind: NodeKind
		raw: RawMininetNode
		positioned: PositionedTopologyNode
	}

	const api = useApi();
	const { t } = useI18n();

	const loading = ref(false);
	const error = ref<string | null>(null);
	const networks = ref<LabNetworkSummary[]>([]);
	const nodes = ref<GraphNode[]>([]);
	const graphLinks = ref<TopologyGraphLink[]>([]);
	const canvasWidth = ref(960);
	const canvasHeight = ref(640);
	const showLabels = ref(true);
	const selectedId = ref<string | null>(null);
	const selectedLinkKey = ref<string | null>(null);

	const network = computed(() => networks.value[0] ?? null);
	const positioned = computed(() => nodes.value.map((item) => item.positioned));
	const selectedNode = computed(() => nodes.value.find((item) => item.positioned.id === selectedId.value) ?? null);
	const selectedLink = computed(() => {
		const index = graphLinks.value.findIndex((link, position) => topologyLinkKey(link, position) === selectedLinkKey.value);
		return index >= 0 ? graphLinks.value[index] ?? null : null;
	});

	function messageOf(value: unknown): string {
		return value instanceof Error ? value.message : String(value);
	}

	function asRecord(value: unknown): Record<string, unknown> | undefined {
		return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
	}

	function rawNodesOf(payload: unknown, kind: NodeKind): RawMininetNode[] {
		const list: RawMininetNode[] = [];
		if (Array.isArray(payload)) {
			for (const item of payload) {
				const record = asRecord(item);
				if (record)
					list.push({ ...record as RawMininetNode, type: kind });
			}
			return list;
		}

		const record = asRecord(payload);
		if (!record)
			return list;
		for (const [key, item] of Object.entries(record)) {
			const value = asRecord(item);
			if (!value)
				continue;
			list.push({
				...value as RawMininetNode,
				name: typeof value.name === "string" ? value.name : key,
				type: kind
			});
		}
		return list;
	}

	function rawLinksOf(payload: unknown): TopologyGraphLink[] {
		if (!Array.isArray(payload))
			return [];
		return payload.flatMap((item) => {
			const record = asRecord(item);
			const source = typeof record?.from === "string" ? record.from : undefined;
			const target = typeof record?.to === "string" ? record.to : undefined;
			if (!source || !target)
				return [];
			return [{
				source,
				target,
				status: "online",
				linkType: "ethernet"
			} satisfies TopologyGraphLink];
		});
	}

	function roleOf(kind: NodeKind): TopologyNodeRole {
		if (kind === "switch")
			return "access";
		if (kind === "host")
			return "terminal";
		return "core";
	}

	function coordinate(value: unknown, fallback: number): number {
		return typeof value === "number" && Number.isFinite(value) ? value : fallback;
	}

	function buildGraph(rawNodes: RawMininetNode[], rawLinks: TopologyGraphLink[]): void {
		const seen = new Set<string>();
		const unique = rawNodes.filter((node) => {
			const key = node.name ?? node.id;
			if (!key || seen.has(key))
				return false;
			seen.add(key);
			return true;
		});

		const layoutNodes: GraphNode[] = [];
		const usedIds = new Set<string>();
		const columns = Math.max(1, Math.ceil(Math.sqrt(unique.length)));
		const xs = unique.map((node) => node.x).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
		const ys = unique.map((node) => node.y).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
		const hasSpread = xs.length > 0 && ys.length > 0
			&& (Math.max(...xs) - Math.min(...xs) > 1 || Math.max(...ys) - Math.min(...ys) > 1);
		const minX = hasSpread ? Math.min(...xs) : 0;
		const minY = hasSpread ? Math.min(...ys) : 0;

		for (const [index, raw] of unique.entries()) {
			const label = raw.label || raw.name || raw.id || `node-${index + 1}`;
			const kind = (raw.type ?? "host") as NodeKind;
			let id = raw.name || raw.id || label;
			if (usedIds.has(id))
				id = `${id}-${index}`;
			usedIds.add(id);

			const role = roleOf(kind);
			const graphNode: TopologyGraphNode = {
				id,
				name: label,
				label,
				ip: raw.ip,
				category: kind === "host" ? "client" : "network-device",
				type: kind,
				status: "online"
			};
			const x = hasSpread ? coordinate(raw.x, 0) - minX + 80 : 80 + (index % columns) * 160;
			const y = hasSpread ? coordinate(raw.y, 0) - minY + 80 : 80 + Math.floor(index / columns) * 140;

			layoutNodes.push({
				key: label,
				kind,
				raw,
				positioned: {
					node: graphNode,
					id,
					label,
					labelShift: 0,
					labelDirDx: 0,
					labelDirDy: 1,
					tier: role === "terminal" ? 4 : role === "core" ? 1 : 3,
					rank: role === "terminal" ? 2 : role === "core" ? 0 : 1,
					role,
					x,
					y
				}
			});
		}

		const ids = new Set(layoutNodes.map((item) => item.positioned.id));
		nodes.value = layoutNodes;
		graphLinks.value = rawLinks.filter((link) => ids.has(link.source) && ids.has(link.target));
		canvasWidth.value = Math.max(720, ...layoutNodes.map((item) => item.positioned.x + 120));
		canvasHeight.value = Math.max(480, ...layoutNodes.map((item) => item.positioned.y + 100));

		if (selectedId.value && !ids.has(selectedId.value))
			selectedId.value = null;
	}

	function resetGraph(): void {
		nodes.value = [];
		graphLinks.value = [];
		selectedId.value = null;
		selectedLinkKey.value = null;
	}

	async function load(): Promise<void> {
		loading.value = true;
		error.value = null;

		try {
			networks.value = await api.get<LabNetworkSummary[]>("/api/lab/networks");
			if (!networks.value.length) {
				resetGraph();
				return;
			}

			const requests: Array<{ kind: NodeKind, path: string }> = [
				{ kind: "host", path: "/api/lab/hosts" },
				{ kind: "switch", path: "/api/lab/switches" },
				{ kind: "router", path: "/api/lab/routers" },
				{ kind: "nat", path: "/api/lab/nats" },
				{ kind: "controller", path: "/api/lab/controllers" }
			];

			const [nodeResults, linkResult] = await Promise.all([
				Promise.allSettled(requests.map((item) => api.get<unknown>(item.path))),
				Promise.allSettled([api.get<unknown>("/api/lab/links")])
			]);

			const rawNodes: RawMininetNode[] = [];
			const failures: unknown[] = [];
			for (const [index, result] of nodeResults.entries()) {
				if (result.status === "fulfilled")
					rawNodes.push(...rawNodesOf(result.value, requests[index]!.kind));
				else
					failures.push(result.reason);
			}

			const linkOutcome = linkResult[0]!;
			if (linkOutcome.status === "rejected")
				failures.push(linkOutcome.reason);

			if (!rawNodes.length && failures.length)
				throw failures[0];

			buildGraph(
				rawNodes,
				linkOutcome.status === "fulfilled" ? rawLinksOf(linkOutcome.value) : []
			);
		} catch (caught) {
			resetGraph();
			error.value = messageOf(caught);
		} finally {
			loading.value = false;
		}
	}

	function selectNode(id: string): void {
		selectedId.value = id;
		selectedLinkKey.value = null;
	}

	function selectLink(key: string): void {
		selectedLinkKey.value = key;
		selectedId.value = null;
	}

	function linkTitle(link: TopologyGraphLink): string {
		return `${link.source} ↔ ${link.target}`;
	}

	const statBadges = computed(() => [
		{ key: "network", label: t("pages.scenario-simulator.stats.network"), text: network.value?.state ?? "—", icon: "carbon:flash" },
		{ key: "nodes", label: t("pages.scenario-simulator.stats.nodes"), text: String(nodes.value.length), icon: "carbon:bare-metal-server" },
		{ key: "links", label: t("pages.scenario-simulator.stats.links"), text: String(graphLinks.value.length), icon: "carbon:link" }
	]);

	const networkRows = computed(() => network.value
		? [
			{ key: "id", label: t("pages.scenario-simulator.network.id"), value: network.value.id },
			{ key: "engine", label: t("pages.scenario-simulator.network.engine"), value: network.value.engine },
			{ key: "state", label: t("pages.scenario-simulator.network.state"), value: network.value.state },
			{ key: "nodeCount", label: t("pages.scenario-simulator.network.nodeCount"), value: network.value.node_count === null ? "—" : String(network.value.node_count) }
		]
		: []);

	const nodeRows = computed(() => selectedNode.value
		? [
			{ key: "id", label: t("pages.scenario-simulator.detail.id"), value: selectedNode.value.positioned.id },
			{ key: "ip", label: t("pages.scenario-simulator.detail.ip"), value: selectedNode.value.raw.ip || "—" },
			{ key: "mac", label: t("pages.scenario-simulator.detail.mac"), value: selectedNode.value.raw.mac || "—" },
			{ key: "links", label: t("pages.scenario-simulator.detail.links"), value: String(graphLinks.value.filter((link) => link.source === selectedNode.value?.positioned.id || link.target === selectedNode.value?.positioned.id).length) }
		]
		: []);

	onMounted(load);
</script>
