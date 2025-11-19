import { NavigateOptions } from "@solidjs/router";
import { open } from "@tauri-apps/plugin-shell";
import Button from "@ui/button/button";
import { Show, createSignal, onCleanup, onMount } from "solid-js";

interface InitPagesProps {
	initStep: number;
	changeInitStep: (n: number) => void;
	navigate?: (to: string, options?: Partial<NavigateOptions>) => void;
}

function InitFirstPage(props: InitPagesProps) {
	return (
		<>
			<div class={"init-page__top"}>
				<h1 style={"font-size: 40px"}>Welcome to Vesta</h1>
			</div>
			<div class={"init-page__middle"}>Some stuff</div>
			<div class={"init-page__bottom"}>
				<Button onClick={() => props.changeInitStep(props.initStep + 1)}>
					Next
				</Button>
			</div>
		</>
	);
}

function InitFinishedPage(props: InitPagesProps) {
	return (
		<>
			<div class={"init-page__top"}>
				<h1 style={"font-size: 40px"}>We have finished loading everything</h1>
			</div>
			<div class={"init-page__middle"}></div>
			<div class={"init-page__bottom"}>
				<Button onClick={() => props.navigate?.("/home", { replace: true })}>
					Let's GO!
				</Button>
			</div>
		</>
	);
}

function InitLoginPage(props: InitPagesProps) {
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
				props.changeInitStep(props.initStep + 1);
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
		<>
			<div class={"init-page__top"}>
				<h1 style={"font-size: 40px"}>Login to Microsoft</h1>
			</div>
			<div class={"init-page__middle"}>
				<Show when={!isAuthenticating()}>
					<p>Sign in with your Microsoft account to access Minecraft</p>
					<Show when={errorMessage()}>
						<p style={"color: red; margin-top: 10px"}>{errorMessage()}</p>
					</Show>
				</Show>
				<Show when={isAuthenticating()}>
					<div
						style={
							"display: flex; flex-direction: column; gap: 15px; align-items: center"
						}
					>
						<p>Visit the following URL and enter this code:</p>
						<div style={"display: flex; gap: 10px; align-items: center"}>
							<code
								style={
									"font-size: 24px; padding: 10px; background: rgba(255,255,255,0.1); border-radius: 8px"
								}
							>
								{authCode()}
							</code>
							<Button onClick={copyCode}>
								{copied() ? "Copied!" : "Copy"}
							</Button>
						</div>
						<Button onClick={openUrl}>Open in Browser</Button>
						<p style={"font-size: 14px; color: rgba(255,255,255,0.7)"}>
							{authUrl()}
						</p>
						<p style={"margin-top: 20px"}>Waiting for authentication...</p>
					</div>
				</Show>
			</div>
			<div class={"init-page__bottom"}>
				<Show when={!isAuthenticating()}>
					<Button onClick={handleLogin}>Login with Microsoft</Button>
				</Show>
				<Show when={isAuthenticating()}>
					<Button onClick={handleCancel}>Cancel</Button>
				</Show>
			</div>
		</>
	);
}

export { InitFinishedPage, InitFirstPage, InitLoginPage };
