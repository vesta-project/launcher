import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import Button from "@ui/button/button";
import { Dialog, DialogContent } from "@ui/dialog/dialog";
import {
	type Account,
	getAccounts,
	removeAccount,
	setActiveAccount,
} from "@utils/auth";
import { createResource, For, Show } from "solid-js";
import "./account-list.css";

interface AccountListProps {
	open: boolean;
	onClose: () => void;
	onAddAccount: () => void;
}

function AccountList(props: AccountListProps) {
	const [accounts, { refetch }] = createResource<Account[]>(getAccounts);
	const [activeAccount] = createResource(async () => {
		try {
			return await invoke<Account | null>("get_active_account");
		} catch {
			return null;
		}
	});

	const getAvatarUrl = async (uuid: string): Promise<string | null> => {
		try {
			const path = await invoke<string>("get_player_head_path", {
				uuid,
				forceDownload: false,
			});
			return convertFileSrc(path);
		} catch {
			return null;
		}
	};

	const handleSwitchAccount = async (uuid: string) => {
		try {
			await setActiveAccount(uuid);
			await refetch();
			props.onClose();
			// Reload page to apply changes
			window.location.reload();
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
				await setActiveAccount(remainingAccounts[0].uuid);
				await refetch();
				props.onClose();
				window.location.reload();
			} else {
				// Removed a non-active account, just refetch
				await refetch();
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
			<DialogContent class={"account-list-menu"}>
				<h3>Accounts</h3>
				<div class="account-list-items">
					<For each={accounts()}>
						{(account) => (
							<AccountListItem
								account={account}
								isActive={account.uuid === activeAccount()?.uuid}
								onSwitch={() => handleSwitchAccount(account.uuid)}
								onRemove={() => handleRemoveAccount(account.uuid)}
								getAvatarUrl={getAvatarUrl}
							/>
						)}
					</For>
				</div>
				<Button
					class="add-account-button"
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
}

function AccountListItem(props: AccountListItemProps) {
	const [avatarUrl] = createResource(
		() => props.account.uuid,
		props.getAvatarUrl,
	);
	const handleClick = () => {
		if (!props.isActive) {
			props.onSwitch();
		}
	};
	return (
		<div
			class="account-list-item"
			classList={{ "account-list-item--active": props.isActive }}
			onClick={handleClick}
			onPointerDown={(e) => {
				if ((e.target as HTMLElement).closest(".account-remove-button")) {
					e.stopPropagation();
				}
			}}
		>
			<div
				class="account-avatar"
				style={{
					"background-image": avatarUrl()
						? `url(${avatarUrl()})`
						: "linear-gradient(to bottom, hsl(0deg 0% 50%), hsl(0deg 0% 30%))",
					"background-size": "cover",
					"background-position": "center",
				}}
			/>
			<div class="account-info">
				<div class="account-username">{props.account.username}</div>
				<Show when={props.isActive}>
					<div class="account-active-badge">Active</div>
				</Show>
			</div>
			<Button
				class="account-remove-button"
				onClick={() => props.onRemove()}
				variant="ghost"
				size="sm"
				icon_only
			>
				×
			</Button>
		</div>
	);
}

export { AccountList };
