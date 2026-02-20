import { useNavigate } from "@solidjs/router";
import { authStore } from "@stores/auth";
import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { ResourceAvatar } from "@ui/avatar";
import Button from "@ui/button/button";
import { Dialog, DialogContent } from "@ui/dialog/dialog";
import {
	type Account,
	getAccounts,
	removeAccount,
	setActiveAccount,
} from "@utils/auth";
import { Component, createResource, createSignal, For, Show } from "solid-js";
import styles from "./session-expired-dialog.module.css";

const SessionExpiredDialog: Component = () => {
	const { expiredAccount, setExpiredAccount } = authStore;
	const navigate = useNavigate();
	const [view, setView] = createSignal<"expired" | "switch">("expired");

	const [accounts, { refetch: refetchAccounts }] =
		createResource<Account[]>(getAccounts);

	const isNonClosable = () => {
		const acc = expiredAccount();
		return acc?.is_active ?? false;
	};

	const handleRelogin = () => {
		const account = expiredAccount();
		if (!account) return;

		setExpiredAccount(null);
		// Navigate to init with force login for existing account
		navigate("/?login=true", { replace: true });
	};

	const handleAddAccount = () => {
		// Just navigate to login flow without clearing current account
		setExpiredAccount(null);
		navigate("/?login=true", { replace: true });
	};

	const handleRemove = async () => {
		const account = expiredAccount();
		if (!account) return;

		const confirmed = await ask(
			`Are you sure you want to remove the account "${account.username}"? You will need to sign in again to use this account later.`,
			{
				title: "Remove Account",
				kind: "warning",
				okLabel: "Remove Account",
				cancelLabel: "Cancel",
			},
		);

		if (!confirmed) return;

		try {
			const uuid = account.uuid;
			const isActive = account.is_active;

			await removeAccount(uuid);
			setExpiredAccount(null);
			setView("expired");

			const remaining = await getAccounts();
			if (remaining.length === 0) {
				await invoke("close_all_windows_and_reset");
			} else if (isActive) {
				// If we deleted the active account, switch to another one
				await setActiveAccount(remaining[0].uuid);
				refetchAccounts();
			} else {
				refetchAccounts();
			}
		} catch (e) {
			console.error("Failed to remove expired account:", e);
		}
	};

	const handleSwitchAccount = async (account: Account) => {
		if (account.is_expired) {
			setExpiredAccount(account);
			setView("expired");
			return;
		}

		try {
			await setActiveAccount(account.uuid);
			setExpiredAccount(null);
			setView("expired");
		} catch (e) {
			console.error("Failed to switch account:", e);
		}
	};

	return (
		<Dialog
			open={!!expiredAccount()}
			onOpenChange={(open) => {
				if (!open && !isNonClosable()) {
					setExpiredAccount(null);
					setView("expired");
				}
			}}
		>
			<DialogContent
				class={styles["session-expired-dialog"]}
				hideCloseButton={isNonClosable()}
				onPointerDownOutside={(e) => {
					if (isNonClosable()) e.preventDefault();
				}}
				onEscapeKeyDown={(e) => {
					if (isNonClosable()) e.preventDefault();
				}}
			>
				<Show when={view() === "expired"}>
					<div class={styles["icon-wrapper"]}>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2.5"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
							<line x1="12" y1="9" x2="12" y2="13" />
							<line x1="12" y1="17" x2="12.01" y2="17" />
						</svg>
					</div>

					<div class={styles.content}>
						<h2>Session Expired</h2>
						<p>
							Your security token for{" "}
							<span class={styles.username}>{expiredAccount()?.username}</span>{" "}
							has expired or been revoked by Microsoft.
						</p>
					</div>

					<div class={styles.actions}>
						<div
							class={styles["primary-actions"]}
							classList={{ [styles.single]: (accounts()?.length ?? 0) <= 1 }}
						>
							<Button onClick={handleRelogin} variant="solid" color="primary">
								Sign In
							</Button>
							<Show when={(accounts()?.length ?? 0) > 1}>
								<Button onClick={() => setView("switch")} variant="outline">
									Switch Account
								</Button>
							</Show>
						</div>
						<Button
							onClick={handleRemove}
							variant="ghost"
							color="destructive"
							class={styles["full-width"]}
						>
							Delete Account
						</Button>
					</div>
				</Show>

				<Show when={view() === "switch"}>
					<div class={styles.header}>
						<Button
							variant="ghost"
							size="sm"
							onClick={() => setView("expired")}
							style={{ position: "absolute", left: "16px", top: "16px" }}
						>
							← Back
						</Button>
						<h2>Switch Account</h2>
					</div>
					<div class={styles["account-list"]}>
						<For each={accounts()}>
							{(account) => (
								<button
									class={styles["account-item"]}
									onClick={() => handleSwitchAccount(account)}
									disabled={account.uuid === expiredAccount()?.uuid}
								>
									<ResourceAvatar
										playerUuid={account.uuid}
										name={account.username}
										size={32}
									/>
									<div class={styles["account-info"]}>
										<span class={styles["account-name"]}>
											{account.username}
										</span>
										<Show when={account.is_expired}>
											<span class={styles["account-status-expired"]}>
												Expired
											</span>
										</Show>
									</div>
									<Show when={account.uuid === expiredAccount()?.uuid}>
										<span class={styles["active-indicator"]}>Active</span>
									</Show>
								</button>
							)}
						</For>
					</div>
				</Show>
			</DialogContent>
		</Dialog>
	);
};

export default SessionExpiredDialog;
