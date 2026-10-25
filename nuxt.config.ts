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
		"./layers/user"
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
