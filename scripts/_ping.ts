import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
Promise.race([p.$queryRawUnsafe("select 1 as x"), new Promise((_, r) => setTimeout(() => r(new Error("timeout 15s")), 15000))]).then((x) => console.log("ok", x), (e) => console.log("fail", String(e).slice(0, 200))).finally(() => process.exit(0));
