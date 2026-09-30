import networkStore from "@stores/network";
import { invoke } from "@tauri-apps/api/core";
import Button from "@ui/button/button";
import {
	type AuthStage,
	cancelLogin,
	getActiveAccount,
	listenToAuthEvents,
	startLogin,
} from "@utils/auth";
import { openExternal as openUrl } from "@utils/external-link";
import { createSignal, onCleanup, onMount, Show } from "solid-js";
import styles from "../init.module.css";
import { t } from "~/localization";

interface AuthStepProps {
	goNext: () => Promise<void>;
	goBack: () => Promise<void>;
	isLoginOnly: boolean;
	exitLoginOnlyMode: () => void;
	navigate: (to: string, options?: { replace?: boolean }) => void;
}

function AuthStep(props: AuthStepProps) {
	const [authCode, setAuthCode] = createSignal("");
	const [authUrl, setAuthUrl] = createSignal("");
	const [timeLeft, setTimeLeft] = createSignal(0);
	const [isAuthenticating, setIsAuthenticating] = createSignal(false);
	const [isStartingAuth, setIsStartingAuth] = createSignal(false);
	const [errorMessage, setErrorMessage] = createSignal("");
	const [copied, setCopied] = createSignal(false);
	const [hasAccount, setHasAccount] = createSignal(false);

	let unlistenAuth: (() => void) | null = null;
	let timer: ReturnType<typeof setInterval> | null = null;

	onMount(async () => {
		const acc = await getActiveAccount();
		setHasAccount(!!acc);

		unlistenAuth = await listenToAuthEvents((event) => {
			if (event.stage === "AuthCode") {
				setAuthCode(event.code);
				setAuthUrl(event.url);
				setIsAuthenticating(true);
				setIsStartingAuth(false);
				setTimeLeft(event.expires_in);

				if (timer) clearInterval(timer);
				timer = setInterval(() => {
					setTimeLeft((t) => {
						const next = Math.max(0, t - 1);
						if (next === 0 && timer) {
							clearInterval(timer);
							timer = null;
						}
						return next;
					});
				}, 1000);
			} else if (event.stage === "Complete") {
				setIsAuthenticating(false);
				setIsStartingAuth(false);
				if (timer) clearInterval(timer);

				if (props.isLoginOnly) {
					void (async () => {
						try {
							const config = await invoke<any>("get_config");
							if (!config?.setup_completed) {
								props.exitLoginOnlyMode();
								await props.goNext();
								return;
							}
						} catch {
							props.exitLoginOnlyMode();
							await props.goNext();
							return;
						}
						props.navigate("/home", { replace: true });
					})();
				} else {
					void props.goNext();
				}
			} else if (event.stage === "Cancelled") {
				setIsAuthenticating(false);
				setIsStartingAuth(false);
				setErrorMessage(t("auth-authentication-cancelled"));
				if (timer) clearInterval(timer);
			} else if (event.stage === "Error") {
				setIsAuthenticating(false);
				setIsStartingAuth(false);
				setErrorMessage(event.message);
				if (timer) clearInterval(timer);
			}
		});
	});

	onCleanup(() => {
		unlistenAuth?.();
		if (timer) clearInterval(timer);
	});

	const handleLogin = async () => {
		try {
			setErrorMessage("");
			setIsStartingAuth(true);
			await startLogin();
		} catch (error) {
			setIsStartingAuth(false);
			setErrorMessage(t("auth-login-start-failed", { error: String(error) }));
		}
	};

	const handleGuestMode = async () => {
		try {
			setErrorMessage("");
			if (props.isLoginOnly && hasAccount()) {
				props.navigate("/home", { replace: true });
				return;
			}
			await invoke("start_guest_session");
			props.navigate("/home", { replace: true });
		} catch (error) {
			setErrorMessage(t("auth-guest-session-start-failed", { error: String(error) }));
		}
	};

	const handleCancel = () => {
		// Immediate UI feedback — do not wait for the backend
		setIsAuthenticating(false);
		setIsStartingAuth(false);
		if (timer) {
			clearInterval(timer);
			timer = null;
		}
		// Fire cancel in the background; we don't need to wait for it
		void cancelLogin().catch((error) => {
			console.error("Failed to cancel login:", error);
		});
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

	const openAuthUrl = () => {
		void openUrl(authUrl());
	};

	const timerDisplay = () => {
		const secondsRemaining = timeLeft();
		if (secondsRemaining <= 0) return t("auth-expired");
		const m = Math.floor(secondsRemaining / 60);
		const s = (secondsRemaining % 60).toString().padStart(2, "0");
		return `${m}:${s}`;
	};

	return (
		<div class={styles["auth-step"]}>
			<div class={`${styles["auth-header"]} ${styles["fade-up--enter"]}`}>
				<h2 class={styles["auth-title"]}>{t("auth-sign-in-to-minecraft")}</h2>
				<p class={styles["auth-subtitle"]}>
					{t("auth-use-microsoft-account-to-play-online")}
				</p>
			</div>

			<div class={styles["auth-body"]}>
				<Show when={!isAuthenticating()} keyed>
					<div class={`${styles["auth-idle"]} ${styles["panel--enter"]}`}>
						<Show
							when={!networkStore.isOffline()}
							fallback={
								<div class={styles["auth-offline-box"]}>
									<ConnectionLostIcon width="40" height="40" />
									<p class={styles["auth-offline-title"]}>
										{t("auth-no-internet-connection")}
									</p>
									<p class={styles["auth-offline-desc"]}>
										{t("auth-connection-required-to-authenticate")}
									</p>
								</div>
							}
						>
							<Button
								variant="ghost"
								size="lg"
								onClick={handleLogin}
								disabled={isStartingAuth()}
								class={styles["auth-ms-btn"]}
							>
								<Show
									when={!isStartingAuth()}
									fallback={
										<div class={styles["auth-spinner-inline"]}>
											<div class={styles["spinner--small"]} />
											<span>{t("auth-connecting")}</span>
										</div>
									}
								>
									<MicrosoftIcon
										width="22"
										height="22"
										class={styles["auth-ms-icon"]}
									/>
									{t("auth-login-with-microsoft")}
								</Show>
							</Button>
						</Show>

						<Show when={errorMessage()}>
							<div class={styles["auth-error"]}>{errorMessage()}</div>
						</Show>

						<button class={styles["auth-guest-link"]} onClick={handleGuestMode}>
							{hasAccount() && props.isLoginOnly
								? t("auth-back-to-launcher")
								: t("auth-continue-as-guest")}
						</button>

						<Show when={networkStore.isOffline()}>
							<p class={styles["auth-guest-hint"]}>
								{t("auth-guest-profiles-cannot-launch-minecraft")}
							</p>
						</Show>
					</div>
				</Show>

				<Show when={isAuthenticating()} keyed>
					<div class={`${styles["auth-active"]} ${styles["panel--enter"]}`}>
						<div class={styles["auth-instructions"]}>
							<p>
								{t("auth-visit-link-page")} <strong>microsoft.com/link</strong>
							</p>
							<p class={styles["auth-instructions-sub"]}>
								{t("auth-enter-code-to-connect-account")}
							</p>
						</div>

						<div class={styles["auth-code-box"]}>
							<div class={styles["auth-code"]}>{authCode()}</div>
							<button class={styles["auth-copy-btn"]} onClick={copyCode}>
								{copied() ? t("auth-copied") : t("shared-ui-copy")}
							</button>
						</div>

						<div class={styles["auth-actions"]}>
							<Button color="primary" onClick={openAuthUrl}>
								{t("auth-open-browser")}
							</Button>
							<Button variant="ghost" onClick={handleCancel}>
								{t("shared-ui-cancel")}
							</Button>
						</div>

						<div class={styles["auth-timer"]}>
							<Show
								when={timeLeft() > 0}
								fallback={
									<Button size="sm" variant="shadow" onClick={handleLogin}>
										{t("auth-get-new-code")}
									</Button>
								}
							>
								<span class={timeLeft() < 30 ? styles["auth-timer--low"] : ""}>
									{timerDisplay()}
								</span>
							</Show>
						</div>

						<div class={styles["auth-waiting"]}>
							<div class={styles["spinner--small"]} />
							<span>{t("auth-waiting-for-microsoft-authentication")}</span>
						</div>
					</div>
				</Show>
			</div>
		</div>
	);
}

export default AuthStep;
import MicrosoftIcon from "@assets/branding/microsoft.svg";
import ConnectionLostIcon from "@assets/icons/status/connection-lost.svg";
