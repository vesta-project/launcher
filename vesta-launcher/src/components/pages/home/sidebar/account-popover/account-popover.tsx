import ClipboardIcon from "@assets/clipboard.svg";
import { router } from "@components/page-viewer/page-viewer";
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { ResourceAvatar } from "@ui/avatar";
import Button from "@ui/button/button";
import { PopoverContent } from "@ui/popover/popover";
import {
	ACCOUNT_TYPE_GUEST,
	type Account,
	getAccounts,
	removeAccount,
	setActiveAccount,
} from "@utils/auth";
import { onConfigUpdate } from "@utils/config-sync";
import { createNotification } from "@utils/notifications";
import {
	createEffect,
	createResource,
	createSignal,
	For,
	onCleanup,
	Show,
} from "solid-js";
import styles from "./account-popover.module.css";

interface AccountPopoverProps {
	onClose: () => void;
	onAddAccount: () => void;
}

export function AccountPopover(props: AccountPopoverProps) {
	const [accounts, { refetch: refetchAccounts }] =
		createResource<Account[]>(getAccounts);
	const [activeAccount, { refetch: refetchActive }] = createResource(
		async () => {
			try {
				return await invoke<Account | null>("get_active_account");
			} catch {
				return null;
			}
		},
	);

	// Listen for config updates to refetch active account
	createEffect(() => {
		const unsubscribe = onConfigUpdate((field) => {
			if (field === "active_account_uuid") {
				refetchActive();
				refetchAccounts();
			}
		});
		onCleanup(unsubscribe);
	});

	const handleSwitchAccount = async (account: Account) => {
		try {
			if (account.is_expired) {
				const { authStore } = await import("@stores/auth");
				authStore.setExpiredAccount(account);
				props.onClose();
				return;
			}

			await setActiveAccount(account.uuid);
			setTimeout(() => {
				props.onClose();
			}, 100);
		} catch (e) {
			console.error("Failed to switch account:", e);
		}
	};

	const handleRemoveAccount = async (uuid: string) => {
		try {
			const isActive = uuid === activeAccount()?.uuid;
			await removeAccount(uuid);
			const remainingAccounts = await getAccounts();

			if (remainingAccounts.length === 0) {
				props.onClose();
				await invoke("close_all_windows_and_reset");
			} else if (isActive) {
				await handleSwitchAccount(remainingAccounts[0]);
			} else {
				await refetchAccounts();
			}
		} catch (e) {
			console.error("Failed to remove account:", e);
		}
	};

	const copyUuid = async () => {
		const uuid = activeAccount()?.uuid;
		if (uuid) {
			await writeText(uuid);
			createNotification({
				title: "Copied UUID",
				description: "Account UUID copied to clipboard",
				notification_type: "immediate",
			});
		}
	};

	const openSettings = () => {
		props.onClose();
		router().navigate("/config", { activeTab: "account" });
	};

	return (
		<PopoverContent class={styles["account-popover"]}>
			<Show when={activeAccount()}>
				{(account) => (
					<div class={styles["active-account-section"]}>
						<ResourceAvatar
							name={account().username}
							playerUuid={account().uuid}
							size={48}
							shape="square"
							class={styles["active-avatar"]}
						/>
						<div class={styles["active-info"]}>
							<div class={styles["active-username"]}>{account().username}</div>
							<div
								class={styles["active-uuid-container"]}
								onClick={copyUuid}
								title="Click to copy UUID"
							>
								<ClipboardIcon class={styles["clipboard-icon"]} />
								<span class={styles["active-uuid"]}>{account().uuid}</span>
							</div>
						</div>
					</div>
				)}
			</Show>

			<div class={styles["actions-section"]}>
				<Button
					variant="outline"
					size="sm"
					onClick={openSettings}
					class={styles["action-btn"]}
				>
					Edit Skin
				</Button>
				<Show when={activeAccount()?.account_type !== ACCOUNT_TYPE_GUEST}>
					<Button
						variant="outline"
						size="sm"
						onClick={() => {
							const account = activeAccount();
							if (account) handleRemoveAccount(account.uuid);
						}}
						class={styles["action-btn"]}
					>
						Logout
					</Button>
				</Show>
			</div>

			<div class={styles["divider"]} />

			<div class={styles["other-accounts-section"]}>
				<div class={styles["section-title"]}>Other Accounts</div>
				<div class={styles["account-list"]}>
					<For
						each={accounts()?.filter((a) => a.uuid !== activeAccount()?.uuid)}
					>
						{(account) => (
							<div
								class={styles["account-item"]}
								onClick={() => handleSwitchAccount(account)}
							>
								<ResourceAvatar
									name={account.username}
									playerUuid={account.uuid}
									size={24}
									shape="square"
								/>
								<div class={styles["account-item-name"]}>
									{account.username}
								</div>
								<Show when={account.is_expired}>
									<div class={styles["expired-badge"]}>Expired</div>
								</Show>
							</div>
						)}
					</For>
				</div>
				<Button
					class={styles["add-account-btn"]}
					onClick={props.onAddAccount}
					variant="ghost"
					size="sm"
				>
					+ Add Account
				</Button>
			</div>
		</PopoverContent>
	);
}
