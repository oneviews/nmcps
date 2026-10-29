import type { GatewayMethod, GatewayResource, GatewayTarget } from "~~/shared/types/api";
import { GATEWAY_METHODS, GATEWAY_RESOURCES } from "~~/shared/types/api";

/** 默认开放动词：PATCH 仅对显式登记的资源开放（与 v1 `DEFAULT_GATEWAY_METHODS` 一致） */
const DEFAULT_METHODS: readonly GatewayMethod[] = ["GET", "POST", "PUT", "DELETE"];

const EXTRA_METHODS_BY_RESOURCE: Partial<Record<GatewayResource, readonly GatewayMethod[]>> = {
	frequency: ["PATCH"]
};

const RESOURCE_SET = new Set<string>(GATEWAY_RESOURCES);

export interface GatewayRejection {
	status: 400 | 404 | 405
	message: "bff_path_missing" | "bff_path_invalid" | "bff_resource_not_allowed" | "bff_method_not_allowed"
}

export type GatewayResolution = { target: GatewayTarget } | { rejection: GatewayRejection };

function safeDecode(part: string): string {
	try {
		return decodeURIComponent(part);
	} catch {
		return part;
	}
}

function isUnsafeSegment(segment: string): boolean {
	return segment === "."
		|| segment === ".."
		|| segment.includes("/")
		|| segment.includes("\\")
		|| segment.includes("\0");
}

function normalizeSegments(slug: unknown): string[] {
	const raw = Array.isArray(slug) ? slug : typeof slug === "string" ? [slug] : [];

	return raw
		.flatMap((part) => safeDecode(String(part)).split("/"))
		.map((part) => part.trim())
		.filter(Boolean);
}

/**
 * 把 `/api/**` 的 catch-all 段解析为上游目标。
 *
 * 安全边界：
 * - 第一段必须是 `GATEWAY_RESOURCES` 白名单资源，否则 404（绝不任意路径透传）；
 * - 动词必须在默认集合或该资源的额外集合内，否则 405；
 * - 段内拒绝 `.` / `..` / `/` / `\` / NUL（含百分号编码后的形态），杜绝路径穿越。
 *
 * 返回结果而非抛错：让 handler 以统一的 `ApiResponse` 信封回话，
 * 前端 `useApi` 不必兼容 Nitro 默认的错误页结构。
 */
export function resolveGatewayTarget(slug: unknown, method: string): GatewayResolution {
	const segments = normalizeSegments(slug);
	const [resource, ...rest] = segments;

	if (!resource) {
		return { rejection: { status: 400, message: "bff_path_missing" } };
	}

	if (!RESOURCE_SET.has(resource)) {
		return { rejection: { status: 404, message: "bff_resource_not_allowed" } };
	}

	if (rest.some(isUnsafeSegment)) {
		return { rejection: { status: 400, message: "bff_path_invalid" } };
	}

	const upperMethod = method.toUpperCase();
	const allowedMethods = [
		...DEFAULT_METHODS,
		...(EXTRA_METHODS_BY_RESOURCE[resource as GatewayResource] ?? [])
	];

	if (!GATEWAY_METHODS.includes(upperMethod as GatewayMethod) || !allowedMethods.includes(upperMethod as GatewayMethod)) {
		return { rejection: { status: 405, message: "bff_method_not_allowed" } };
	}

	return {
		target: {
			resource: resource as GatewayResource,
			segments: rest
		}
	};
}
