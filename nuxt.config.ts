export default defineNuxtConfig({
	modules: [
		"@nuxt/eslint",
		"@nuxt/ui",
		"@vueuse/nuxt",
		"nuxt-svgo",
		"@nuxtjs/i18n",
		"@nuxt/content"
	],
	extends: [
		"./layers/device",
		"./layers/scenario",
		"./layers/spectrum",
		"./layers/dashboard",
		"./layers/topology",
		"./layers/transmission",
		"./layers/content",
		"./layers/system",
		"./layers/user",
		"./layers/platform"
	],
	ssr: false,
	ignore: ["**/src-tauri/**"],
	// 根路径没有页面（见 NMCPS-ADR-0016）：冷启动直接 302 到登录页；
	// 站内跳回 `/` 由 app/middleware/auth.global.ts 按登录态分流。
	routeRules: {
		"/": { redirect: "/auth/login" }
	},
	i18n: {
		defaultLocale: "cn",
		detectBrowserLanguage: false,
		strategy: "no_prefix",
		locales: [
			{ code: "en", name: "English", iso: "en-US", file: "en.json" },
			{ code: "cn", name: "简体中文", iso: "zh-CN", file: "cn.json" }
		],
		experimental: {
			typedOptionsAndMessages: "default"
		}
	},
	runtimeConfig: {
		// BFF（Nitro）运行时配置：全部可由 NUXT_BFF_* 环境变量覆盖
		bff: {
			// 上游 REST 基址，server-only；示例 http://192.168.1.81:8888/api/v1
			upstreamBase: "",
			timeoutMs: 15000,
			// 允许携带凭据跨域的 Origin 白名单（桌面 WebView 为 tauri:// 协议）
			allowedOrigins: "http://localhost:3000,http://127.0.0.1:3000,tauri://localhost,http://tauri.localhost,https://tauri.localhost",
			// 会话 token cookie 名：访问令牌（proxy.ts 读它转 Bearer）+ 刷新令牌（仅 /api/auth 可见）
			tokenCookieName: "nmcps_at",
			refreshCookieName: "nmcps_rt",
			// 令牌有效期兜底（毫秒）：访问令牌优先用上游 expiresIn，刷新令牌上游不返回 TTL
			accessTtlMs: 1800000,
			refreshTtlMs: 604800000,
			// 仿真网络签名会话（NMCPS-ADR-0021）：密钥至少 32 字节，空串＝实验通道失败关闭
			sessionCookieName: "nmcps_sess",
			sessionSecret: "",
			// 轮换窗口内用于验证旧 cookie；只验证不签发
			sessionSecretPrevious: "",
			sessionTtlMs: 604800000,
			// 上游就绪探针路径（拼在 upstreamBase 之后）与超时，供 GET /ready 使用
			readinessPath: "/health",
			readinessTimeoutMs: 2000
		},
		// 仿真平台（第二出站通道，NMCPS-ADR-0019 裁决 B / NMCPS-ARCH-002 §六）：
		// baseUrl 为空＝通道未启用（不是错误，`/api/sim/**` 回 503 simulator_not_configured）；
		// allowWrite 默认 false —— 写端点一律 405，页面以只读态呈现。
		simulator: {
			baseUrl: "",
			allowWrite: false,
			timeoutMs: 15000,
			readinessPath: "/api/health"
		},
		// Mininet 实验后端（第三出站通道，NMCPS-ADR-0020）：
		// baseUrl 为空＝通道未启用（`/api/lab/**` 回 503 mininet_not_configured）；
		// 白名单只有 GET，写操作 / 终端 / 抓包在后续决策前不开放。
		mininet: {
			baseUrl: "",
			// 租户 → 实例注册表（JSON 字符串）：{"t_a":{"baseUrl":"http://127.0.0.1:8000"}}
			// 配了注册表后，租户请求只查这里；未命中即 503 tenant_runtime_unavailable，绝不回退全局 baseUrl。
			instances: "",
			timeoutMs: 15000
		},
		// 仿真网络台账（NMCPS-ADR-0021 P2）：BFF 自有的资源归属记录。
		// 文件不存在时读 seed；文件存在即只信文件，避免“删了又被 seed 复活”。
		lab: {
			ledgerFile: ".data/lab-ledger.json",
			ledgerSeed: "",
			// 写操作审计 outbox（NMCPS-ADR-0022 D4）；按天分片写 JSONL
			auditFile: ".data/audit/lab-audit.jsonl"
		},
		public: {
			// 前端访问 BFF 的基址：web 同源留空；桌面构建必须指向已部署的 BFF
			bffBase: ""
		}
	},
	app: {
		head: {
			title: "nmcps",
			charset: "utf-8",
			viewport: "width=device-width, initial-scale=1",
			meta: [
				{ name: "format-detection", content: "no" },
				{ name: "viewport", content: "width=device-width, initial-scale=1, maximum-scale=1" }
			]
		}
	},
	css: ["@/assets/css/main.css"],
	svgo: {
		autoImportPath: "@/assets/"
	},
	imports: {
		presets: [
			{
				from: "zod",
				imports: [
					"z",
					{
						name: "infer",
						as: "zInfer",
						type: true
					}
				]
			}
		]
	},
	eslint: {
		config: {
			standalone: false
		}
	},
	icon: {
		clientBundle: {
			scan: {
				globInclude: ["**/*.{vue,ts}"],
				// 排除 legacy 参考代码（_reference）与生成产物，避免其 lucide 图标被打进客户端 bundle
				globExclude: ["node_modules", "dist", "build", "coverage", "test", "tests", ".*", "_reference"]
			}
		}
	},
	router: {
		options: {
			scrollBehaviorType: "smooth"
		}
	},
	experimental: {
		typedPages: true
	},
	vite: {
		clearScreen: false,
		envPrefix: ["VITE_", "TAURI_"],
		optimizeDeps: {
			include: ["zod"]
		},
		server: {
			strictPort: true
		}
	},
	vue: {
		optionsApi: false
	},
	typescript: {
		nodeTsConfig: {
			include: ["../scripts/**/*"]
		}
	},
	// Makes the dev server reachable from physical iOS devices
	devServer: {
		host: "0"
	},
	sourcemap: {
		client: false,
		server: false
	},
	devtools: {
		enabled: false
	},
	telemetry: false,
	compatibilityDate: "2026-10-01"
});
