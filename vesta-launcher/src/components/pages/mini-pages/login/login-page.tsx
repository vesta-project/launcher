import { router } from "@components/page-viewer/page-viewer";
import LauncherButton from "@ui/button/button";
import { cancelLogin, listenToAuthEvents, startLogin } from "@utils/auth";
import { openExternal } from "@utils/external-link";
import { createSignal, onCleanup, onMount, Show } from "solid-js";
import styles from "./login-page.module.css";
import { t } from "~/localization";

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
				setErrorMessage(t("auth-authentication-cancelled"));
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
			await startLogin();
		} catch (error) {
			setErrorMessage(t("auth-login-start-failed", { error: String(error) }));
		}
	};

	const handleCancel = async () => {
		try {
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
			await openExternal(authUrl());
		} catch (error) {
			console.error("Failed to open URL:", error);
		}
	};

	return (
		<div class={styles["login-page"]}>
			<div class={styles["login-page__content"]}>
				<h1 class={styles["login-page__title"]}>{t("auth-sign-in-to-microsoft")}</h1>

				<Show when={!isAuthenticating()}>
					<p class={styles["login-page__description"]}>
						{t("auth-sign-in-to-minecraft-description")}
					</p>
					<Show when={errorMessage()}>
						<p class={styles["login-page__error"]}>{errorMessage()}</p>
					</Show>
					<LauncherButton
						onClick={handleLogin}
						class={styles["login-page__button"]}
					>
						{t("auth-sign-in-with-microsoft")}
					</LauncherButton>
				</Show>

				<Show when={isAuthenticating()}>
					<div class={styles["login-page__auth-box"]}>
						<p class={styles["login-page__auth-instruction"]}>
							{t("auth-copy-code-instruction")}
						</p>
						<div class={styles["login-page__code-container"]}>
							<code class={styles["login-page__code"]}>{authCode()}</code>
							<LauncherButton
								onClick={copyCode}
								class={styles["login-page__copy-button"]}
							>
								{copied() ? t("auth-copied") : t("shared-ui-copy")}
							</LauncherButton>
						</div>
						<div class={styles["login-page__button-group"]}>
							<LauncherButton
								onClick={openUrl}
								class={styles["login-page__button"]}
							>
								{t("auth-open-sign-in-page")}
							</LauncherButton>
							<LauncherButton
								onClick={handleCancel}
								class={`${styles["login-page__button"]} ${styles["login-page__button--secondary"]}`}
							>
								{t("shared-ui-cancel")}
							</LauncherButton>
						</div>
					</div>
				</Show>
			</div>
		</div>
	);
}

export default LoginPage;
