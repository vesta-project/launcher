/**
 * Authentication utilities for Microsoft OAuth and Minecraft login
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

export const ACCOUNT_TYPE_GUEST = "Guest";
export const GUEST_UUID = "00000000000000000000000000000000";

export interface Account {
	id: number;
	uuid: string;
	username: string;
	display_name: string | null;
	access_token: string | null;
	refresh_token: string | null;
	token_expires_at: string | null;
	is_active: boolean;
	skin_url: string | null;
	cape_url: string | null;
	created_at: string | null;
	updated_at: string | null;
	account_type: string;
}

export type AuthStage =
	| { stage: "Start" }
	| { stage: "AuthCode"; code: string; url: string; expires_in: number }
	| { stage: "Polling" }
	| { stage: "Complete"; user_uuid: string; user_username: string }
	| { stage: "Cancelled" }
	| { stage: "Error"; message: string };

/**
 * Start Microsoft OAuth device-code login flow
 */
export async function startLogin(): Promise<void> {
	await invoke("start_login");
}

/**
 * Cancel ongoing authentication
 */
export async function cancelLogin(): Promise<void> {
	await invoke("cancel_login");
}

/**
 * Get all accounts from database
 */
export async function getAccounts(): Promise<Account[]> {
	return await invoke("get_accounts");
}

/**
 * Get the currently active account
 */
export async function getActiveAccount(): Promise<Account | null> {
	return await invoke("get_active_account");
}

/**
 * Set active account by UUID
 */
export async function setActiveAccount(uuid: string): Promise<void> {
	await invoke("set_active_account", { targetUuid: uuid });
}

/**
 * Remove account by UUID
 */
export async function removeAccount(uuid: string): Promise<void> {
	await invoke("remove_account", { targetUuid: uuid });
}

/**
 * Listen for authentication events
 */
export async function listenToAuthEvents(
	callback: (event: AuthStage) => void,
): Promise<UnlistenFn> {
	return await listen<AuthStage>("vesta://auth", (event) => {
		callback(event.payload);
	});
}
