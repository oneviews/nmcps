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
		version: "1.7.1",
		basePath: "https://github.com/oneviews/nmcps/releases/download/nmcps-v1.7.1",
		assets: {
			windows: {
				label: "Windows",
				icon: "carbon:screen",
				files: [
					{ label: ".exe (x64)", file: "nmcps_1.7.1_x64-setup.exe" },
					{ label: ".msi (x64)", file: "nmcps_1.7.1_x64_en-US.msi" },
					{ label: ".exe (arm64)", file: "nmcps_1.7.1_arm64-setup.exe" },
					{ label: ".msi (arm64)", file: "nmcps_1.7.1_arm64_en-US.msi" }
				]
			},
			macos: {
				label: "macOS",
				icon: "carbon:apple",
				files: [
					{ label: ".dmg (Universal)", file: "nmcps_1.7.1_universal.dmg" }
				]
			},
			linux: {
				label: "Linux",
				icon: "carbon:terminal",
				files: [
					{ label: ".deb (x64)", file: "nmcps_1.7.1_amd64.deb" },
					{ label: ".rpm (x64)", file: "nmcps-1.7.1-1.x86_64.rpm" },
					{ label: ".AppImage (x64)", file: "nmcps_1.7.1_amd64.AppImage" },
					{ label: ".deb (arm64)", file: "nmcps_1.7.1_arm64.deb" },
					{ label: ".rpm (arm64)", file: "nmcps-1.7.1-1.aarch64.rpm" },
					{ label: ".AppImage (arm64)", file: "nmcps_1.7.1_aarch64.AppImage" }
				]
			},
			android: {
				label: "Android",
				icon: "carbon:mobile",
				files: [
					{ label: ".apk (Universal)", file: "nmcps_1.7.1_universal.apk" },
					{ label: ".aab (Universal)", file: "nmcps_1.7.1_universal.aab" }
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
