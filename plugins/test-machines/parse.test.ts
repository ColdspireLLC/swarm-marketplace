import { expect, test } from "swarm/test";
import { elementLines, parseUiAutomator } from "./elements";

// uiautomator's dump: a tappable row named by its children's text, which aren't listed again; text
// outside a tappable row listed as text; a list by its id; what has no name and takes no tap left out.
test("Android's screen as elements", async () => {
	const xml = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">
<node index="0" text="" resource-id="" class="android.widget.FrameLayout" clickable="false" bounds="[0,0][1080,2400]">
<node index="0" text="Settings" resource-id="com.x:id/title" class="android.widget.TextView" clickable="false" bounds="[40,100][400,180]" />
<node index="1" text="" resource-id="com.x:id/list" class="androidx.recyclerview.widget.RecyclerView" scrollable="true" clickable="false" bounds="[0,200][1080,2400]">
<node index="0" text="" resource-id="" class="android.widget.LinearLayout" clickable="true" bounds="[0,200][1080,400]">
<node index="0" text="Battery" resource-id="android:id/title" class="android.widget.TextView" clickable="false" bounds="[100,220][500,280]" />
<node index="1" text="100% &amp; charging" resource-id="android:id/summary" class="android.widget.TextView" clickable="false" bounds="[100,290][600,340]" />
</node>
<node index="1" text="" resource-id="" class="android.view.View" clickable="false" bounds="[0,400][1080,402]" />
</node>
</node>
</hierarchy>`;
	expect(elementLines(parseUiAutomator(xml))).toBe(
		[`- textview "Settings" at 220,140 (not clickable)`, `- recyclerview "list" at 540,1300 (not clickable)`, `- linearlayout "Battery: 100% & charging" at 540,300`].join("\n"),
	);
});
