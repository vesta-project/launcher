import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ResourceAvatar } from "@ui/avatar";
import Button from "@ui/button/button";
import { Dialog, DialogContent } from "@ui/dialog/dialog";
import {
	ACCOUNT_TYPE_GUEST,
	type Account,
	getAccounts,
	removeAccount,
	setActiveAccount,
} from "@utils/auth";
import { onConfigUpdate } from "@utils/config-sync";
import {
	createEffect,
	createResource,
	createSignal,
	For,
	onCleanup,
	Show,
} from "solid-js";
import styles from "./account-list.module.css";

interface AccountListProps {
	open: boolean;
	onClose: () => void;
	onAddAccount: () => void;
}

function AccountList(props: AccountListProps) {
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

	const [avatarTimestamp, setAvatarTimestamp] = createSignal(Date.now());

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

	// Listen for head updates from backend
	createEffect(() => {
		let unlisten: (() => void) | undefined;
		listen("core://account-heads-updated", () => {
			setAvatarTimestamp(Date.now());
		}).then((fn) => {
			unlisten = fn;
		});

		onCleanup(() => unlisten?.());
	});

	const getAvatarUrl = async (uuid: string): Promise<string | null> => {
		try {
			const path = await invoke<string>("get_player_head_path", {
				playerUuid: uuid,
				forceDownload: false,
			});
			return `${convertFileSrc(path)}?t=${avatarTimestamp()}`;
		} catch {
			return null;
		}
	};

	const handleSwitchAccount = async (account: Account) => {
		try {
			if (account.is_expired) {
				const { authStore } = await import("@stores/auth");
				authStore.setExpiredAccount(account);
				props.onClose();
				return;
			}

			console.log("[AccountList] Switching to account:", account.uuid);
			await setActiveAccount(account.uuid);

			// Give the backend a moment to emit events and the UI to react
			// before we close the modal
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
				// No accounts left, close all windows and navigate to setup page
				props.onClose();
				await invoke("close_all_windows_and_reset");
			} else if (isActive) {
				// Removed active account, switch to the first available account
				await handleSwitchAccount(remainingAccounts[0]);
			} else {
				// Removed a non-active account, just refetch
				await refetchAccounts();
			}
		} catch (e) {
			console.error("Failed to remove account:", e);
		}
	};

	return (
		<Dialog
			open={props.open}
			onOpenChange={(open) => {
				if (!open) props.onClose();
			}}
		>
			<DialogContent class={styles["account-list-menu"]}>
				<h3>Accounts</h3>
				<div class={styles["account-list-items"]}>
					<For each={accounts()}>
						{(account) => (
							<AccountListItem
								account={account}
								isActive={account.uuid === activeAccount()?.uuid}
								onSwitch={() => handleSwitchAccount(account)}
								onRemove={() => handleRemoveAccount(account.uuid)}
								getAvatarUrl={getAvatarUrl}
								avatarTimestamp={avatarTimestamp()}
							/>
						)}
					</For>
				</div>
				<Button
					class={styles["add-account-button"]}
					onClick={props.onAddAccount}
					variant="solid"
				>
					Add Account
				</Button>
			</DialogContent>
		</Dialog>
	);
}

interface AccountListItemProps {
	account: Account;
	isActive: boolean;
	onSwitch: () => void;
	onRemove: () => void;
	getAvatarUrl: (uuid: string) => Promise<string | null>;
	avatarTimestamp: number;
}

function AccountListItem(props: AccountListItemProps) {
	const handleClick = (e: MouseEvent) => {
		// Don't switch if clicking the remove button
		if (
			(e.target as HTMLElement).closest(`.${styles["account-remove-button"]}`)
		) {
			return;
		}
		// If it's not active OR if it's expired, allow "switching" (which triggers the dialog)
		if (!props.isActive || props.account.is_expired) {
			props.onSwitch();
		}
	};
	return (
		<div
			class={styles["account-list-item"]}
			classList={{ [styles["account-list-item--active"]]: props.isActive }}
			onClick={handleClick}
		>
			<ResourceAvatar
				name={props.account.username}
				playerUuid={props.account.uuid}
				size={36}
				shape="circle"
				class={styles["account-avatar"]}
			/>
			<div class={styles["account-info"]}>
				<div class={styles["account-username"]}>{props.account.username}</div>
				<div style={{ display: "flex", gap: "4px" }}>
					<Show when={props.isActive}>
						<div class={styles["account-active-badge"]}>Active</div>
					</Show>
					<Show when={props.account.is_expired}>
						<div class={styles["account-expired-badge"]}>Expired</div>
					</Show>
					<Show when={props.account.account_type === ACCOUNT_TYPE_GUEST}>
						<div
							class={styles["account-active-badge"]}
							style={{ background: "var(--primary)", color: "white" }}
						>
							Guest
						</div>
					</Show>
				</div>
			</div>
			<Show when={props.account.account_type !== ACCOUNT_TYPE_GUEST}>
				<Button
					class={styles["account-remove-button"]}
					onClick={(e) => {
						e.stopPropagation();
						props.onRemove();
					}}
					variant="ghost"
					size="sm"
					icon_only
					title="Remove Account"
				>
					×
				</Button>
			</Show>
		</div>
	);
}

export { AccountList };
