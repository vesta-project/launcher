import { router } from "@components/page-viewer/page-viewer";
import { open } from "@tauri-apps/plugin-shell";
import LauncherButton from "@ui/button/button";
import { createSignal, onCleanup, onMount, Show } from "solid-js";
import styles from "./login-page.module.css";

interface LoginPageProps {
	onClose?: () => void;
}

function LoginPage(_props: LoginPageProps) {
	const [authCode, setAuthCode] = createSignal<string>("");
	const [authUrl, setAuthUrl] = createSignal<string>("");
	const [isAuthenticating, setIsAuthenticating] = createSignal(false);
	const [errorMessage, setErrorMessage] = createSignal<string>("");
	const [copied, setCopied] = createSignal(false);

	let unlistenAuth: (() => void) | null = null;

	onMount(async () => {
		const { listenToAuthEvents } = await import("@utils/auth");
		unlistenAuth = await listenToAuthEvents((event) => {
			if (event.stage === "AuthCode") {
				setAuthCode(event.code);
				setAuthUrl(event.url);
				setIsAuthenticating(true);
			} else if (event.stage === "Complete") {
				setIsAuthenticating(false);
				// Close the login page and reload to show the new account
				window.location.reload();
			} else if (event.stage === "Cancelled") {
				setIsAuthenticating(false);
				setErrorMessage("Authentication cancelled");
			} else if (event.stage === "Error") {
				setIsAuthenticating(false);
				setErrorMessage(event.message);
			}
		});
	});

	onCleanup(() => {
		unlistenAuth?.();
	});

	const handleLogin = async () => {
		try {
			setErrorMessage("");
			const { startLogin } = await import("@utils/auth");
			await startLogin();
		} catch (error) {
			setErrorMessage(`Failed to start login: ${error}`);
		}
	};

	const handleCancel = async () => {
		try {
			const { cancelLogin } = await import("@utils/auth");
			await cancelLogin();
			setIsAuthenticating(false);
		} catch (error) {
			console.error("Failed to cancel login:", error);
		}
	};

	const copyCode = async () => {
		try {
			await navigator.clipboard.writeText(authCode());
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch (error) {
			console.error("Failed to copy code:", error);
		}
	};

	const openUrl = async () => {
		try {
			await open(authUrl());
		} catch (error) {
			console.error("Failed to open URL:", error);
		}
	};

	return (
		<div class={styles["login-page"]}>
			<div class={styles["login-page__content"]}>
				<h1 class={styles["login-page__title"]}>Sign in to Microsoft</h1>

				<Show when={!isAuthenticating()}>
					<p class={styles["login-page__description"]}>
						Sign in with your Microsoft account to access Minecraft
					</p>
					<Show when={errorMessage()}>
						<p class={styles["login-page__error"]}>{errorMessage()}</p>
					</Show>
					<LauncherButton onClick={handleLogin} class={styles["login-page__button"]}>
						Sign in with Microsoft
					</LauncherButton>
				</Show>

				<Show when={isAuthenticating()}>
					<div class={styles["login-page__auth-box"]}>
						<p class={styles["login-page__auth-instruction"]}>
							Copy this code and sign in with your Microsoft account:
						</p>
						<div class={styles["login-page__code-container"]}>
							<code class={styles["login-page__code"]}>{authCode()}</code>
							<LauncherButton
								onClick={copyCode}
								class={styles["login-page__copy-button"]}
							>
								{copied() ? "Copied!" : "Copy"}
							</LauncherButton>
						</div>
						<div class={styles["login-page__button-group"]}>
							<LauncherButton onClick={openUrl} class={styles["login-page__button"]}>
								Open Sign-in Page
							</LauncherButton>
							<LauncherButton
								onClick={handleCancel}
								class={`${styles["login-page__button"]} ${styles["login-page__button--secondary"]}`}
							>
								Cancel
							</LauncherButton>
						</div>
					</div>
				</Show>
			</div>
		</div>
	);
}

export default LoginPage;
