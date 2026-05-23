import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Plumb",
  description:
    "A Model Context Protocol server that gives AI coding agents access to Figma files.",
  base: "/plumb-mcp/",
  cleanUrls: true,
  lastUpdated: true,
  themeConfig: {
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
