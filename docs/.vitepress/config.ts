import { defineConfig } from "vitepress";

const SITE_URL = "https://tathagat22.github.io/plumb-mcp/";
const SITE_TITLE = "Plumb — Figma MCP server for AI coding agents";
const SITE_DESCRIPTION =
  "A Model Context Protocol (MCP) server for Figma. Connect Claude Code, " +
  "Cursor, Windsurf, and any other MCP-compatible AI coding agent to your " +
  "Figma files — token-efficient, no REST rate limits, on any plan including " +
  "Free.";

export default defineConfig({
  title: "Plumb",
  description: SITE_DESCRIPTION,
  base: "/plumb-mcp/",
  cleanUrls: true,
  lastUpdated: true,
  sitemap: { hostname: SITE_URL },
  head: [
    ["link", { rel: "icon", type: "image/png", href: "/plumb-mcp/favicon.png" }],
    ["meta", { name: "theme-color", content: "#0c8ce9" }],
    ["meta", { name: "author", content: "Tathagat Maitray" }],
    ["meta", { name: "keywords", content: "figma, mcp, model context protocol, design to code, claude code, cursor, windsurf, ai coding agent, figma mcp server, dev mode" }],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:title", content: SITE_TITLE }],
    ["meta", { property: "og:description", content: SITE_DESCRIPTION }],
    ["meta", { property: "og:url", content: SITE_URL }],
    ["meta", { property: "og:site_name", content: "Plumb" }],
    ["meta", { property: "og:image", content: `${SITE_URL}banner.png` }],
    ["meta", { property: "og:image:width", content: "1774" }],
    ["meta", { property: "og:image:height", content: "887" }],
    ["meta", { name: "twitter:card", content: "summary_large_image" }],
    ["meta", { name: "twitter:title", content: SITE_TITLE }],
    ["meta", { name: "twitter:description", content: SITE_DESCRIPTION }],
    ["meta", { name: "twitter:image", content: `${SITE_URL}banner.png` }],
  ],
  themeConfig: {
    logo: "/logo.png",
    siteTitle: "Plumb",
    nav: [
      { text: "Get started", link: "/getting-started" },
      { text: "Tools", link: "/tools/" },
      { text: "Architecture", link: "/architecture" },
      { text: "GitHub", link: "https://github.com/tathagat22/plumb-mcp" },
      { text: "npm", link: "https://www.npmjs.com/package/plumb-mcp" },
    ],
    sidebar: [
      {
        text: "Plumb",
        items: [
          { text: "Overview", link: "/" },
          { text: "Get started", link: "/getting-started" },
          { text: "Architecture", link: "/architecture" },
          { text: "Recipes", link: "/recipes" },
          { text: "Troubleshooting", link: "/troubleshooting" },
        ],
      },
      {
        text: "Tools",
        link: "/tools/",
        items: [
          { text: "plumb_status", link: "/tools/plumb_status" },
          { text: "plumb_outline", link: "/tools/plumb_outline" },
          { text: "plumb_node", link: "/tools/plumb_node" },
          { text: "plumb_tokens", link: "/tools/plumb_tokens" },
          { text: "plumb_selection", link: "/tools/plumb_selection" },
          { text: "plumb_assets", link: "/tools/plumb_assets" },
          { text: "plumb_screenshot", link: "/tools/plumb_screenshot" },
          { text: "plumb_search", link: "/tools/plumb_search" },
          { text: "plumb_components", link: "/tools/plumb_components" },
          { text: "plumb_verify", link: "/tools/plumb_verify" },
          { text: "plumb_fig_outline", link: "/tools/plumb_fig_outline" },
          { text: "plumb_fig_node", link: "/tools/plumb_fig_node" },
        ],
      },
    ],
    socialLinks: [
      { icon: "github", link: "https://github.com/tathagat22/plumb-mcp" },
    ],
    footer: {
      message: "Released under the MIT License.",
      copyright: "© Tathagat Maitray",
    },
    search: { provider: "local" },
  },
});
