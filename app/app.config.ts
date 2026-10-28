import { NEUTRAL_COLORS, PRIMARY_COLORS } from "~~/layers/user/app/composables/colorPalette";

export default defineAppConfig({
	app: {
		name: "nmcps",
		version: "2.0.0",
		author: "Nicola Spadari",
		repo: "https://github.com/NicolaSpadari/nmcps",
		tauriSite: "https://tauri.app",
		nuxtSite: "https://nuxt.com",
		nuxtUiSite: "https://ui4.nuxt.dev"
	},
	pageCategories: {
		system: {
			label: "nav.categories.system",
			icon: "carbon:terminal"
		},
		storage: {
			label: "nav.categories.storage",
			icon: "carbon:archive"
		},
		interface: {
			label: "nav.categories.interface",
			icon: "carbon:application"
		},
		other: {
			label: "nav.categories.other",
			icon: "carbon:folder"
		}
	},
	downloads: {
		version: "2.0.0",
		basePath: "https://github.com/oneviews/nmcps/releases/download/nmcps-v2.0.0",
		assets: {
			windows: {
				label: "Windows",
				icon: "carbon:screen",
				files: [
					{ label: ".exe (x64)", file: "nmcps_2.0.0_x64-setup.exe" },
					{ label: ".msi (x64)", file: "nmcps_2.0.0_x64_en-US.msi" },
					{ label: ".exe (arm64)", file: "nmcps_2.0.0_arm64-setup.exe" },
					{ label: ".msi (arm64)", file: "nmcps_2.0.0_arm64_en-US.msi" }
				]
			},
			macos: {
				label: "macOS",
				icon: "carbon:apple",
				files: [
					{ label: ".dmg (Universal)", file: "nmcps_2.0.0_universal.dmg" }
				]
			},
			linux: {
				label: "Linux",
				icon: "carbon:terminal",
				files: [
					{ label: ".deb (x64)", file: "nmcps_2.0.0_amd64.deb" },
					{ label: ".rpm (x64)", file: "nmcps-2.0.0-1.x86_64.rpm" },
					{ label: ".AppImage (x64)", file: "nmcps_2.0.0_amd64.AppImage" },
					{ label: ".deb (arm64)", file: "nmcps_2.0.0_arm64.deb" },
					{ label: ".rpm (arm64)", file: "nmcps-2.0.0-1.aarch64.rpm" },
					{ label: ".AppImage (arm64)", file: "nmcps_2.0.0_aarch64.AppImage" }
				]
			},
			android: {
				label: "Android",
				icon: "carbon:mobile",
				files: [
					{ label: ".apk (Universal)", file: "nmcps_2.0.0_universal.apk" },
					{ label: ".aab (Universal)", file: "nmcps_2.0.0_universal.aab" }
				]
			}
		}
	},
	ui: {
		colors: {
			primary: "sky",
			warning: "amber",
			neutral: "slate",
			// 主题色 / 中性色候选：单一事实源见 layers/user/app/composables/colorPalette.ts
			...Object.fromEntries([...PRIMARY_COLORS, ...NEUTRAL_COLORS].map((color) => [color, color] as const))
		},
		icons: {
			arrowDown: "carbon:arrow-down",
			arrowLeft: "carbon:arrow-left",
			arrowRight: "carbon:arrow-right",
			arrowUp: "carbon:arrow-up",
			caution: "carbon:warning",
			check: "carbon:checkmark",
			chevronDoubleLeft: "carbon:double-chevron-left",
			chevronDoubleRight: "carbon:double-chevron-right",
			chevronDown: "carbon:chevron-down",
			chevronLeft: "carbon:chevron-left",
			chevronRight: "carbon:chevron-right",
			chevronUp: "carbon:chevron-up",
			close: "carbon:close",
			copy: "carbon:copy",
			copyCheck: "carbon:copy",
			dark: "carbon:moon",
			drag: "carbon:draggable",
			ellipsis: "carbon:overflow-menu-horizontal",
			error: "carbon:error",
			external: "carbon:arrow-up-right",
			eye: "carbon:view",
			eyeOff: "carbon:view-off",
			file: "carbon:document-blank",
			folder: "carbon:folder",
			folderOpen: "carbon:folder-open",
			hash: "carbon:hashtag",
			info: "carbon:information",
			light: "carbon:sun",
			loading: "carbon:renew",
			menu: "carbon:menu",
			minus: "carbon:subtract",
			panelClose: "carbon:side-panel-close",
			panelOpen: "carbon:side-panel-open",
			plus: "carbon:add",
			reload: "carbon:rotate-360",
			search: "carbon:search",
			stop: "carbon:square-outline",
			star: "carbon:star",
			success: "carbon:checkmark-outline",
			system: "carbon:laptop",
			tip: "carbon:idea",
			upload: "carbon:cloud-upload",
			warning: "carbon:warning"
		},
		button: {
			slots: {
				base: "cursor-pointer"
			}
		},
		card: {
			slots: {
				root: "backdrop-blur-sm"
			},
			defaultVariants: {
				variant: "subtle"
			}
		},
		formField: {
			slots: {
				root: "w-full"
			}
		},
		input: {
			slots: {
				root: "w-full"
			}
		},
		textarea: {
			slots: {
				root: "w-full",
				base: "resize-none"
			}
		},
		accordion: {
			slots: {
				trigger: "cursor-pointer",
				item: "md:py-2"
			}
		},
		navigationMenu: {
			slots: {
				link: "cursor-pointer"
			}
		}
	}
});
