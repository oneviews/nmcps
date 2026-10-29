import { defineEventHandler, getHeader, setResponseHeaders, setResponseStatus } from "h3";
import { getBffConfig, isOriginAllowed } from "~~/server/utils/bff/config";

const ALLOWED_METHODS = "GET,POST,PUT,PATCH,DELETE,OPTIONS";
const ALLOWED_HEADERS = "content-type,authorization,x-tenant-id,x-request-id";

/**
 * `/api/**` 的凭据型 CORS。
 *
 * 不使用 `routeRules: { '/api/**': { cors: true } }`：它下发
 * `Access-Control-Allow-Origin: *`，与 `credentials: "include"` 互斥
 * （见 NMCPS-ADR-0007）。
 */
export default defineEventHandler((event) => {
	if (!event.path.startsWith("/api/")) {
		return;
	}

	const origin = getHeader(event, "origin");

	if (origin) {
		const { allowedOrigins } = getBffConfig(event);

		if (!isOriginAllowed(origin, allowedOrigins)) {
			if (event.method === "OPTIONS") {
				setResponseStatus(event, 403);
				return "";
			}

			return;
		}

		setResponseHeaders(event, {
			"access-control-allow-origin": origin,
			"access-control-allow-credentials": "true",
			"access-control-allow-methods": ALLOWED_METHODS,
			"access-control-allow-headers": ALLOWED_HEADERS,
			"access-control-max-age": 600,
			vary: "origin"
		});
	}

	if (event.method === "OPTIONS") {
		setResponseStatus(event, 204);
		return "";
	}
});
