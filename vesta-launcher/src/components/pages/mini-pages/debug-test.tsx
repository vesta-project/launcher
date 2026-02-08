import { createSignal } from "solid-js";
import { Checkbox } from "@ui/checkbox/checkbox";
import { Switch } from "@ui/switch/switch";
import { ToggleGroup, ToggleGroupItem } from "@ui/toggle-group/toggle-group";
import { Separator } from "@ui/separator/separator";

export default function DebugTestPage() {
	const [checkboxChecked, setCheckboxChecked] = createSignal(false);
	const [switchChecked, setSwitchChecked] = createSignal(false);
	const [toggleValue, setToggleValue] = createSignal("one");

	return (
		<div style={{ padding: "40px", display: "flex", "flex-direction": "column", gap: "24px", color: "white", "min-height": "100%", "background": "#121212" }}>
			<h1>Vesta UI Component Test</h1>
			
			<section>
				<h2>Checkbox</h2>
				<Checkbox 
					checked={checkboxChecked()} 
					onChange={(val) => {
						console.log("Checkbox change event received:", val);
						setCheckboxChecked(val);
					}}
				>
					<label>Project Checkbox (Status: {checkboxChecked() ? "Checked" : "Unchecked"})</label>
				</Checkbox>
			</section>

			<Separator />

			<section>
				<h2>Switch</h2>
				<label>Project Switch Label (Click Me)</label>
				<Switch 
					checked={switchChecked()} 
					onCheckedChange={(val) => {
						console.log("Switch change event received:", val);
						setSwitchChecked(val);
					}}
				/>
				<p>State: {switchChecked() ? "ON" : "OFF"}</p>
				<button onClick={() => setSwitchChecked(!switchChecked())} style={{ "margin-top": "8px", padding: "4px 8px" }}>
					Force Toggle via Code
				</button>
			</section>

			<Separator />

			<section>
				<h2>Toggle Group</h2>
				<ToggleGroup 
					value={toggleValue()} 
					onChange={(val) => {
						console.log("ToggleGroup change event received:", val);
						if (typeof val === "string") setToggleValue(val);
					}}
				>
					<ToggleGroupItem value="one" style={{ padding: "8px 16px", border: "1px solid #444", background: toggleValue() === "one" ? "var(--primary)" : "transparent" }}>
						Option One
					</ToggleGroupItem>
					<ToggleGroupItem value="two" style={{ padding: "8px 16px", border: "1px solid #444", background: toggleValue() === "two" ? "var(--primary)" : "transparent" }}>
						Option Two
					</ToggleGroupItem>
				</ToggleGroup>
				<p>Selected: {toggleValue()}</p>
			</section>
		</div>
	);
}
