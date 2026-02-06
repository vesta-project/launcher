import { Component, Show } from "solid-js";
import { Dialog, DialogContent } from "@ui/dialog/dialog";
import Button from "@ui/button/button";
import { authStore } from "@stores/auth";
import styles from "./session-expired-dialog.module.css";
import { removeAccount } from "@utils/auth";
import { useNavigate } from "@solidjs/router";
import { invoke } from "@tauri-apps/api/core";

const SessionExpiredDialog: Component = () => {
	const { expiredAccount, setExpiredAccount } = authStore;
	const navigate = useNavigate();

	const handleRelogin = () => {
		const account = expiredAccount();
		if (!account) return;

		setExpiredAccount(null);
		// Navigate to init with force login for existing account
		navigate("/?login=true", { replace: true });
	};

	const handleRemove = async () => {
		const account = expiredAccount();
		if (!account) return;

		try {
			await removeAccount(account.uuid);
			setExpiredAccount(null);

			const remaining = (await invoke<any[]>("get_accounts")).length;
			if (remaining === 0) {
				await invoke("close_all_windows_and_reset");
			}
		} catch (e) {
			console.error("Failed to remove expired account:", e);
		}
	};

	const handleSwitch = () => {
		// Just clear the dialog; the user can use the sidebar to switch
		// Or we could trigger the account switcher here
		setExpiredAccount(null);
	};

	return (
		<Dialog
			open={!!expiredAccount()}
			onOpenChange={(open) => {
				// Don't allow closing without an action if it's the active account
				if (!open) setExpiredAccount(null);
			}}
		>
			<DialogContent
				class={styles["session-expired-dialog"]}
			>
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
						<span class={styles.username}>{expiredAccount()?.username}</span> has
						expired or been revoked by Microsoft.
					</p>
				</div>

				<div class={styles.actions}>
					<div class={styles["primary-actions"]}>
						<Button onClick={handleRelogin} variant="solid" color="primary">
							Login Again
						</Button>
						<Button onClick={handleSwitch} variant="outline">
							Switch Account
						</Button>
					</div>
					<Button
						onClick={handleRemove}
						variant="ghost"
						color="destructive"
						class={styles["full-width"]}
					>
						Remove Account
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
};

export default SessionExpiredDialog;
