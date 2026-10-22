export default defineAppConfig({
	app: {
		name: "nmcps",
		author: "Nicola Spadari",
		repo: "https://github.com/NicolaSpadari/nmcps",
		tauriSite: "https://tauri.app",
		nuxtSite: "https://nuxt.com",
		nuxtUiSite: "https://ui4.nuxt.dev"
	},
	pageCategories: {
		system: {
			label: "System",
			icon: "lucide:square-terminal"
		},
		storage: {
			label: "Storage",
			icon: "lucide:archive"
		},
		interface: {
			label: "Interface",
			icon: "lucide:app-window-mac"
		},
		other: {
			label: "Other",
			icon: "lucide:folder"
		}
	},
	downloads: {
		version: "1.7.0",
		basePath: "/downloads",
		assets: {
			windows: {
				label: "Windows",
				icon: "lucide:monitor",
				file: "nmcps_1.7.0_x64-setup.exe"
			},
			macos: {
				label: "macOS",
				icon: "lucide:apple",
				file: "nmcps_1.7.0_universal.dmg"
			},
			linux: {
				label: "Linux",
				icon: "lucide:terminal",
				file: "nmcps_1.7.0_amd64.deb"
			},
			android: {
				label: "Android",
				icon: "lucide:smartphone",
				file: "nmcps_1.7.0.apk"
			}
		}
	},
	ui: {
		colors: {
			primary: "green",
			neutral: "zinc"
		},
		button: {
			slots: {
				base: "cursor-pointer"
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
