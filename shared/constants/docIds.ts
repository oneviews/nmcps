// shared/constants/docIds.ts
// 文档标识（docId）↔ 内容中心路径 的**唯一映射**（文档体系 S0）。
//
// 设计基准：NMCPS-GOV-001（layers/content/collections/cn/architecture/0.governance/doc-system-charter.md）
// 索引登记处：NMCPS-GOV-003（layers/content/collections/cn/architecture/0.governance/doc-map.md）
//
// 用途：
//   ① 代码 / 脚本不得硬编码文档路径 —— 一律 docPathOf(docId)；
//   ② 注释里的「设计基准」引用统一写 {docId}（{路径}），由 check:doc-system 校验两者一致；
//   ③ 文档改名 / 搬迁时只需改本文件。
//
// 约束：本文件是纯数据 + 纯函数（无 Nuxt 别名、无 IO、无副作用），Nuxt 侧与 node 脚本共用。

/** docId → 内容中心相对路径（新增文档必须同时登记本表与 doc-map.md） */
export const DOC_PATHS = {
	"NMCPS-GOV-001": "layers/content/collections/cn/architecture/0.governance/doc-system-charter.md",
	"NMCPS-GOV-003": "layers/content/collections/cn/architecture/0.governance/doc-map.md",
	"NMCPS-ADR-0001": "layers/content/collections/cn/records/adr/adr-0001.md",
	"NMCPS-ADR-0002": "layers/content/collections/cn/records/adr/adr-0002.md",
	"NMCPS-ADR-0003": "layers/content/collections/cn/records/adr/adr-0003.md",
	"NMCPS-ADR-0004": "layers/content/collections/cn/records/adr/adr-0004.md",
	"NMCPS-ADR-0005": "layers/content/collections/cn/records/adr/adr-0005.md",
	"NMCPS-ADR-0006": "layers/content/collections/cn/records/adr/adr-0006.md",
	"NMCPS-ADR-0007": "layers/content/collections/cn/records/adr/adr-0007.md",
	"NMCPS-ADR-0008": "layers/content/collections/cn/records/adr/adr-0008.md",
	"NMCPS-ADR-0010": "layers/content/collections/cn/records/adr/adr-0010.md",
	"NMCPS-ARCH-001": "layers/content/collections/cn/architecture/1.architecture/transport-architecture.md",
	"NMCPS-ARCH-002": "layers/content/collections/cn/architecture/1.architecture/datasource-architecture.md",
	"NMCPS-ARCH-003": "layers/content/collections/cn/architecture/1.architecture/iam-architecture.md",
	"NMCPS-ARCH-004": "layers/content/collections/cn/architecture/1.architecture/content-center-architecture.md",
	"NMCPS-DESIGN-001": "layers/content/collections/cn/architecture/2.domain/topology.md",
	"NMCPS-DESIGN-002": "layers/content/collections/cn/architecture/2.domain/spectrum.md",
	"NMCPS-DESIGN-003": "layers/content/collections/cn/architecture/2.domain/transmission.md",
	"NMCPS-DESIGN-004": "layers/content/collections/cn/architecture/2.domain/device.md",
	"NMCPS-DESIGN-005": "layers/content/collections/cn/architecture/2.domain/system.md",
	"NMCPS-DESIGN-006": "layers/content/collections/cn/architecture/2.domain/scenario.md",
	"NMCPS-DESIGN-007": "layers/content/collections/cn/architecture/2.domain/dashboard.md",
	"NMCPS-CONTRACT-001": "layers/content/collections/cn/architecture/3.contract/shared-types.md",
	"NMCPS-CONTRACT-002": "layers/content/collections/cn/architecture/3.contract/metrics.md"
} as const;

export type DocId = keyof typeof DOC_PATHS;

export function docPathOf(docId: string): string | undefined {
	return (DOC_PATHS as Record<string, string>)[docId];
}
