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
  // No `loadAllPagesAsync()` here: under "dynamic-page" that pulls every page
  // of the file into memory the moment the plugin opens. Plumb watches only the
  // page you're on and loads others when a request needs them (see inventory).
  const wasPaired = (await figma.clientStorage.getAsync("plumb-paired")) === true;
  figma.ui.postMessage({ type: "init", autoPair: wasPaired });

  figma.on("selectionchange", pushSelection);

  let changeTimer: ReturnType<typeof setTimeout> | null = null;
  const onChange = () => {
    // Drop the variable-map cache on every change — cheap to rebuild and
    // ensures variable renames/creates/deletes are picked up by the next
    // `get-node`. Selection/inventory pushes are still debounced.
    invalidateVariableMapCache();
    if (changeTimer !== null) clearTimeout(changeTimer);
    changeTimer = setTimeout(() => {
      changeTimer = null;
      pushSelection();
      pushInventory();
    }, 400);
  };

  // `documentchange` needs every page loaded, so listen per page instead and
  // move the listener along with you. You can only edit the page you're on;
  // Plumb's own writes bump the server's file version on their reply.
  let watched: PageNode = figma.currentPage;
  watched.on("nodechange", onChange);
  figma.on("currentpagechange", () => {
    watched.off("nodechange", onChange);
    watched = figma.currentPage;
    watched.on("nodechange", onChange);
    onChange(); // a newly visited page is now loaded — list its screens
  });

  pushSelection();
  pushInventory();
}

void start();
