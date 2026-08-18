/// <reference types="@figma/plugin-typings" />

/**
 * Plugin-wide constants: the version the server sees in the pairing handshake,
 * and the two window sizes the panel toggles between (full panel while you're
 * setting up, a 60px dot once it's paired and out of your way).
 */

export const PLUGIN_VERSION = "0.13.2";
export const PANEL = { w: 240, h: 144 };
export const DOT = { w: 60, h: 60 };
