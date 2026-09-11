import PlusIcon from "@assets/icons/actions/add.svg";
// Assets
import RefreshIcon from "@assets/icons/actions/refresh.svg";
import ViewIcon from "@assets/icons/content/search.svg";
import SkinIcon from "@assets/icons/content/skin-icon.svg";
import CheckIcon from "@assets/icons/controls/check.svg";
import ChevronDownIcon from "@assets/icons/controls/chevron-down.svg";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { ResourceAvatar } from "@ui/avatar";
import { ImageViewer } from "@ui/image-viewer/image-viewer";
// UI Components
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@ui/select/select";
import { SkinView3d } from "@ui/skin-viewer";
import {
	Tabs,
	TabsContent,
	TabsIndicator,
	TabsList,
	TabsTrigger,
} from "@ui/tabs/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ui/tooltip/tooltip";
import {
	getActiveAccount,
	setActiveAccount as persistActiveAccount,
} from "@utils/auth";
import { onConfigUpdate } from "@utils/config-sync";
import { createNotification } from "@utils/notifications";
import {
	createEffect,
	createMemo,
	createSignal,
	For,
	onCleanup,
	onMount,
	Show,
	Suspense,
} from "solid-js";
import pageStyles from "../settings-page.module.css";
import styles from "./AccountTab.module.css";

interface Account {
	id: string;
	name: string;
	username?: string;
	display_name?: string | null;
	uuid: string;
	account_type: string;
	skin_url?: string;
	skin_variant?: string;
	cape_url?: string;
	skin_data?: string;
	cape_data?: string;
}

interface SkinSource {
	type: "default" | "history" | "local" | "profile";
	classic_texture?: string;
	slim_texture?: string;
	texture?: string;
	url?: string;
	pack_id?: string;
	pack_name?: string;
	/** Legacy alias of pack_name */
	category?: string;
}

interface SkinPackGroup {
	packId: string;
	packName: string;
	skins: Skin[];
	isDefaults: boolean;
}

interface Skin {
	texture_key: string;
	name?: string;
	source: SkinSource;
}

interface SkinHistory {
	id: number;
	account_uuid: string;
	texture_key: string;
	name: string;
	variant: string;
	image_data: string;
	source: string;
}

interface Cape {
	id: string;
	name: string;
	url: string;
}

interface CompleteSkinsResponse {
	current_skin_id: string | null;
	current_cape_profile_id: string | null;
	current_skin_base64: string | null;
	current_cape_base64: string | null;
	current_variant: "classic" | "slim";
	recent_history: SkinHistory[];
	default_skins: Skin[];
	capes: Array<{ id: string; state: string; url: string; alias: string }>;
}

const normalizeVariant = (value?: string | null): "classic" | "slim" => {
	return String(value || "classic").toLowerCase() === "slim"
		? "slim"
		: "classic";
};

const isGuestOrDemoAccountType = (accountType?: string | null): boolean => {
	const normalized = String(accountType || "").toLowerCase();
	return normalized === "guest" || normalized === "demo";
};

const normalizeSkinComparable = (value: string): string => {
	if (!value) return "";
	const trimmed = value.trim();
	if (trimmed.startsWith("data:")) {
		const commaIndex = trimmed.indexOf(",");
		return (commaIndex >= 0 ? trimmed.slice(commaIndex + 1) : trimmed).trim();
	}

	try {
		const parsed = new URL(trimmed);
		parsed.search = "";
		parsed.hash = "";
		return parsed.toString();
	} catch {
		return trimmed;
	}
};

const toTitleCase = (value: string): string => {
	return value
		.replace(/[_-]+/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.split(" ")
		.map((word) =>
			word ? word[0].toUpperCase() + word.slice(1).toLowerCase() : word,
		)
		.join(" ");
};

const formatTooltipName = (
	name: string | undefined,
	source: string | undefined,
): string => {
	if (!name) return "Skin";
	const normalizedSource = (source || "").toLowerCase();
	if (
		normalizedSource === "default" ||
		normalizedSource.startsWith("default:")
	) {
		return toTitleCase(name);
	}
	return name;
};

const SkinPortrait = (props: { src: string; variant?: string }) => {
	let canvasRef: HTMLCanvasElement | undefined;

	createEffect(() => {
		const src = props.src;
		const variant = props.variant?.toLowerCase() || "classic";
		if (!src || !canvasRef) return;

		const img = new Image();
		img.crossOrigin = "anonymous";
		img.src = src;

		img.onload = () => {
			if (!canvasRef) return;
			const ctx = canvasRef.getContext("2d");
			if (!ctx) return;

			const armW = variant === "slim" ? 3 : 4;
			const totalW = armW + 8 + armW;
			const totalH = 20; // 8 (head) + 12 (body/arms)

			canvasRef.width = totalW;
			canvasRef.height = totalH;
			ctx.clearRect(0, 0, totalW, totalH);
			ctx.imageSmoothingEnabled = false;

			// 1. Head (8,8) -> (armW, 0)
			ctx.drawImage(img, 8, 8, 8, 8, armW, 0, 8, 8);
			ctx.drawImage(img, 40, 8, 8, 8, armW, 0, 8, 8); // Hat layer

			// 2. Torso (20,20) -> (armW, 8)
			ctx.drawImage(img, 20, 20, 8, 12, armW, 8, 8, 12);
			ctx.drawImage(img, 20, 36, 8, 12, armW, 8, 8, 12); // Jacket layer

			// 3. Right Arm (Player's Right / Viewer's Left)
			// Source X: 44 (skips the side of the arm), Source Y: 20
			ctx.drawImage(img, 44, 20, armW, 12, 0, 8, armW, 12);
			ctx.drawImage(img, 44, 36, armW, 12, 0, 8, armW, 12); // Sleeve

			// 4. Left Arm (Player's Left / Viewer's Right)
			// Source X: 36, Source Y: 52 (skips top of arm)
			ctx.drawImage(img, 36, 52, armW, 12, armW + 8, 8, armW, 12);
			ctx.drawImage(img, 52, 52, armW, 12, armW + 8, 8, armW, 12); // Sleeve
		};
	}, [props.src, props.variant]);

	return (
		<div class={styles.skinPortrait}>
			<canvas
				ref={(el) => (canvasRef = el)}
				class={styles.skinPortraitCanvas}
			/>
		</div>
	);
};

export function AccountSettingsTab() {
	const [accounts, setAccounts] = createSignal<Account[]>([]);
	const [activeAccount, setActiveAccount] = createSignal<Account | null>(null);
	const [skins, setSkins] = createSignal<Skin[]>([]);
	const [skinHistory, setSkinHistory] = createSignal<SkinHistory[]>([]);
	const [capes, setCapes] = createSignal<Cape[]>([]);
	const [saving, setSaving] = createSignal(false);
	const [browseTab, setBrowseTab] = createSignal("yours");
	const [collapsedPacks, setCollapsedPacks] = createSignal<
		Record<string, boolean>
	>({});
	const [viewerSrc, setViewerSrc] = createSignal<string | null>(null);
	const [compactActionMode, setCompactActionMode] = createSignal(false);
	const [isNarrowLayout, setIsNarrowLayout] = createSignal(false);
	const [narrowView, setNarrowView] = createSignal<"browse" | "preview">(
		"browse",
	);

	const [savedSnapshot, setSavedSnapshot] = createSignal<{
		skinUrl: string;
		capeUrl: string | null;
		skinKey: string | null;
		capeId: string | null;
		variant: "classic" | "slim";
	} | null>(null);

	// Preview Signals
	const [previewSkinUrl, setPreviewSkinUrl] = createSignal<string>("");
	const [previewComputedKey, setPreviewComputedKey] = createSignal<
		string | null
	>(null);
	const [previewCapeId, setPreviewCapeId] = createSignal<string | null>(null);
	const [previewCapeUrl, setPreviewCapeUrl] = createSignal<string | null>("");
	const [previewVariant, setPreviewVariant] = createSignal<"classic" | "slim">(
		"classic",
	);

	const loadData = async () => {
		try {
			const accs = await invoke<Account[]>("get_accounts");
			setAccounts(accs);

			const active = (await getActiveAccount()) as any as Account;
			if (active) {
				setActiveAccount(active);

				if (!isGuestOrDemoAccountType(active.account_type)) {
					// Trigger a background sync on mount to ensure we have the latest from Mojang
					invoke("force_sync_account_profile", { accountUuid: active.uuid })
						.then(async () => {
							console.log(
								"[AccountSettings] Background sync on mount completed",
							);
							// Fetch the updated data from DB after the sync finishes
							const res = await invoke<CompleteSkinsResponse>(
								"get_complete_skin_data",
								{
									accountUuid: active.uuid,
								},
							);
							setSkins(res.default_skins);
							setSkinHistory(res.recent_history);
							setCapes(
								res.capes.map((c) => ({
									id: c.id,
									name: c.alias || "Cape",
									url: c.url,
								})),
							);
							const refreshedAccounts = await invoke<Account[]>("get_accounts");
							setAccounts(refreshedAccounts);
							const activeUuid = active.uuid.replace(/-/g, "");
							const refreshedActive =
								refreshedAccounts.find(
									(account) => account.uuid.replace(/-/g, "") === activeUuid,
								) || active;
							setActiveAccount(refreshedActive);

							// Only update preview/snapshot if user hasn't touched anything yet (still matches initial snapshot)
							const snapshot = savedSnapshot();
							if (
								!snapshot ||
								(normalizeSkinComparable(previewSkinUrl() || "") ===
									normalizeSkinComparable(snapshot.skinUrl) &&
									previewCapeId() === snapshot.capeId &&
									previewVariant() === snapshot.variant)
							) {
								setPreviewSkinUrl(
									res.current_skin_base64 || refreshedActive.skin_url || "",
								);
								setPreviewVariant(
									(res.current_variant as "classic" | "slim") || "classic",
								);
								setPreviewCapeUrl(
									res.current_cape_base64 || refreshedActive.cape_url || "",
								);
								setPreviewComputedKey(res.current_skin_id);
								setPreviewCapeId(res.current_cape_profile_id || null);

								setSavedSnapshot({
									skinUrl:
										res.current_skin_base64 || refreshedActive.skin_url || "",
									capeUrl:
										res.current_cape_base64 || refreshedActive.cape_url || null,
									skinKey: res.current_skin_id || null,
									capeId: res.current_cape_profile_id || null,
									variant:
										(res.current_variant as "classic" | "slim") || "classic",
								});
							}
						})
						.catch((err) =>
							console.error(
								"[AccountSettings] Background sync on mount failed:",
								err,
							),
						);

					const res = await invoke<CompleteSkinsResponse>(
						"get_complete_skin_data",
						{
							accountUuid: active.uuid,
						},
					);
					setSkins(res.default_skins);
					setSkinHistory(res.recent_history);
					setCapes(
						res.capes.map((c) => ({
							id: c.id,
							name: c.alias || "Cape",
							url: c.url,
						})),
					);

					setPreviewSkinUrl(res.current_skin_base64 || active.skin_url || "");
					setPreviewVariant(
						(res.current_variant as "classic" | "slim") || "classic",
					);
					setPreviewCapeUrl(res.current_cape_base64 || active.cape_url || "");
					setPreviewComputedKey(res.current_skin_id);
					setPreviewCapeId(res.current_cape_profile_id || null);

					setSavedSnapshot({
						skinUrl: res.current_skin_base64 || active.skin_url || "",
						capeUrl: res.current_cape_base64 || active.cape_url || null,
						skinKey: res.current_skin_id || null,
						capeId: res.current_cape_profile_id || null,
						variant: (res.current_variant as "classic" | "slim") || "classic",
					});
				} else {
					setPreviewSkinUrl(active.skin_url || "");
					setPreviewVariant(normalizeVariant(active.skin_variant));
					setPreviewCapeUrl(active.cape_url || "");
					setPreviewComputedKey(null);
					setPreviewCapeId(null);

					setSavedSnapshot({
						skinUrl: active.skin_url || "",
						capeUrl: active.cape_url || null,
						skinKey: null,
						capeId: null,
						variant: normalizeVariant(active.skin_variant),
					});
					setSkins(await invoke<Skin[]>("get_default_skins"));
					setCapes([]);
					setSkinHistory([]);
				}
			}
		} catch (err) {
			console.error("Failed to load account data:", err);
		}
	};

	onMount(loadData);

	const normalizeAccountUuid = (uuid?: string | null) =>
		(uuid || "").replace(/-/g, "").toLowerCase();

	onMount(() => {
		// Listen for external active account changes (e.g. from Sidebar)
		const unsubscribe = onConfigUpdate(async (field) => {
			if (field === "active_account_uuid") {
				const active = (await getActiveAccount()) as any as Account;
				if (
					normalizeAccountUuid(active?.uuid) !==
					normalizeAccountUuid(activeAccount()?.uuid)
				) {
					await loadData();
				}
			}
		});
		onCleanup(unsubscribe);
	});

	onMount(() => {
		const evaluateLayoutModes = () => {
			setCompactActionMode(window.innerHeight < 860);
			const narrow = window.innerWidth <= 1000;
			setIsNarrowLayout(narrow);
			if (!narrow) {
				setNarrowView("browse");
			}
		};

		evaluateLayoutModes();
		window.addEventListener("resize", evaluateLayoutModes);
		onCleanup(() => window.removeEventListener("resize", evaluateLayoutModes));
	});

	const isDirty = createMemo(() => {
		const active = activeAccount();
		const snapshot = savedSnapshot();
		if (!active || !snapshot) return false;

		// Compare against the canonical "saved" snapshot from the server/loadData,
		// NOT the initial active account object which might have stale URLs.
		const previewSkin = previewSkinUrl() || "";
		const previewVar = previewVariant();

		const previewSkinKey = previewComputedKey();
		const previewCapeSelectionId = previewCapeId();

		// 1. If we have texture keys, they are the strictly authoritative way to check for dirty state
		// because they represent the actual image bytes.
		if (snapshot.skinKey && previewSkinKey) {
			if (snapshot.skinKey !== previewSkinKey) return true;
		} else {
			// Fallback to URL normalization if keys aren't available for some reason
			if (
				normalizeSkinComparable(previewSkin) !==
				normalizeSkinComparable(snapshot.skinUrl || "")
			)
				return true;
		}

		if (snapshot.capeId !== previewCapeSelectionId) return true;

		return previewVar !== snapshot.variant;
	});

	const getSkinTexture = (
		skin: Skin | null,
		variant: "classic" | "slim",
	): string => {
		if (!skin) return "";
		const { source } = skin;
		if (!source) return "";

		if (source.type === "default") {
			return (
				(variant === "slim" ? source.slim_texture : source.classic_texture) ||
				source.classic_texture ||
				source.slim_texture ||
				""
			);
		}
		return source.texture || source.url || "";
	};

	const activeSkin = createMemo(() => {
		const previewKey = previewComputedKey();

		if (previewKey) {
			const presetByKey = skins().find(
				(skin) => skin.texture_key === previewKey,
			);
			if (presetByKey) return presetByKey;

			const historyByKey = skinHistory().find(
				(item) => item.texture_key === previewKey,
			);
			if (historyByKey) {
				return {
					texture_key: historyByKey.texture_key,
					name: historyByKey.name,
					source: {
						type: historyByKey.source || "custom",
						classic_texture: historyByKey.image_data,
						slim_texture: historyByKey.image_data,
					},
				} as any as Skin;
			}
		}

		const previewUrl = previewSkinUrl();
		if (!previewUrl) return null;

		const normalizedPreview = normalizeSkinComparable(previewUrl);
		const presetByUrl = skins().find((skin) => {
			const classicComparable = normalizeSkinComparable(
				getSkinTexture(skin, "classic"),
			);
			const slimComparable = normalizeSkinComparable(
				getSkinTexture(skin, "slim"),
			);
			return (
				classicComparable === normalizedPreview ||
				slimComparable === normalizedPreview
			);
		});
		if (presetByUrl) return presetByUrl;

		const historyByUrl = skinHistory().find(
			(item) => normalizeSkinComparable(item.image_data) === normalizedPreview,
		);
		if (!historyByUrl) return null;

		return {
			texture_key: historyByUrl.texture_key,
			name: historyByUrl.name,
			source: {
				type: historyByUrl.source || "custom",
				classic_texture: historyByUrl.image_data,
				slim_texture: historyByUrl.image_data,
			},
		} as any as Skin;
	});

	const isSkinSelected = (itemUrl: string, itemTextureKey: string) => {
		// 1. Check by ID/Hash (Best)
		const currentSkinId = previewComputedKey();
		if (currentSkinId && itemTextureKey && currentSkinId === itemTextureKey) {
			return true;
		}

		// 2. Check by exact URL/Base64 string (Fallback)
		const currentUrl = previewSkinUrl();
		if (currentUrl) {
			const comparableItem = normalizeSkinComparable(itemUrl);
			const comparableCurrent = normalizeSkinComparable(currentUrl);
			if (comparableItem === comparableCurrent) {
				return true;
			}
		}

		return false;
	};

	const PACK_ORDER: Record<string, number> = {
		defaults: 0,
		minecon_earth_2017: 10,
		builders_and_biomes: 20,
		striding_hero: 30,
		garden_awakens: 40,
		chase_the_skies: 50,
		copper_age: 60,
		mounts_of_mayhem: 70,
		tiny_takeover: 80,
		chaos_cubed: 90,
		dungeons_hero: 100,
		dungeons_ii_hero: 110,
		other_events: 1000,
	};

	const getPackId = (source: SkinSource): string => {
		return source.pack_id || source.pack_name || source.category || "other";
	};

	const getPackName = (source: SkinSource): string => {
		return (
			source.pack_name || source.category || toTitleCase(getPackId(source))
		);
	};

	const skinPackGroups = createMemo((): SkinPackGroup[] => {
		const groups = new Map<string, SkinPackGroup>();

		for (const skin of skins()) {
			if (skin.source?.type !== "default") continue;
			const packId = getPackId(skin.source);
			const packName = getPackName(skin.source);
			const existing = groups.get(packId);
			if (existing) {
				existing.skins.push(skin);
			} else {
				groups.set(packId, {
					packId,
					packName,
					skins: [skin],
					isDefaults: packId === "defaults",
				});
			}
		}

		return Array.from(groups.values()).sort((a, b) => {
			const orderA = PACK_ORDER[a.packId] ?? 500;
			const orderB = PACK_ORDER[b.packId] ?? 500;
			if (orderA !== orderB) return orderA - orderB;
			return a.packName.localeCompare(b.packName, undefined, {
				sensitivity: "base",
			});
		});
	});

	const filteredRecentHistory = createMemo(() => {
		const defaultTextureKeys = new Set(
			skins()
				.map((skin) => skin.texture_key)
				.filter(Boolean),
		);
		const seenHistoryTextureKeys = new Set<string>();
		let duplicateCount = 0;

		const filtered = skinHistory().filter((item) => {
			// Hide if it matches a preset (don't duplicate preset in Your skins)
			if (defaultTextureKeys.has(item.texture_key)) return false;

			if (seenHistoryTextureKeys.has(item.texture_key)) {
				duplicateCount += 1;
				return false;
			}

			seenHistoryTextureKeys.add(item.texture_key);

			const source = (item.source || "").toLowerCase();
			// Keep user-owned sources only; pack_id / pack_name history stays under Presets
			if (
				source &&
				source !== "mojang" &&
				source !== "history" &&
				source !== "custom" &&
				source !== "local" &&
				source !== "preset" &&
				source !== "uploaded" &&
				!source.startsWith("temp")
			) {
				return false;
			}

			return true;
		});

		if (duplicateCount > 0 && import.meta.env.DEV) {
			console.warn(
				`[AccountTab] Deduped ${duplicateCount} duplicate skin history entries by texture_key`,
			);
		}

		return filtered;
	});

	const handlePreviewSkin = (skin: Skin) => {
		const texture = getSkinTexture(skin, previewVariant());
		setPreviewSkinUrl(texture);
		setPreviewComputedKey(skin.texture_key || null);
	};

	const handlePreviewHistory = (item: SkinHistory) => {
		setPreviewSkinUrl(item.image_data);
		setPreviewVariant(normalizeVariant(item.variant));
		setPreviewComputedKey(item.texture_key);
	};

	const handleUploadSkin = async () => {
		try {
			const file = await open({
				multiple: false,
				filters: [
					{
						name: "Minecraft Skin",
						extensions: ["png", "jpeg", "jpg"],
					},
				],
			});

			if (file) {
				// file.path for v2.0.0-rc+, file for older versions.
				// Based on the error, "file" is already the path string.
				const filePath = typeof file === "string" ? file : (file as any).path;
				const fileData = await readFile(filePath);
				const base64 = btoa(
					new Uint8Array(fileData).reduce(
						(data, byte) => data + String.fromCharCode(byte),
						"",
					),
				);
				const dataUrl = `data:image/png;base64,${base64}`;
				setPreviewSkinUrl(dataUrl);

				// Auto-detect model type for initial preview only.
				// Save still uses whatever the frontend toggle is at save time.
				let detectedVariant: "classic" | "slim" = previewVariant();
				try {
					const detected = await invoke<string>("detect_base64_skin_variant", {
						base64Data: dataUrl,
					});
					detectedVariant = normalizeVariant(detected);
					setPreviewVariant(detectedVariant);
				} catch (e) {
					console.warn(
						"Could not auto-detect uploaded skin variant, keeping current selection",
						e,
					);
				}

				// Add to history preview immediately
				const active = activeAccount();
				if (active) {
					// Compute the authoritative texture_key for the uploaded bytes via backend
					let computedKey: string | null = null;
					try {
						computedKey = await invoke<string>(
							"compute_texture_key_from_base64",
							{
								base64Data: dataUrl,
							},
						);
						console.log("uploadSkin: computed texture_key for uploaded file", {
							computedKey,
						});
						setPreviewComputedKey(computedKey);
					} catch (e) {
						console.warn(
							"uploadSkin: failed to compute texture key for upload, falling back to temp key",
							e,
						);
					}

					const tempKey =
						computedKey ??
						(typeof crypto !== "undefined" && "randomUUID" in crypto
							? `temp-${crypto.randomUUID()}`
							: `temp-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`);
					const tempId = -Math.floor(Math.random() * 1_000_000_000);

					setSkinHistory((prev) => {
						const newEntry: SkinHistory = {
							id: tempId,
							account_uuid: active.uuid,
							texture_key: tempKey,
							name: "Uploaded Skin",
							variant: detectedVariant,
							image_data: dataUrl,
							source: "local",
						};
						// Add to start and dedup by texture_key (prefer authoritative key when available)
						const filtered = prev.filter(
							(h) => h.texture_key !== newEntry.texture_key,
						);
						return [newEntry, ...filtered];
					});
				}
			}
		} catch (err) {
			console.error("Failed to upload skin:", err);
			createNotification({
				title: "Upload Failed",
				description: "Could not read the selected file.",
				notification_type: "immediate",
			});
		}
	};

	const handlePreviewCape = (cape: Cape | null) => {
		if (!cape) {
			setPreviewCapeUrl(null);
			setPreviewCapeId(null);
			return;
		}

		setPreviewCapeUrl(cape.url);
		setPreviewCapeId(cape.id);
	};

	const handleSave = async () => {
		const active = activeAccount();
		if (!active || !isDirty()) return;

		setSaving(true);
		try {
			if (previewSkinUrl() !== (active.skin_url || "")) {
				const skin = activeSkin();
				const isBuiltinDefault = skin?.source?.type === "default";

				if (isBuiltinDefault && skin) {
					const source = skin.source;
					await invoke("apply_preset_skin", {
						accountUuid: active.uuid,
						textureUrl: previewSkinUrl(),
						variant: previewVariant(),
						category: source.pack_name || source.category || "Preset",
						name: skin.name || undefined,
						packId: source.pack_id || undefined,
					});
				} else if (previewSkinUrl().startsWith("data:")) {
					const accountName = getAccountDisplayName(active);
					await invoke("upload_account_skin", {
						accountUuid: active.uuid,
						name: `${accountName}_Custom`,
						variant: previewVariant(),
						base64Data: previewSkinUrl(),
					});
				} else {
					await invoke("apply_preset_skin", {
						accountUuid: active.uuid,
						textureUrl: previewSkinUrl(),
						variant: previewVariant(),
						category:
							skin?.source?.pack_name ||
							skin?.source?.category ||
							skin?.source?.type ||
							"Preset",
						name: skin?.name || undefined,
						packId: skin?.source?.pack_id || undefined,
					});
				}
			}

			const snapshot = savedSnapshot();
			if ((snapshot?.capeId || null) !== previewCapeId()) {
				if (!previewCapeId()) {
					await invoke("hide_account_cape", {
						accountUuid: active.uuid,
					});
				} else {
					await invoke("change_account_cape", {
						accountUuid: active.uuid,
						capeId: previewCapeId(),
					});
				}
			}

			const res = await invoke<CompleteSkinsResponse>(
				"get_complete_skin_data",
				{
					accountUuid: active.uuid,
				},
			);
			setSkins(res.default_skins);
			setSkinHistory(res.recent_history);
			setCapes(
				res.capes.map((c) => ({
					id: c.id,
					name: c.alias || "Cape",
					url: c.url,
				})),
			);

			setPreviewSkinUrl(res.current_skin_base64 || active.skin_url || "");
			setPreviewVariant(
				(res.current_variant as "classic" | "slim") || "classic",
			);
			setPreviewCapeUrl(res.current_cape_base64 || active.cape_url || "");
			setPreviewComputedKey(res.current_skin_id);
			setPreviewCapeId(res.current_cape_profile_id || null);

			setSavedSnapshot({
				skinUrl: res.current_skin_base64 || active.skin_url || "",
				capeUrl: res.current_cape_base64 || active.cape_url || null,
				skinKey: res.current_skin_id || null,
				capeId: res.current_cape_profile_id || null,
				variant: (res.current_variant as "classic" | "slim") || "classic",
			});

			const accs = await invoke<Account[]>("get_accounts");
			setAccounts(accs);
			const updatedAccount = accs.find((a) => a.uuid === active.uuid);
			if (updatedAccount) setActiveAccount(updatedAccount);

			createNotification({
				title: "Account Updated",
				description: "Your skin and cape changes have been saved successfully.",
				notification_type: "immediate",
			});
		} catch (err) {
			console.error("Save failed:", err);
			createNotification({
				title: "Update Failed",
				description: `Failed to save changes: ${err instanceof Error ? err.message : String(err)}`,
				notification_type: "alert",
			});
		} finally {
			setSaving(false);
		}
	};

	const selectAccount = async (acc: Account) => {
		if (
			normalizeAccountUuid(acc.uuid) ===
			normalizeAccountUuid(activeAccount()?.uuid)
		) {
			return;
		}
		setActiveAccount(acc);
		await persistActiveAccount(acc.uuid);
		await loadData();
	};

	const getAccountDisplayName = (account?: Account | null) => {
		if (!account) return "Select account";
		return (
			account.display_name || account.username || account.name || "Account"
		);
	};

	const renderAccountSwitcher = (triggerClass?: string) => (
		<Select<Account>
			options={accounts()}
			value={activeAccount()}
			onChange={(account) => {
				if (account && account.uuid !== activeAccount()?.uuid) {
					selectAccount(account);
				}
			}}
			optionValue="uuid"
			optionTextValue="uuid"
			itemComponent={(props) => (
				<SelectItem item={props.item} class={styles.accountSelectItem}>
					<Suspense
						fallback={
							<div class={styles.accountSelectOption}>
								<div class={styles.accountSelectAvatarFallback} />
								<div class={styles.accountSelectText}>
									<span class={styles.accountSelectName}>
										{getAccountDisplayName(props.item.rawValue)}
									</span>
								</div>
							</div>
						}
					>
						<div class={styles.accountSelectOption}>
							<ResourceAvatar
								name={getAccountDisplayName(props.item.rawValue)}
								playerUuid={props.item.rawValue.uuid}
								size={20}
								shape="square"
							/>
							<div class={styles.accountSelectText}>
								<span class={styles.accountSelectName}>
									{getAccountDisplayName(props.item.rawValue)}
								</span>
							</div>
						</div>
					</Suspense>
				</SelectItem>
			)}
		>
			<SelectTrigger class={triggerClass}>
				<SelectValue<Account>>
					{(state) => {
						const selected = state.selectedOption();
						const selectedName = getAccountDisplayName(
							selected || activeAccount(),
						);
						return (
							<div class={styles.accountSelectValue}>
								<ResourceAvatar
									name={selectedName}
									playerUuid={selected?.uuid || activeAccount()?.uuid}
									size={20}
									shape="square"
								/>
								<div class={styles.accountSelectText}>
									<span class={styles.accountSelectName}>{selectedName}</span>
								</div>
							</div>
						);
					}}
				</SelectValue>
			</SelectTrigger>
			<SelectContent />
		</Select>
	);

	const revertChanges = () => {
		const snapshot = savedSnapshot();
		if (!snapshot) return;

		setPreviewSkinUrl(snapshot.skinUrl || "");
		setPreviewCapeUrl(snapshot.capeUrl || null);
		setPreviewVariant(snapshot.variant);

		setPreviewComputedKey(snapshot.skinKey);
		setPreviewCapeId(snapshot.capeId);
	};

	const renderSkinTile = (skin: Skin) => {
		const classicTexture = getSkinTexture(skin, "classic");
		const preferredTexture =
			getSkinTexture(skin, previewVariant()) || classicTexture;

		const isSelected = createMemo(() => {
			return isSkinSelected(preferredTexture, skin.texture_key);
		});

		return (
			<Tooltip placement="top">
				<TooltipTrigger as="div">
					<div
						class={styles.skinItem}
						classList={{
							[styles.selected]: isSelected(),
						}}
						onClick={() => handlePreviewSkin(skin)}
					>
						<SkinPortrait src={preferredTexture} variant={previewVariant()} />
						<Tooltip>
							<TooltipTrigger
								as="button"
								class={styles.viewRawButton}
								onClick={(e) => {
									e.stopPropagation();
									setViewerSrc(preferredTexture);
								}}
								aria-label="View raw texture"
							>
								<ViewIcon width="16" />
							</TooltipTrigger>
							<TooltipContent>View raw texture</TooltipContent>
						</Tooltip>
						<Show when={isSelected()}>
							<span class={styles.selectedBadge}>
								<CheckIcon />
							</span>
						</Show>
					</div>
				</TooltipTrigger>
				<TooltipContent>
					{formatTooltipName(skin.name || "Default Skin", skin.source?.type)}
				</TooltipContent>
			</Tooltip>
		);
	};

	const isPackCollapsed = (packId: string) => !!collapsedPacks()[packId];

	const togglePackCollapsed = (packId: string) => {
		setCollapsedPacks((prev) => ({
			...prev,
			[packId]: !prev[packId],
		}));
	};

	const renderPackSection = (pack: SkinPackGroup) => {
		const collapsed = () => isPackCollapsed(pack.packId);

		return (
			<Show when={pack.skins.length > 0}>
				<section
					class={`${styles.contentCard} ${styles.packSection}`}
					classList={{
						[styles.packSectionDefaults]: pack.isDefaults,
						[styles.packSectionCollapsed]: collapsed(),
					}}
				>
					<button
						type="button"
						class={styles.packHeader}
						onClick={() => togglePackCollapsed(pack.packId)}
						aria-expanded={!collapsed()}
					>
						<div class={styles.packHeaderText}>
							<h2 class={styles.packTitle}>{pack.packName}</h2>
							<span class={styles.packMeta}>
								{pack.skins.length} {pack.skins.length === 1 ? "skin" : "skins"}
							</span>
						</div>
						<span
							class={styles.packChevron}
							classList={{ [styles.packChevronCollapsed]: collapsed() }}
							aria-hidden="true"
						>
							<ChevronDownIcon width="16" height="16" />
						</span>
					</button>
					<Show when={!collapsed()}>
						<div class={styles.presetsGrid}>
							<For each={pack.skins}>{(skin) => renderSkinTile(skin)}</For>
						</div>
					</Show>
				</section>
			</Show>
		);
	};

	return (
		<div
			class={`${pageStyles["settings-tab-content"]} ${pageStyles["settings-tab-content--wide"]} ${pageStyles["settings-tab-content--fill"]}`}
		>
			<div class={styles.container}>
				<Show
					when={Boolean(activeAccount())}
					fallback={<div class={styles.noAccount}>No account connected</div>}
				>
					<>
						<Show when={isNarrowLayout()}>
							<div class={styles.viewToolbar}>
								<Show
									when={!isDirty()}
									fallback={
										<div class={styles.toolbarActions}>
											<button
												type="button"
												class={styles.toolbarRevertButton}
												disabled={saving()}
												onClick={revertChanges}
											>
												Revert
											</button>
											<button
												type="button"
												class={styles.toolbarSaveButton}
												disabled={saving()}
												onClick={handleSave}
											>
												<Show when={saving()}>
													<RefreshIcon width="14" class="spin" />
												</Show>
												{saving() ? "Syncing..." : "Apply"}
											</button>
										</div>
									}
								>
									<div class={styles.toolbarAccountSwitcher}>
										{renderAccountSwitcher(styles.toolbarAccountSelect)}
									</div>
								</Show>

								<div class={styles.narrowViewToggle}>
									<Tooltip>
										<TooltipTrigger
											as="button"
											type="button"
											class={styles.narrowViewIcon}
											classList={{
												[styles.active]: narrowView() === "browse",
											}}
											onClick={() => setNarrowView("browse")}
											aria-label="Browse skins"
										>
											<ViewIcon width="16" height="16" />
										</TooltipTrigger>
										<TooltipContent>Browse skins</TooltipContent>
									</Tooltip>

									<Tooltip>
										<TooltipTrigger
											as="button"
											type="button"
											class={styles.narrowViewIcon}
											classList={{
												[styles.active]: narrowView() === "preview",
											}}
											onClick={() => setNarrowView("preview")}
											aria-label="Preview"
										>
											<SkinIcon width="16" height="16" />
										</TooltipTrigger>
										<TooltipContent>Preview</TooltipContent>
									</Tooltip>

									<Tooltip>
										<TooltipTrigger
											as="button"
											type="button"
											class={`${styles.narrowViewIcon} ${styles.narrowUploadIcon}`}
											onClick={handleUploadSkin}
											aria-label="Upload custom skin"
										>
											<PlusIcon width="16" height="16" />
										</TooltipTrigger>
										<TooltipContent>Upload custom skin</TooltipContent>
									</Tooltip>
								</div>
							</div>
						</Show>

						<div
							class={styles.leftSection}
							classList={{
								[styles.hiddenOnNarrow]:
									isNarrowLayout() && narrowView() !== "browse",
							}}
						>
							<Tabs
								value={browseTab()}
								onChange={setBrowseTab}
								class={styles.browseTabs}
							>
								<div class={styles.browseTabsHeader}>
									<TabsList class={styles.browseTabsList}>
										<TabsIndicator />
										<TabsTrigger class={styles.browseTabsTrigger} value="yours">
											Your skins
										</TabsTrigger>
										<TabsTrigger
											class={styles.browseTabsTrigger}
											value="presets"
										>
											Presets
										</TabsTrigger>
										<TabsTrigger class={styles.browseTabsTrigger} value="capes">
											Capes
										</TabsTrigger>
									</TabsList>
								</div>

								<TabsContent value="yours" class={styles.browseTabsContent}>
									<section class={styles.contentCard}>
										<div class={styles.cardHeader}>
											<h2 class={styles.cardTitle}>Your skins</h2>
											<button
												type="button"
												class={styles.headerUploadButton}
												onClick={handleUploadSkin}
											>
												<PlusIcon width="14" height="14" />
												<span>Add skin</span>
											</button>
										</div>

										<Show
											when={filteredRecentHistory().length > 0}
											fallback={
												<div class={styles.emptyState}>
													<p class={styles.emptyStateTitle}>
														No custom skins yet
													</p>
													<p class={styles.emptyStateBody}>
														Upload a PNG to start building your skin history.
														Preset characters live under Presets.
													</p>
												</div>
											}
										>
											<div class={styles.presetsGrid}>
												<For each={filteredRecentHistory()}>
													{(item) => {
														const selected = createMemo(() =>
															isSkinSelected(item.image_data, item.texture_key),
														);
														return (
															<Tooltip>
																<TooltipTrigger as="div">
																	<div
																		class={styles.skinItem}
																		classList={{
																			[styles.selected]: selected(),
																		}}
																		onClick={() => handlePreviewHistory(item)}
																	>
																		<SkinPortrait
																			src={item.image_data}
																			variant={item.variant}
																		/>
																		<Tooltip placement="top">
																			<TooltipTrigger
																				as="button"
																				class={styles.viewRawButton}
																				onClick={(e) => {
																					e.stopPropagation();
																					setViewerSrc(item.image_data);
																				}}
																				aria-label="View raw texture"
																			>
																				<ViewIcon width="16" />
																			</TooltipTrigger>
																			<TooltipContent>
																				View raw texture
																			</TooltipContent>
																		</Tooltip>
																		<Show when={selected()}>
																			<span class={styles.selectedBadge}>
																				<CheckIcon />
																			</span>
																		</Show>
																	</div>
																</TooltipTrigger>
																<TooltipContent>
																	{`${formatTooltipName(item.name, item.source)} (${item.variant})`}
																</TooltipContent>
															</Tooltip>
														);
													}}
												</For>
											</div>
										</Show>
									</section>
								</TabsContent>

								<TabsContent
									value="presets"
									class={`${styles.browseTabsContent} ${styles.presetsBrowse}`}
								>
									<For each={skinPackGroups()}>
										{(pack) => renderPackSection(pack)}
									</For>
								</TabsContent>

								<TabsContent value="capes" class={styles.browseTabsContent}>
									<section class={styles.contentCard}>
										<div class={styles.cardHeader}>
											<h2 class={styles.cardTitle}>Capes</h2>
										</div>
										<div class={styles.capesGrid}>
											<button
												class={styles.capeItem}
												classList={{
													[styles.selected]: !previewCapeId(),
												}}
												onClick={() => handlePreviewCape(null)}
											>
												<span class={styles.noneLabel}>NONE</span>
												<Show when={!previewCapeId()}>
													<span class={styles.selectedBadge}>
														<CheckIcon />
													</span>
												</Show>
											</button>
											<For each={capes()}>
												{(cape) => {
													const isSelected = createMemo(
														() => previewCapeId() === cape.id,
													);

													return (
														<Tooltip>
															<TooltipTrigger
																as="button"
																class={styles.capeItem}
																style={{
																	"background-image": `url(${cape.url})`,
																}}
																classList={{
																	[styles.selected]: isSelected(),
																}}
																onClick={() => handlePreviewCape(cape)}
																aria-label={cape.name}
															>
																<Show when={isSelected()}>
																	<span class={styles.selectedBadge}>
																		<CheckIcon />
																	</span>
																</Show>
															</TooltipTrigger>
															<TooltipContent>{cape.name}</TooltipContent>
														</Tooltip>
													);
												}}
											</For>
										</div>
									</section>
								</TabsContent>
							</Tabs>
						</div>

						<aside
							class={styles.visualizerSidebar}
							classList={{
								[styles.hiddenOnNarrow]:
									isNarrowLayout() && narrowView() !== "preview",
							}}
						>
							<Show when={isDirty() && !isNarrowLayout()}>
								<section
									class={styles.actionCard}
									classList={{
										[styles.compactActionCard]: compactActionMode(),
									}}
								>
									<div class={styles.actionButtonsRow}>
										<button
											type="button"
											class={styles.revertButton}
											disabled={saving()}
											onClick={revertChanges}
										>
											Revert
										</button>
										<button
											type="button"
											class={styles.saveButton}
											disabled={saving()}
											onClick={handleSave}
										>
											<Show when={saving()}>
												<RefreshIcon width="18" class="spin" />
											</Show>
											{saving() ? "Syncing..." : "Apply Changes"}
										</button>
									</div>
								</section>
							</Show>

							<Show when={!isDirty() && !isNarrowLayout()}>
								<section>
									{renderAccountSwitcher(styles.accountSwitcherSelect)}
								</section>
							</Show>

							<section class={styles.visualizerCard}>
								<Show when={!isNarrowLayout()}>
									<Tooltip>
										<TooltipTrigger
											as="button"
											type="button"
											class={`${styles.uploadSkinButton} ${styles.floatingUploadButton}`}
											onClick={handleUploadSkin}
											aria-label="Upload custom skin"
										>
											<PlusIcon width="18" />
										</TooltipTrigger>
										<TooltipContent>Upload custom skin</TooltipContent>
									</Tooltip>
								</Show>

								<div class={styles.visualizerWrapper}>
									<SkinView3d
										skinUrl={previewSkinUrl() || undefined}
										capeUrl={previewCapeUrl() || ""}
										model={previewVariant()}
										animation="walking"
										animationSpeed={0.5}
										enableZoom={false}
									/>
								</div>

								<div class={styles.modelToggle}>
									<button
										type="button"
										class={styles.toggleBtn}
										classList={{
											[styles.active]: previewVariant() === "classic",
										}}
										onClick={() => {
											setPreviewVariant("classic");
											const skin = activeSkin();
											if (
												skin &&
												skin.source?.type === "default" &&
												skin.source.classic_texture &&
												skin.source.slim_texture
											) {
												setPreviewSkinUrl(getSkinTexture(skin, "classic"));
											}
										}}
									>
										Classic
									</button>
									<button
										type="button"
										class={styles.toggleBtn}
										classList={{
											[styles.active]: previewVariant() === "slim",
										}}
										onClick={() => {
											setPreviewVariant("slim");
											const skin = activeSkin();
											if (
												skin &&
												skin.source?.type === "default" &&
												skin.source.classic_texture &&
												skin.source.slim_texture
											) {
												setPreviewSkinUrl(getSkinTexture(skin, "slim"));
											}
										}}
									>
										Slim
									</button>
								</div>
							</section>
						</aside>
					</>
				</Show>
				<ImageViewer
					src={viewerSrc()}
					onClose={() => setViewerSrc(null)}
					title="Skin Texture Preview"
					scale={4}
					pixelated={true}
				/>
			</div>
		</div>
	);
}
