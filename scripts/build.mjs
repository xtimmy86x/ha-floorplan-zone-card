import { copyFile, mkdir } from "node:fs/promises";

await mkdir("dist", { recursive: true });
await copyFile("src/ha-floorplan-zone-card.js", "dist/ha-floorplan-zone-card.js");
console.log("Built dist/ha-floorplan-zone-card.js");
