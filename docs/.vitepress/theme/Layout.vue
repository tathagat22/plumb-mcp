<script setup>
import DefaultTheme from "vitepress/theme";
import { useData } from "vitepress";

const { Layout } = DefaultTheme;
const { frontmatter } = useData();
</script>

<template>
  <!-- Pages with `layout: false` (the homepage) skip VitePress's nav/sidebar
       chrome entirely and render their own full-bleed markup. -->
  <Content v-if="frontmatter.layout === false" />
  <Layout v-else>
    <template #nav-bar-content-after>
      <a
        href="https://github.com/tathagat22/plumb-mcp"
        target="_blank"
        rel="noopener"
        class="nav-star-btn"
        aria-label="Star plumb-mcp on GitHub"
      >
        <img
          src="https://img.shields.io/github/stars/tathagat22/plumb-mcp?style=social"
          alt="GitHub stars"
          height="20"
        />
      </a>
    </template>
  </Layout>
</template>
