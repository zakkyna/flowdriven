import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("flowdrivenShell", Object.freeze({ kind: "electron" }));
