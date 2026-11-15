// app/utils/graph/topologyNodeIcon.ts
// 设备类型 → Carbon 图标（纯函数 / 纯常量）：画布圆内的那枚图标由**节点事实**决定。
//
// 设计基准：NMCPS-DESIGN-001 §七「设备类型图标」（2026-11-15 用户裁决 + 同日两次修正）。
//   · 判据顺序固定：`category` → 名称 / `sysDescr` 关键词 → `type` → **所在层序**兜底；
//   · **交换机按层数、AP 按末梢 / 三层分档**（2026-11-15 裁决）：二层交换机画
//     `carbon:switch-layer-2`、三层交换机（汇聚 / 核心）画 `carbon:switch-layer-3`；Wi-Fi AP
//     末梢画 `carbon:wifi`、写明「三层」的 AP 画 `carbon:router-wifi` —— 「无线控制器」不是
//     AP 的图标，已删；**胖 AP 也是 AP**，不因带路由改画路由图标；
//   · **层数先看名称，再看 `type`**（2026-11-15 第二次修正）：现网与假上游把几乎所有网络设备
//     都登记成 `type: "access"`（核心路由器亦然），按 `type` 优先会把「汇聚交换机」画成二层、
//     「核心路由器」画成交换机；名称里的「汇聚 / 核心 / 三层」「接入 / 二层」才是真实层数；
//   · 图标集合取本地安装的 `@iconify-json/carbon`（画布用 `<UIcon mode="svg">` 渲染成
//     嵌套 `<svg>`），因此离线可用、不联网取图标、不新增依赖；这里的 `carbon:*` 字面量
//     同时是 `@nuxt/icon` `clientBundle.scan` 的扫描入口（`nuxt.config.ts` 的
//     `globInclude` 含 `**/*.ts`），删掉字面量等于删掉离线包；
//   · **上游 `icon` 字段不参与判断**：它的取值没有取证（可能是 antd / lucide 名），照搬会
//     让画布开出空白节点 —— 认不出就老实回 `carbon:network-4`，不猜；
//   · 与层色**互不影响**：层色（`topologyRoleStyle.ts`）读的是**层级**，这里读的是
//     **设备类型**（交换机层数 / AP 位置只借层序做兜底判断，不参与上色）—— 一台接入层的 AP
//     仍是蓝色外圈 + 无线图标。

import type { TopologyGraphNode } from "~~/shared/types/topology";

/**
 * 图标名表（`carbon:*` 字面量集中在这一处，便于静态扫描与自检）。
 * 键是**语义档**而不是图标名：页面 / 自检按档读数，换图标名只改这里。
 */
export const NODE_ICONS = {
	unknown: "carbon:network-4",
	router: "carbon:router",
	/** 三层交换机（汇聚 / 核心层，`type = distribution` 或自带三层能力） */
	switchLayer3: "carbon:switch-layer-3",
	/** 二层交换机（接入层，`type = access`） */
	switchLayer2: "carbon:switch-layer-2",
	/** 末梢 AP（挂在接入层，只做无线接入） */
	wifi: "carbon:wifi",
	/** 三层 AP（放在汇聚 / 核心层，自带路由） */
	routerWifi: "carbon:router-wifi",
	laptop: "carbon:laptop",
	mobile: "carbon:mobile",
	firewall: "carbon:firewall",
	server: "carbon:bare-metal-server",
	cloud: "carbon:cloud",
	printer: "carbon:printer"
} as const;

/** 设备类型的语义档（`NODE_ICONS` 的键） */
export type TopologyNodeIconKind = keyof typeof NODE_ICONS;

/** 图标判据只读这五个字段（其余事实与图标无关） */
export type TopologyIconNode = Pick<TopologyGraphNode, "category" | "type" | "name" | "sysDescr" | "tier">;

/** 名称 / `sysDescr` 关键词（已小写；顺序即优先级，见 `nodeIconKindOf()`） */
const MOBILE_KEYWORD = /手机|移动终端|phone|mobile|handset/;
const FIREWALL_KEYWORD = /防火墙|firewall/;
const SERVER_KEYWORD = /服务器|server/;
const CLOUD_KEYWORD = /云|cloud/;
const PRINTER_KEYWORD = /打印机|printer/;
/** 路由器 / 网控中心：名称写明的比 `type` 可信（现网 `type` 实测多为 `access`） */
const ROUTER_KEYWORD = /路由器|router|网控中心|控制中心/;
/** «三层» 线索：名称写着三层 / 汇聚 / 核心的交换机是三层交换机 */
const LAYER3_NAME_KEYWORD = /三层|汇聚|核心/;
/** «二层» 线索：名称写着二层 / 接入的交换机是二层交换机 */
const LAYER2_NAME_KEYWORD = /二层|接入/;
/** 名称里直接写着「三层」的 AP：这类 AP 自带路由，画 `carbon:router-wifi` */
const THREE_LAYER_AP_KEYWORD = /三层|l3/;
/** «交换机» 关键词：名称是唯一能说清「这是交换机」的证据（`type` 实测多为空 / 恒为 access） */
const SWITCH_KEYWORD = /交换机|switch/;

/** 「汇聚及以上」的层序上限（1 核心 / 2 汇聚）：名称 / `type` 都说不出层数时的兜底 */
const LAYER3_MAX_TIER = 2;

/** 归一：小写 + 去首尾空白（上游字符串没有大小写 / 空格保证） */
function textOf(value: unknown): string {
	return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/** 归一：只有有限数值才算「第几层」（`null` / `undefined` / `NaN` 一律未知，不参与判据） */
function tierOf(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * 交换机是三层还是二层（`carbon:switch-layer-3` / `switch-layer-2`）。
 *
 * **名称先说话**：现网（以及假上游的三个样本）把几乎所有网络设备都登记成 `type: "access"`，
 * 连核心路由器也不例外 —— 按 `type` 优先会把「汇聚交换机」画成二层、「核心路由器」画成交换机
 * （2026-11-15 用户实测指出）。所以顺序是：名称里的层数线索（三层 / 汇聚 / 核心 vs 二层 / 接入）
 * → `type`（`distribution` = 三层、`access` = 二层）→ **所在层序**兜底（汇聚及以上按三层）。
 */
function isLayer3Switch(words: string, type: string, tier: number | null): boolean {
	if (LAYER3_NAME_KEYWORD.test(words))
		return true;
	if (LAYER2_NAME_KEYWORD.test(words))
		return false;
	if (type === "core" || type === "boundary" || type === "root" || type === "distribution" || type === "distro")
		return true;
	if (type === "access" || type === "switch")
		return false;
	return tier !== null && tier <= LAYER3_MAX_TIER;
}

/**
 * 设备类型 → 图标档（判据顺序见文件头，**第一条命中就返回**）。
 *
 * 为什么 `category=ap` 必须排在 `type=access` 前面：上游的 AP 同样是 `type: "access"`
 * （§6.10 实测），先按 `type` 判会把每一台 AP 画成接入交换机。
 * 为什么名称 / 描述关键词排在 `type` 前面：`type` 只有 core / distribution / access 三档，
 * 而且现网普遍写成 `access`（核心路由器也是），防火墙、服务器、云网关、网控中心都可能被
 * 登记成 `access` —— 名称是唯一能说清「它到底是什么」的证据。
 *
 * `tier` 是节点**所在层序**（画布传布局归约后的 `item.tier`）：只在名称与 `type` 都说不出
 * 交换机层数时兜底，AP 不看它（**胖 AP 也是 AP**，一律 `carbon:wifi`）。
 */
export function nodeIconKindOf(node: TopologyIconNode, tier?: number | null): TopologyNodeIconKind {
	const category = textOf(node.category);
	const type = textOf(node.type);
	const words = `${textOf(node.name)} ${textOf(node.sysDescr)}`;
	const level = tierOf(tier) ?? tierOf(node.tier);

	// 1. 无线接入点（AP 的 `type` 也是 access，必须先判 category）：末梢 / 三层分档只看名称
	if (category === "ap")
		return THREE_LAYER_AP_KEYWORD.test(words) ? "routerWifi" : "wifi";

	// 2. 终端：手机会员的设备与桌面终端分开画（同一档层色，图标回答「谁在末端」）
	if (category === "client" || type === "endnode" || type === "client")
		return MOBILE_KEYWORD.test(words) ? "mobile" : "laptop";

	// 3. 名称 / 描述能直接认出的专用设备
	if (FIREWALL_KEYWORD.test(words))
		return "firewall";
	if (SERVER_KEYWORD.test(words))
		return "server";
	if (CLOUD_KEYWORD.test(words))
		return "cloud";
	if (PRINTER_KEYWORD.test(words))
		return "printer";

	// 4. 路由器 / 网控中心：名称写明的优先（`type` 被登记成 access 也照名称画）
	if (ROUTER_KEYWORD.test(words))
		return "router";

	// 5. 交换机：二层 / 三层（名称含「交换机」而 `type` 给了 core 的，就是核心交换机）
	if (SWITCH_KEYWORD.test(words) || type === "switch")
		return isLayer3Switch(words, type, level) ? "switchLayer3" : "switchLayer2";
	if (type === "distribution" || type === "distro")
		return "switchLayer3";
	if (type === "access")
		return "switchLayer2";

	// 6. 契约口径的核心 / 边界
	if (type === "core" || type === "boundary" || type === "root")
		return "router";

	// 7. 兜底：字段全缺 / 新取值 —— 画通用网络图标，不冒充某一种设备
	return "unknown";
}

/** 设备类型 → Carbon 图标名（画布只读这个；`tier` 见 `nodeIconKindOf()`） */
export function nodeIconOf(node: TopologyIconNode, tier?: number | null): string {
	return NODE_ICONS[nodeIconKindOf(node, tier)];
}
