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
			// 上游就绪探针路径（拼在 upstreamBase 之后）与超时，供 GET /ready 使用
			readinessPath: "/health",
			readinessTimeoutMs: 2000
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
