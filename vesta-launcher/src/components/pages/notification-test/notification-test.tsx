import { invoke } from "@tauri-apps/api/core";
import Button from "@ui/button/button";
import { PROGRESS_INDETERMINATE } from "@utils/notifications";
import { createSignal } from "solid-js";
import styles from "./notification-test.module.css";

function NotificationTestPage() {
	const [loading, setLoading] = createSignal(false);

	const testEphemeralInfo = async () => {
		setLoading(true);
		try {
			await invoke("test_notification_info");
		} catch (error) {
			console.error("Failed to create notification:", error);
		} finally {
			setLoading(false);
		}
	};

	const testEphemeralSuccess = async () => {
		setLoading(true);
		try {
			await invoke("test_notification_success");
		} catch (error) {
			console.error("Failed to create notification:", error);
		} finally {
			setLoading(false);
		}
	};

	const testPersistentWarning = async () => {
		setLoading(true);
		try {
			await invoke("test_notification_warning");
		} catch (error) {
			console.error("Failed to create notification:", error);
		} finally {
			setLoading(false);
		}
	};

	const testPersistentError = async () => {
		setLoading(true);
		try {
			await invoke("test_notification_error");
		} catch (error) {
			console.error("Failed to create notification:", error);
		} finally {
			setLoading(false);
		}
	};

	const testProgressPulsing = async () => {
		setLoading(true);
		try {
			await invoke("test_notification_pulsing");
		} catch (error) {
			console.error("Failed to create notification:", error);
		} finally {
			setLoading(false);
		}
	};

	const testProgressBar = async () => {
		setLoading(true);
		try {
			await invoke("test_notification_progress");
		} catch (error) {
			console.error("Failed to create notification:", error);
		} finally {
			setLoading(false);
		}
	};

	const testMultipleNotifications = async () => {
		setLoading(true);
		try {
			await invoke("test_notification_multiple");
		} catch (error) {
			console.error("Failed to create notifications:", error);
		} finally {
			setLoading(false);
		}
	};

	const checkTables = async () => {
		setLoading(true);
		try {
			const tables = await invoke<string[]>("debug_check_tables");
			console.log("Database tables:", tables);
			alert("Tables: " + tables.join(", "));
		} catch (error) {
			console.error("Failed to check tables:", error);
			alert("Error: " + error);
		} finally {
			setLoading(false);
		}
	};

	const rerunMigrations = async () => {
		setLoading(true);
		try {
			const result = await invoke<string>("debug_rerun_migrations");
			console.log(result);
			alert(result);
		} catch (error) {
			console.error("Failed to rerun migrations:", error);
			alert("Error: " + error);
		} finally {
			setLoading(false);
		}
	};

	const submitCancellableTask = async () => {
		setLoading(true);
		try {
			await invoke("submit_test_task", {
				title: "Long Running Task",
				durationSecs: 15,
			});
		} catch (error) {
			console.error("Failed to submit task:", error);
		} finally {
			setLoading(false);
		}
	};

	return (
		<div class={styles["notification-test-page"]}>
			<h1>Notification System Test Page</h1>

			<div class={styles["test-section"]}>
				<h2>Task System</h2>
				<div class={styles["button-group"]}>
					<Button onClick={submitCancellableTask} disabled={loading()}>
						Submit Cancellable Task (15s)
					</Button>
				</div>
			</div>

			<div class={styles["test-section"]}>
				<h2>Ephemeral Notifications (Toast Only)</h2>
				<div class={styles["button-group"]}>
					<Button onClick={testEphemeralInfo} disabled={loading()}>
						Info Toast
					</Button>
					<Button onClick={testEphemeralSuccess} disabled={loading()}>
						Success Toast
					</Button>
				</div>
			</div>

			<div class={styles["test-section"]}>
				<h2>Persistent Notifications (Sidebar + Toast)</h2>
				<div class={styles["button-group"]}>
					<Button onClick={testPersistentWarning} disabled={loading()}>
						Warning (Persistent)
					</Button>
					<Button onClick={testPersistentError} disabled={loading()}>
						Error (Persistent)
					</Button>
				</div>
			</div>

			<div class={styles["test-section"]}>
				<h2>Progress Notifications</h2>
				<div class={styles["button-group"]}>
					<Button onClick={testProgressPulsing} disabled={loading()}>
						Pulsing Progress (-1)
					</Button>
					<Button onClick={testProgressBar} disabled={loading()}>
						Progress Bar (0-100)
					</Button>
				</div>
			</div>

			<div class={styles["test-section"]}>
				<h2>Batch Operations</h2>
				<div class={styles["button-group"]}>
					<Button onClick={testMultipleNotifications} disabled={loading()}>
						Send Multiple Toasts
					</Button>
				</div>
			</div>

			<div class={styles["test-section"]}>
				<h2>Debug</h2>
				<div class={styles["button-group"]}>
					<Button onClick={checkTables} disabled={loading()}>
						Check Tables
					</Button>
					<Button onClick={rerunMigrations} disabled={loading()}>
						Rerun Migrations
					</Button>
				</div>
			</div>

			<div class={styles["info-box"]}>
				<h3>How to Test:</h3>
				<ul>
					<li>
						<strong>Ephemeral:</strong> Appear as toasts only, disappear after
						5s
					</li>
					<li>
						<strong>Persistent:</strong> Appear in sidebar + toast, stay until
						dismissed
					</li>
					<li>
						<strong>Pulsing:</strong> Shows animated progress indicator
						(indeterminate)
					</li>
					<li>
						<strong>Progress Bar:</strong> Shows 0-100% with step counter
					</li>
					<li>
						<strong>Bell Icon:</strong> Shows spinner when tasks are active,
						badge when unread exist
					</li>
				</ul>
			</div>
		</div>
	);
}

export default NotificationTestPage;
