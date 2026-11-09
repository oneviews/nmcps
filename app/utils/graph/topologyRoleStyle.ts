// app/utils/graph/topologyRoleStyle.ts
// 节点**层级角色** → 样式（纯函数 / 纯常量）：复刻 1.0 的「外圈层色 + 中心状态圆点」视觉语言。
//
// 1.0 的形状口径（`lib/topologyNodeGeometry.ts` + `TopologyGraph.getNodeStyle()`）：
//   · 外圈**恒为层色**，填充恒为极淡中性色；
//   · 状态语义**只由中心圆点承载**（`statusDot*`，v0.31 用户裁决「不要改变外圈颜色」）；
//   · 节点直径随角色递减（核心 48 → 汇聚 46 → 接入 42 → 终端 36）。
// 2.0 沿用同一套语义，但层色**不再是 Nuxt UI 的四档状态语义色**（2026-11-09 用户指定五档色板
// 边界 `#f33` / 核心 `#f3c` / 汇聚 `#c63` / 接入 `#369` / 终端 `#0c6`）：状态色只有 error / warning /
// info / success 四个可用档位，五个层级必然有两层同色（根曾借用中性色），且用户要的是「照着
// 1.0 的色板来」。故五档层色**唯一源**在 `app/assets/css/main.css` 的 `--topology-tier-*`，
// 这里只引用变量名（组件里仍然没有硬编码 hex，与 §七 同口径）。
//
// 角色由**所在层序**决定而不是上游 `type`：`tier` 只表达「第几层」，`type` 表达「什么设备」
// （1.0 ADR-012 同口径：按 `type` 取色会让接入交换机与核心路由器同色）。

/** 层级角色（1.0 的 `corenode / distnode / accessnode / endnode`，词表收敛为四档 + 选举出的根） */
export type TopologyNodeRole = "root" | "core" | "distro" | "access" | "terminal";

/**
 * 层色的语义名（`RoleColor`）：与 `--topology-tier-{boundary,core,distro,access,terminal}` 一一对应。
 *
 * 不再复用 `StatusColor`：层色现在自带一套色板，与「严重程度」无关 —— 同名会让读者以为
 * `error` 那档代表「有故障」。这个值只作读数（页面的 `data-role-color`），不喂 `UBadge` 的 color。
 */
export type RoleColor = "boundary" | "core" | "distro" | "access" | "terminal";

/** 图例 / 遍历用的固定顺序：由高到低 */
export const TOPOLOGY_NODE_ROLES: readonly TopologyNodeRole[] = ["root", "core", "distro", "access", "terminal"];

/**
 * 层色（画布外圈 `stroke-*` / 图例色块 `border-*` 两张类名并列写在 `ROLE_TONE` 里）。
 *
 * 五档色（2026-11-09 用户指定）：边界 `#f33` / 核心 `#f3c` / 汇聚 `#c63` / 接入 `#369` / 终端 `#0c6`。
 * 根（网控中心）现在有自己的第五档红（`#f33`），不再借用中性深色 —— 五层各自一色，
 * 「同一层 = 同一色」在根上也成立，图例因此能列全五行。
 *
 * 值本身在 `app/assets/css/main.css` 的 `--topology-tier-*`（唯一源）：Tailwind 的
 * `stroke-(--x)` / `border-(--x)` 语法直接吃 CSS 变量，组件的类名表里不留 hex。
 */
const ROLE_TONE: Record<TopologyNodeRole, { stroke: string, dot: string }> = {
	root: { stroke: "stroke-(--topology-tier-boundary)", dot: "border-(--topology-tier-boundary)" },
	core: { stroke: "stroke-(--topology-tier-core)", dot: "border-(--topology-tier-core)" },
	distro: { stroke: "stroke-(--topology-tier-distro)", dot: "border-(--topology-tier-distro)" },
	access: { stroke: "stroke-(--topology-tier-access)", dot: "border-(--topology-tier-access)" },
	terminal: { stroke: "stroke-(--topology-tier-terminal)", dot: "border-(--topology-tier-terminal)" }
};

/** 图例色块 / 徽标语义色（与描边同源，避免「图例和画布不是一个颜色」） */
const ROLE_COLOR: Record<TopologyNodeRole, RoleColor> = {
	root: "boundary",
	core: "core",
	distro: "distro",
	access: "access",
	terminal: "terminal"
};

/**
 * 节点半径（画布逻辑单位）。
 *
 * 1.0 是 48 / 46 / 42 / 36（px，随画布缩放系数再乘）；2.0 的画布按 `viewBox` 等比缩放，
 * 取其 1/3 作为基准（16 / 15.5 / 14 / 12 → 整数化 17 / 16 / 14 / 12 保持同序递减）。
 * 根节点再大一档（19）：它是整张图的顶点，也是唯一「只有一个」的角色。
 */
const ROLE_RADIUS: Record<TopologyNodeRole, number> = {
	root: 19,
	core: 17,
	distro: 16,
	access: 14,
	terminal: 12
};

/**
 * 中心状态圆点半径 = 节点半径 × 本系数（圆点直径 = 节点直径 × 0.38）。
 *
 * 1.0 是「圆点直径 = 节点直径 × 0.2」（`statusDotSizeOf()`）；2.0 的塔型画布会被 `viewBox`
 * 缩到 0.3~0.5 倍，×0.2 在屏幕上只剩 1px（状态等于看不见），故按 2 倍放大 —— 语义不变
 * （状态只走圆点、不改外圈），只是把 1.0 在 1:1 画布上的可读比例搬过来。
 */
export const STATUS_DOT_RATIO = 0.38;

/**
 * 叶子（无下级）归位的层级号：**终端层**（`NMCPS-DESIGN-001` §6.8 / §6.15.2 第 3 条）。
 *
 * 上游 `tier` 是设备**登记时的类别**，它不会跟着组网变：一台登记为「接入」（tier 3）的 AP，
 * 若它下面一个可管设备都没有（现网的「Wi-Fi胖AP-10」就是这样：胖 AP 自己发地址、客户端不进拓扑），
 * 画成蓝色接入就把「它下面还有一层」这件事说错了 —— 图上它是末端。故层序归约下移到末层的节点
 * 一律读作终端层（绿），`tier` 也改写成本值，详情栏与画布说的是同一件事。
 */
export const LEAF_TIER = 4;

/**
 * 被选举出的根（网控中心）的层号：**0**（2026-11-09 用户裁决，原来是 1）。
 *
 * 上游把网控中心登记成 `tier 1`，与核心层同档：图上它被名称判据上提到首行，详情栏却仍写
 * 「层级 1」，读起来像「它就是一台核心」。根是**整张图的顶点**，比边界层还高一档，
 * 因此单独占 0 档 —— `1` 从此只表示「边界层」，五档层级（0/1/2/3/4）与五个角色一一对应。
 *
 * `normalizeTier()` 把上游值收在 1..4，所以这个 0 **只可能**由层序归约（根节点选举）产生。
 */
export const ROOT_TIER = 0;

/**
 * 环号 → 角色（三种布局共用）。
 *
 * `tier` 是**上游实测字段**（1 核心 / 2 汇聚 / 3 接入 / 4 终端），它表达「这台设备是什么层级」，
 * 比「第几行 / 第几环」更稳：根节点选举把某台核心上提一层后，被留在第二行的核心仍是 `core`
 * （红色不变），不会因为换了行就被染成别的层色。
 *
 * 唯一例外是**叶子**（`isLeaf`，由 `resolveLayeredRanks()` 的 `demotedIds` 判定）：它下面再没有
 * 一层，读作 `terminal`（见 `LEAF_TIER`）—— 这一条是行号与类别唯一允许的交汇点，方向只有一个
 * （往终端收，绝不往核心抬）。选举出的根仍由调用方覆盖成 `root`，不在这里推断；
 * 但 **0 档仍读作 `root`**（见 `ROOT_TIER`）—— 五档层级与五个角色一一对应，没有「0 档算什么」的空白。
 *
 * 两种布局（`radial` / `tree`）都走这个函数：换布局只换坐标，不换角色 ——
 * 同一台设备在径向扇里是蓝色接入，切到层级树也必须还是蓝色接入。
 */
export function roleOfTier(tier: number): TopologyNodeRole {
	if (!Number.isFinite(tier))
		return "core";
	if (tier <= ROOT_TIER)
		return "root";
	if (tier === 1)
		return "core";
	if (tier === 2)
		return "distro";
	if (tier === 3)
		return "access";
	return "terminal";
}

/** 节点角色：按 `tier` 取，叶子一律归位终端层（见 `LEAF_TIER`） */
export function roleOfNode(tier: number, isLeaf: boolean): TopologyNodeRole {
	return isLeaf ? "terminal" : roleOfTier(tier);
}

/**
 * 节点实际层号：**被选举出的根改写为 `ROOT_TIER`（0）**，叶子改写为 `LEAF_TIER`（4），其余原样
 * （画布 / 详情栏同源）。
 *
 * 根优先于叶子：一台没有任何下级的设备若被选举成根（单机图），它是顶点而不是末端 ——
 * 否则同一台设备会同时被要求「在首行」和「读作终端层」。
 */
export function tierOfNode(tier: number, isLeaf: boolean, isRoot = false): number {
	if (isRoot)
		return ROOT_TIER;
	return isLeaf ? LEAF_TIER : tier;
}

/** 只保留**实际出现**的角色，并按由高到低排序（图例用：这张图没有根就不该列出根） */
export function presentRoles(roles: Iterable<TopologyNodeRole>): TopologyNodeRole[] {
	const seen = new Set<TopologyNodeRole>(roles);
	return TOPOLOGY_NODE_ROLES.filter((role) => seen.has(role));
}

/**
 * 层色类（画布外圈 / 图例色块**分开写**）。
 *
 * 画布是 SVG（认 `stroke-*`），图例是 HTML `<span>`（认 `border-*`）—— HTML 元素上写
 * `stroke-*` 不产生任何视觉，图例色块曾经因此四个同色（`border-2` 只给了宽度，颜色落到
 * `currentColor`），「图例和画布不是一个颜色」。两套类名并列写在同一张表里，而不是运行时
 * 拼字符串：Tailwind 要能静态扫到类名。
 */
export function roleStrokeClass(role: TopologyNodeRole): string {
	return ROLE_TONE[role].stroke;
}

/** 图例色块的描边类（HTML `<span>` 用；与画布外圈同源，见 `ROLE_TONE`） */
export function roleDotClass(role: TopologyNodeRole): string {
	return ROLE_TONE[role].dot;
}

/** 角色语义色（图例 `UBadge` / 列表色块） */
export function roleColor(role: TopologyNodeRole): RoleColor {
	return ROLE_COLOR[role];
}

/** 角色半径（画布逻辑单位） */
export function nodeRadiusOf(role: TopologyNodeRole): number {
	return ROLE_RADIUS[role];
}

/** 中心状态圆点半径（随节点半径等比缩放） */
export function statusDotRadius(role: TopologyNodeRole): number {
	return Math.round(ROLE_RADIUS[role] * STATUS_DOT_RATIO * 10) / 10;
}

/** 角色文案的 i18n 相对键（`pages.topology-monitor.roles.*`） */
export function roleI18nKey(role: TopologyNodeRole): string {
	return `pages.topology-monitor.roles.${role}`;
}
