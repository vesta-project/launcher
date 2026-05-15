import Button from "@ui/button/button";
import networkStore from "@stores/network";
import { openExternal as openUrl } from "@utils/external-link";
import {
	getActiveAccount,
	listenToAuthEvents,
	startLogin,
	cancelLogin,
	ACCOUNT_TYPE_GUEST,
	type AuthStage,
} from "@utils/auth";
import { invoke } from "@tauri-apps/api/core";
import { Motion, Presence } from "@motionone/solid";
import { createSignal, Match, onCleanup, onMount, Show, Switch } from "solid-js";
import { DURATION, EASE } from "../utils/motion";
import styles from "../init.module.css";

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
				setErrorMessage("Authentication cancelled");
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
			setErrorMessage(`Failed to start login: ${error}`);
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
			setErrorMessage(`Failed to start guest session: ${error}`);
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

	const openAuthUrl = () => {
		void openUrl(authUrl());
	};

	const timerDisplay = () => {
		const t = timeLeft();
		if (t <= 0) return "Expired";
		const m = Math.floor(t / 60);
		const s = (t % 60).toString().padStart(2, "0");
		return `${m}:${s}`;
	};

	return (
		<div class={styles["auth-step"]}>
			<Motion
				initial={{ opacity: 0, y: 12 }}
				animate={{ opacity: 1, y: 0 }}
				transition={{ duration: DURATION.normal, easing: EASE.smooth }}
			>
				<div class={styles["auth-header"]}>
					<h2 class={styles["auth-title"]}>Sign in to Minecraft</h2>
					<p class={styles["auth-subtitle"]}>
						Use your Microsoft account to play online.
					</p>
				</div>
			</Motion>

			<div class={styles["auth-body"]}>
				<Presence exitBeforeEnter>
					<Show when={!isAuthenticating()}>
						<Motion
							initial={{ opacity: 0, y: 12 }}
							animate={{ opacity: 1, y: 0 }}
							exit={{ opacity: 0, y: -12 }}
							transition={{ duration: DURATION.fast, easing: EASE.swift }}
						>
							<div class={styles["auth-idle"]}>
								<Show
									when={networkStore.isOnline()}
									fallback={
										<div class={styles["auth-offline-box"]}>
											<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#ff5555" stroke-width="2">
												<line x1="1" y1="1" x2="23" y2="23" />
												<path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.5" />
												<path d="M5 12.5a10.94 10.94 0 0 1 5.17-2.39" />
												<path d="M10.71 5.05A16 16 0 0 1 22.58 9" />
												<path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
												<path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
												<line x1="12" y1="20" x2="12.01" y2="20" />
											</svg>
											<p class={styles["auth-offline-title"]}>No internet connection</p>
											<p class={styles["auth-offline-desc"]}>
												A connection is required to authenticate with Microsoft.
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
										<Show when={!isStartingAuth()} fallback={
											<div class={styles["auth-spinner-inline"]}>
												<div class={styles["spinner--small"]} />
												<span>Connecting...</span>
											</div>
										}>
											<svg width="22" height="22" viewBox="0 0 23 23" class={styles["auth-ms-icon"]}>
												<path fill="#f35325" d="M1 1h10v10H1z" />
												<path fill="#81bc06" d="M12 1h10v10H12z" />
												<path fill="#05a6f0" d="M1 12h10v10H1z" />
												<path fill="#ffba08" d="M12 12h10v10H12z" />
											</svg>
											Login with Microsoft
										</Show>
									</Button>
								</Show>

								<Show when={errorMessage()}>
									<div class={styles["auth-error"]}>
										{errorMessage()}
									</div>
								</Show>

								<button
									class={styles["auth-guest-link"]}
									onClick={handleGuestMode}
								>
									{hasAccount() && props.isLoginOnly ? "Back to Launcher" : "Continue as Guest"}
								</button>

								<Show when={networkStore.isOffline()}>
									<p class={styles["auth-guest-hint"]}>
										Guest profiles cannot launch Minecraft.
									</p>
								</Show>
							</div>
						</Motion>
					</Show>
				</Presence>

				<Presence exitBeforeEnter>
					<Show when={isAuthenticating()}>
						<Motion
							initial={{ opacity: 0, y: 12 }}
							animate={{ opacity: 1, y: 0 }}
							exit={{ opacity: 0, y: -12 }}
							transition={{ duration: DURATION.fast, easing: EASE.swift }}
						>
							<div class={styles["auth-active"]}>
								<div class={styles["auth-instructions"]}>
									<p>
										Visit <strong>microsoft.com/link</strong>
									</p>
									<p class={styles["auth-instructions-sub"]}>
										Enter the code below to connect your account.
									</p>
								</div>

								<div class={styles["auth-code-box"]}>
									<div class={styles["auth-code"]}>
										{authCode()}
									</div>
									<button
										class={styles["auth-copy-btn"]}
										onClick={copyCode}
									>
										{copied() ? "Copied!" : "Copy"}
									</button>
								</div>

								<div class={styles["auth-actions"]}>
									<Button color="primary" onClick={openAuthUrl}>
										Open Browser
									</Button>
									<Button variant="ghost" onClick={handleCancel}>
										Cancel
									</Button>
								</div>

								<div class={styles["auth-timer"]}>
									<Show
										when={timeLeft() > 0}
										fallback={
											<Button size="sm" variant="shadow" onClick={handleLogin}>
												Get New Code
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
									<span>Waiting for Microsoft authentication...</span>
								</div>
							</div>
						</Motion>
					</Show>
				</Presence>
			</div>
		</div>
	);
}

export default AuthStep;
