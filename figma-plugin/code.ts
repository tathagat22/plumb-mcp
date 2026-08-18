/// <reference types="@figma/plugin-typings" />

/**
 * Plumb plugin — main thread entry point.
 *
 * Streams the current selection, the file's screen inventory, and answers the
 * server's on-demand requests for any node and its exported assets. The UI
 * iframe is a pure relay to/from the localhost WebSocket.
 *
 * The work itself lives in focused siblings — `serialize`, `inventory`,
 * `assets`, `requests` — so this file stays what it should be: the window, the
 * event wiring, and startup.
 */

import { DOT, PANEL } from "./constants";
import { uploadAcks } from "./assets";
import { pushInventory, pushSelection } from "./inventory";
import { dispatchServerRequest } from "./requests";
import { invalidateVariableMapCache } from "./serialize";

figma.showUI(__html__, {
  width: PANEL.w,
  height: PANEL.h,
  title: "Plumb",
  themeColors: true, // inherit Figma's light/dark theme via CSS variables
});

/* ------------------------------------------------------------------ */
/* UI messages + startup                                               */
/* ------------------------------------------------------------------ */

figma.ui.onmessage = (message: {
  type?: string;
  req?: unknown;
  reqId?: string;
  index?: number;
  error?: string | null;
}) => {
  if (!message || typeof message.type !== "string") return;
  switch (message.type) {
    case "resync":
      pushSelection();
      pushInventory();
      break;
    case "collapse":
      figma.ui.resize(DOT.w, DOT.h);
      break;
    case "expand":
      figma.ui.resize(PANEL.w, PANEL.h);
      break;
    case "paired":
      void figma.clientStorage.setAsync("plumb-paired", true);
      break;
    case "server-request":
      void dispatchServerRequest(message.req);
      break;
    case "upload-ack": {
      const key = `${message.reqId}-${message.index}`;
      const resolve = uploadAcks.get(key);
      if (resolve) {
        uploadAcks.delete(key);
        resolve(message.error ?? null);
      }
      break;
    }
  }
};

async function start(): Promise<void> {
  // documentAccess "dynamic-page" requires all pages loaded before the
  // document-wide change handler — and before reading other pages' children.
  await figma.loadAllPagesAsync();

  const wasPaired = (await figma.clientStorage.getAsync("plumb-paired")) === true;
  figma.ui.postMessage({ type: "init", autoPair: wasPaired });

  figma.on("selectionchange", pushSelection);

  let changeTimer: ReturnType<typeof setTimeout> | null = null;
  figma.on("documentchange", () => {
    // Drop the variable-map cache on every documentchange — cheap to rebuild
    // and ensures variable renames/creates/deletes are picked up by the next
    // `get-node`. Selection/inventory pushes are still debounced.
    invalidateVariableMapCache();
    if (changeTimer !== null) clearTimeout(changeTimer);
    changeTimer = setTimeout(() => {
      pushSelection();
      pushInventory();
    }, 400);
  });

  pushSelection();
  pushInventory();
}

void start();
