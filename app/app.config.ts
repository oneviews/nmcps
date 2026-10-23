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
				files: [
					{ label: ".exe (x64)", file: "nmcps_1.7.0_x64-setup.exe" },
					{ label: ".msi (x64)", file: "nmcps_1.7.0_x64_en-US.msi" },
					{ label: ".exe (arm64)", file: "nmcps_1.7.0_arm64-setup.exe" },
					{ label: ".msi (arm64)", file: "nmcps_1.7.0_arm64_en-US.msi" }
				]
			},
			macos: {
				label: "macOS",
				icon: "lucide:apple",
				files: [
					{ label: ".dmg (Universal)", file: "nmcps_1.7.0_universal.dmg" }
				]
			},
			linux: {
				label: "Linux",
				icon: "lucide:terminal",
				files: [
					{ label: ".deb (x64)", file: "nmcps_1.7.0_amd64.deb" },
					{ label: ".rpm (x64)", file: "nmcps-1.7.0-1.x86_64.rpm" },
					{ label: ".deb (arm64)", file: "nmcps_1.7.0_arm64.deb" },
					{ label: ".rpm (arm64)", file: "nmcps-1.7.0-1.aarch64.rpm" }
				]
			},
			android: {
				label: "Android",
				icon: "lucide:smartphone",
				files: [
					{ label: ".apk (Universal)", file: "nmcps_1.7.0_universal.apk" },
					{ label: ".aab (Universal)", file: "nmcps_1.7.0_universal.aab" }
				]
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
