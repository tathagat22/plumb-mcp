import DefaultTheme from "vitepress/theme";
import Layout from "./Layout.vue";
import "./star.css";

// Layout.vue extends the default theme with a live "Star on GitHub" navbar
// button, and skips VitePress's chrome entirely for `layout: false` pages
// (the homepage renders its own bespoke markup instead).
export default {
  extends: DefaultTheme,
  Layout,
};
