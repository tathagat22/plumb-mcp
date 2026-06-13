import DefaultTheme from "vitepress/theme";
import { h } from "vue";
import "./star.css";

// Extend the default theme to drop a live "Star on GitHub" button into the
// navbar (right side, next to the GitHub icon). The shields `style=social`
// badge renders the real star count and auto-updates from GitHub's API.
export default {
  extends: DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      "nav-bar-content-after": () =>
        h(
          "a",
          {
            href: "https://github.com/tathagat22/plumb-mcp",
            target: "_blank",
            rel: "noopener",
            class: "nav-star-btn",
            "aria-label": "Star plumb-mcp on GitHub",
          },
          [
            h("img", {
              src: "https://img.shields.io/github/stars/tathagat22/plumb-mcp?style=social",
              alt: "GitHub stars",
              height: 20,
            }),
          ],
        ),
    });
  },
};
