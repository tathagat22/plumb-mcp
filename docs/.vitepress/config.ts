import { defineConfig } from "vitepress";

const SITE_URL = "https://tathagat22.github.io/plumb-mcp/";
const SITE_TITLE = "Plumb — Figma MCP server with no rate limits, on any plan";
const SITE_DESCRIPTION =
  "Local Figma MCP server for Claude Code, Cursor, Windsurf. No REST rate " +
  "limits, no metered tool-call quotas, no 25k token cap explosions, with a " +
  "built-in verification loop that diffs rendered code against the design. " +
  "Drop-in alternative to Figma's Dev Mode MCP and Framelink — works on every " +
  "Figma plan including Free.";

// Private visitor analytics (GoatCounter) — owner-only dashboard, no cookies,
// no banner, nothing visible to visitors. To enable:
//   1. Sign up free at https://www.goatcounter.com/ and pick a code (e.g. "plumb")
//      — your dashboard lives at https://<code>.goatcounter.com.
//   2. In GoatCounter → Settings, set the dashboard to require login (so only
//      you can see the counts).
//   3. Set GOATCOUNTER_CODE below to that code and redeploy.
// Left blank = no script is injected at all (zero third-party requests).
const GOATCOUNTER_CODE = "";

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
    ["meta", { name: "keywords", content: "figma mcp, figma mcp server, figma mcp rate limit, figma dev mode mcp, figma dev mode mcp alternative, figma dev mode mcp token limit, 25k token cap, framelink figma-developer-mcp, framelink 429, figma rest rate limit, figma free plan mcp, figma variables enterprise, claude code figma, cursor figma mcp, windsurf figma, model context protocol, design to code, ai coding agent, figma plugin mcp, plumb mcp" }],
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
    ...(GOATCOUNTER_CODE
      ? [
          [
            "script",
            {
              "data-goatcounter": `https://${GOATCOUNTER_CODE}.goatcounter.com/count`,
              async: "",
              src: "//gc.zgo.at/count.js",
            },
          ] as [string, Record<string, string>],
        ]
      : []),
  ],
  themeConfig: {
    logo: "/logo.png",
    siteTitle: "Plumb",
    nav: [
      { text: "Get started", link: "/getting-started" },
      { text: "Tools", link: "/tools/" },
      { text: "Playground", link: "/play/" },
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
          { text: "Alternatives & migration", link: "/alternatives" },
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
          { text: "plumb_query", link: "/tools/plumb_query" },
          { text: "plumb_describe", link: "/tools/plumb_describe" },
          { text: "plumb_tokens", link: "/tools/plumb_tokens" },
          { text: "plumb_selection", link: "/tools/plumb_selection" },
          { text: "plumb_assets", link: "/tools/plumb_assets" },
          { text: "plumb_screenshot", link: "/tools/plumb_screenshot" },
          { text: "plumb_search", link: "/tools/plumb_search" },
          { text: "plumb_components", link: "/tools/plumb_components" },
          { text: "plumb_verify", link: "/tools/plumb_verify" },
          { text: "plumb_fit", link: "/tools/plumb_fit" },
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
