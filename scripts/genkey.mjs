import { randomBytes } from "node:crypto";
console.log(`sk-cpb-${randomBytes(24).toString("base64url")}`);
