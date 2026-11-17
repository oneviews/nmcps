// layers/scenario/shared/types/labInterfaces.ts
// `GET /api/lab/interfaces` 的响应归一（NMCPS-ADR-0022 D6 监控通道的选项来源）。
//
// 上游 `list_mininet_interfaces()` 回 `{ nodes: [{ id, type, intfs, pid }] }`：
// 只有 hosts / switches，`intfs` 已剔掉 `lo` / `lo0`。页面拿它填「节点 → 接口」两栏，
// 形状不符一律空数组 —— 读不到就显示空态，不猜接口名（猜错会把监控连到不存在的接口上）。

export interface LabInterfaceNode {
	id: string
	type: string
	intfs: string[]
}

function nonEmptyString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function labInterfaceNodesOf(payload: unknown): LabInterfaceNode[] {
	if (!payload || typeof payload !== "object" || Array.isArray(payload))
		return [];

	const nodes = (payload as Record<string, unknown>).nodes;
	if (!Array.isArray(nodes))
		return [];

	return nodes.flatMap((item) => {
		if (!item || typeof item !== "object" || Array.isArray(item))
			return [];
		const record = item as Record<string, unknown>;
		const id = nonEmptyString(record.id);
		if (!id)
			return [];
		const intfs = Array.isArray(record.intfs)
			? record.intfs.map((intf) => nonEmptyString(intf)).filter((intf): intf is string => intf !== undefined)
			: [];

		return [{ id, type: nonEmptyString(record.type) ?? "host", intfs }];
	});
}
